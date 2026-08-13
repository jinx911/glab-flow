# glab-flow Architecture

> Operator reference, copied from the design spec (`docs/superpowers/specs/2026-07-28-glab-flow-design.md` §4 + §7.2).

## Seven layers

```
① 触发入口    GitLab Issue URL（或自然语言 free-flow）→ Leader 启动
② 规则权威    harness 仓(issue-state-machine.md + AGENTS.md + 模板) = 单一真理源
              引擎持有「派生的声明式状态机模型 state-machine.yaml」+ 模型↔文档一致性校验
③ 状态机驱动  读 GitLab Issue labels → 查模型 → 当前节点/允许下一节点/必填项/Assignee映射/门禁类型
④ 护栏/前置校验 确定性纯函数(非 LLM)：硬门禁强制人工证据；缺字段→停+一次性列全缺失项
⑤ 内容生成    Leader 按节点委派专家 agent，复用现有 skill（见 nodes.md）
⑥ GitLab写回层 Leader 唯一执行对外写回：label/assignee/comment/close 均由已认证 `glab` CLI 执行；
              引擎不持有 token、不封装 API client、不做网络/子进程 I/O；强制 preview-confirm
⑦ 持久化      GitLab Issue = 唯一状态真相(labels + 评论)；
              本地 .glab-flow/<issue>/ 只放可重建的工作产物
```

## Main data flow

```
GitLab Issue URL → Leader → 读 labels → 状态机模型 → 当前节点+必填项+门禁
  → 缺证据/门禁？ 停，列缺失，问用户
  → 齐了？ 委派专家 agent 生成内容 → 护栏校验
  → 起草「状态变更评论 + 标签/Assignee 变更」→ 预览 → 用户确认
  → Leader 直接跑 glab CLI 写回 → 更新本地快照 → 下一节点
```

## Guard layer G1–G14 (deterministic, pure function — no LLM in critical path)

The status-change comment is rendered from **structured fields** into the harness template; the guard validates fields, not natural language. LLM only proposes field values; confirmation + validation are deterministic.

| # | Rule | Determination |
|---|---|---|
| G1 | 流转前置必填 | required fields (date/confirmer/conclusion/evidence) all non-empty → else block |
| G2 | 门禁二值 | gateOutcome must be 通过 to advance; 退回 routes to return path |
| G3 | hard_gate | hardGate transitions require humanConfirmed |
| G4 | 三类评审分离 | reviewType must equal the transition's gate |
| G5 | 标签唯一 | exactly one story-status::* / status::* and one type::*; else dirty-state block |
| G6 | Assignee 强制映射 | concrete @user from 交付协同 table, not a bare role |
| G7 | 不改原文 (write-plan) | never update issue body |
| G8 | 不编评论 (write-plan) | never edit/delete comment |
| G9 | 不猜人/结论 | reject 待确认 placeholder |
| G10 | 日期需确认 | any date field requires datesConfirmed |
| G11 | 阻塞问题全验证 | 测试中→待发布 requires 阻塞发布问题均已验证通过 === 是 (story + bug) |
| G12 | 终态原子 | terminal transition requires closeIssue (label+assignee+comment+close in one op) |
| G13 | 不建 Jira (write-plan) | never create Jira |
| G14 | feature MR 评审前置 | 测试中→待发布 requires feature分支MR评审结论 (no CRITICAL/HIGH 残留) |

Per-rule source: each maps to a clause in `AGENTS.md` / `docs/issue-state-machine.md`; each has a unit test. The rule set is covered by the model↔invariants contract check (`engine/src/contract.ts`) so harness rule changes that aren't reflected in the model fail CI.

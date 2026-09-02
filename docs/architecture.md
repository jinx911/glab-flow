# glab-flow Architecture

**Last Updated:** 2026-09-02

> Operator reference, aligned with the executable DU/GateSet flow and the design spec (`docs/specs/2026-07-28-glab-flow-design.md` §4 + §7.2).

## Seven layers

```
① 触发入口    GitLab Issue URL（或自然语言 free-flow）→ Leader 启动
② 规则权威    harness 仓(issue-state-machine.md + AGENTS.md + 模板) = 业务规则真源
              引擎持有「声明式状态机 + GateMatrix」并做模型↔文档一致性校验
③ 交付工作包  Leader 回读/初始化 DU；DU 保存 GateSet、TestRun/AssetAudit、资源、指标与当前节点事实
④ 状态投影    DU × GateSet → GitLab labels/comments；状态机只负责确定性校验、路径投影和对账
⑤ 护栏/内容层 确定性纯函数(非 LLM)：硬门禁强制人工证据；缺字段/公共评论泄漏→fail-closed
              团队评论只写公共交接摘要，执行明细留在 DU/内部报告
⑥ GitLab写回层 Leader 唯一执行对外写回：label/assignee/comment/close 均由已认证 `glab` CLI 执行；
              引擎不持有 token、不封装 API client、不做网络/子进程 I/O；强制 preview-confirm
⑦ 持久化      DU 是交付事实主档；GitLab Issue 是外部状态协调面；本地 state/lessons 是可重建缓存
```

## Main data flow

```
GitLab Issue + DU → Leader 回读 labels/comments/本地事实 → 状态机 + GateMatrix
  → 推导当前节点、GateSet、必填项与公共交接内容
  → 缺证据/门禁/公共评论安全校验？停，列缺失，问用户
  → 齐了？生成 WritePlan + playbook → 预览 → 按 ActionPolicy 批量确认
  → Leader 直接跑 glab CLI 写回 → 最终回读 Issue → 追加 DU 事实/指标 → 下一节点
```

## Guard layer G1–G16 (deterministic, pure function — no LLM in critical path)

The status-change comment is rendered from **structured fields** into the harness template; the guard validates fields, not natural language. LLM only proposes field values; confirmation + validation are deterministic. DU facts are preferred over legacy Issue receipts, while public-comment validation blocks internal execution material before a WritePlan is emitted.

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
| G11 | 阻塞问题全验证 | 测试中→待发布 requires every blocking issue's latest verification to pass |
| G12 | 终态原子 | terminal transition requires closeIssue (label+assignee+comment+close in one op) |
| G13 | 不建 Jira (write-plan) | never create Jira |
| G14 | feature MR 评审前置 | 测试中→待发布 requires feature分支MR评审结论 (no CRITICAL/HIGH 残留) |
| G15 | 变更影响闭环 | open change-impact records block forward transitions until required artifacts and evidence close |
| G16 | 公共评论隔离 | rendered handoff rejects Apifox/local credentials, paths, report IDs, commit hashes and machine markers; DU digest remains an approved summary |

Per-rule source: each maps to a clause in the delivery specs and node/gate docs; each has a unit test. The rule set is covered by the model↔invariants contract check (`engine/src/contract.ts`) so harness rule changes that aren't reflected in the model fail CI.

## Authority and writeback boundaries

- GitLab labels are the external lifecycle-state projection. DU (`.glab-flow/<iid>/du.json`) is the authority for execution facts, affected scopes, GateSet, resources, metrics, and the reconciliation `cachedNode`; state is only a derived session cache.
- Before every write, Leader reads the latest Issue labels/body/state, fully paginated Issue/MR notes, and DU, then runs `pnpm cli reconcile`. Reconciliation does not write GitLab or silently rewrite DU/state: `label-ahead` needs an L2 choice, `du-ahead` resumes the first incomplete audited stage, and dirty/unknown/external-close cases stop for manual handling.
- Writeback is strictly metadata → merged state comment → terminal close (when applicable) → final readback. Only after successful readback does Leader run `pnpm cli du` `cached-node` with the effective final target and then update state. Week Milestone sync is an independent post-readback action.

## GateSet and route projection

`GateSet = deriveGateSet(gateMatrix, declaredScopes)` is bound at Story `已评审 → 开发中`; Bug `已确认缺陷 → 开发中` is also a binding boundary. Bug development entry requires non-empty `declaredScopes` unless the DU already contains a frozen GateSet. The proposal is confirmed in the same L2 batch as planned test/release dates. When a binding pass returns `proposedGateSet`, it does not write Issue status: for Bug with `declaredScopes` but no frozen DU GateSet, `validate.ok=false`, `plan` is undefined, and the playbook contains only `bind_gateset` (no `issue_writeback`). The Leader executes that action and persists the returned DU, then reruns `transition`; only after the GateSet is frozen does the normal `WritePlan` and Issue writeback playbook get generated. The engine does not write the DU or GitLab. A frozen GateSet cannot be silently rebound. Later scope expansion uses `change` and ratchets requirements upward; any downgrade requires an explicit audited override.

GateSet logical environments are currently limited to `local` and `test`. Concrete URLs, accounts, and project mappings remain configuration-owned. Regression actions are emitted only when an enabled environment is missing its required evidence; they use `test-flow-e2e`, must record the resulting TestRun/AssetAudit in the DU, and require a fresh `transition`. For submission, local regression is ordered after feature commit and before merge or deployment.

When `rollbackPlan` is enabled, the production playbook action is `verify_rollback_ready`, which verifies the previously generated and read-back plan. `release-check` remains the generator during `测试中 → 待发布`; production deployment must not regenerate the release plan.

`skipStates` is a one-hop route projection. When it matches the next node, `next`, labels, and the rendered state-comment header use the effective final target; validation still uses the original transition and keeps all required fields/guards, while any projected hard-gate transition is validated too. Skip projection cannot bypass production deployment or terminal acceptance hard gates: those transitions remain L3 and require `humanConfirmed`, regardless of GateSet, `run_mode`, or automation.

## Module map

| Module | Responsibility |
|---|---|
| `engine/src/model.ts` | Load YAML and resolve nodes/transitions |
| `engine/src/transition.ts` | Deterministic orchestration: evidence, guards, plan, render, playbook |
| `engine/src/guard.ts` | G1–G16 and environment evidence checks |
| `engine/src/du.ts` | Immutable DU lifecycle, evidence, GateSet binding, cached-node baseline |
| `engine/src/gate-set.ts` | Scope-to-GateSet derivation, ratchet, and override |
| `engine/src/reconcile.ts` | GitLab label projection vs DU baseline verdicts |
| `engine/src/next-step.ts` | Fastest route, blocked work, and cleanup checklist |
| `engine/src/plan.ts` | Immutable Issue WritePlan and post-writeback intent |
| `engine/src/resource.ts` | DU resource registration and cleanup |
| `engine/src/change.ts` | T1–T4 impact and GateSet expansion |
| `engine/src/cli.ts` | JSON stdin/stdout command adapter |

## Related documentation

- [Flow](flow.md) — state machine and per-round orchestration.
- [Skill entry point](../skills/glab-flow/SKILL.md) — operational contract and commands.
- [Node contracts](../skills/glab-flow/nodes.md) — fields, evidence, content, and route projection.
- [Gate ritual](../skills/glab-flow/gate.md) — six-step ceremony and L1/L2/L3 hard gates.
- [Resume/reconcile](../skills/glab-flow/resume.md) — restart and writeback recovery.
- [Tools](../skills/glab-flow/tools.md) — runtime infrastructure boundaries.

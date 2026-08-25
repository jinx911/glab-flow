---
name: glab-flow-mr-review
description: 测试中→待发布 的 feature→master MR 评审子 skill。推断需求目标、核对需求↔代码一致性、识别需求外改动与 bug/回归；无 CRITICAL/HIGH 残留才放行（G14）。
---

> 本文件是 glab-flow 自有子 skill（方法论，单 Leader）。在测试中→待发布 由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# MR Review：feature→master MR 评审

「测试中→待发布」playbook 的 `mr_review` 步骤（见 `../nodes.md` / `../gate.md`）：测试通过后，**先建 feature→master MR 并评审，无 CRITICAL/HIGH 残留才推进待发布**（G14，见 `../guards.md`）。这是为了避免阻塞 bug 漏到「待发布」之后才发现、已过测试验收还得回头重提测。

## 前置：建 MR（create_mr_to_master，git-ops）

- 目标分支 `master`，源分支 = 本 Issue 的 feature 分支。
- **MR 标题 = Issue 地址**（含 iid，如 `<iid> <需求简述>`），保证可追溯。
- MR 描述引用父 Issue + spec（proposal.md / design.md），让评审对齐需求而非凭空挑刺。

## 评审执行（委托运行时工具）

MR 评审优先用 **`mr-review-lite`**（外部运行时 skill，见 `../tools.md`）；未安装则**降级**用 glab-flow 自带的 `code-review.md` sub-skill（含跨栈激活维度）。两种都按下面的方法论 + 严重度门槛，不报错中止。

调用约定（与 `test-flow-apifox.md` 一致）：

- **同步取结果**：拿到结构化问题清单（严重度/文件/行/问题/建议）再判定，不异步丢任务。
- **对齐需求**：把父 Issue 正文 + proposal.md/design.md 喂给评审，让它对齐需求目标。
- **降级标注**：用 `code-review` 降级时，结论里标注「未用 mr-review-lite，code-review 评审」。

## 评审维度（MR 专属，区别于开发期代码评审）

1. **需求↔代码一致性**：MR 的每处改动是否都能追溯到一条需求目标 / 验收标准；需求要求的改动是否都做了。发现「需求要的没做」或「做了但需求没要」→ 标问题。
2. **需求外改动（out-of-scope）**：MR 里出现与本需求无关的文件/逻辑（他人误推、附带重构、参考价/预留开关）。用 codegraph 查改动符号的 callers 核实是否真无依赖；疑似超范围 → 标 HIGH，建议从 MR 剔除或单独走。
3. **bug / 回归风险**：改动是否破坏现有功能、引入空指针/并发/事务边界问题、跨栈断裂（后端新字段无前端调用方、前端读字段后端没返回——参考 `code-review.md` 跨栈激活维度）。
4. **CRITICAL/HIGH 严重度**：同 `code-review.md` 分级（安全/数据丢失/崩溃 = CRITICAL；明显缺陷/重要边界 = HIGH）。

## 通过门槛（G14）

- **无 CRITICAL、无未解决 HIGH** → MR 评审通过，填 `feature分支MR评审结论` = 「通过，无 HIGH 残留」，Leader 继续推进待发布（issue_writeback）。
- **有 CRITICAL/HIGH** → **不放行**：留在测试中，转 `git-ops` 修复 → 完成实现后验证与代码走查 → 重新推送 → 重评 MR，直到通过。这正是「不通过→修复→重复」的循环（见 `../gate.md`「证据不足时」）。
- 每个受影响 feature→master MR 都必须有独立的 mr-review：Leader 在**该 MR**新增评审评论（结论 = 通过、method = mr-review-lite|code-review、high-findings = none），父 Issue 可汇总链接和结论，但**不能替代任一 MR 的评审**；MR 清单为空、无访问权或有一个未评都会阻塞 G14。
- 评审意见（含问题清单 + 门槛结论）可另挂父 Issue 评论（`glab issue note`，G8 只新增；G13 不建独立 Bug Issue），但这是面向父需求的摘要，不是 MR 回执替代品。

## glab-flow 上下文

- **节点归属**：测试中→待发布（`../nodes.md`）；MR 在此**只创建 + 评审、不合并**——合并发生在「发布」（待发布→生产验收中，playbook 的 deploy 步骤）。
- **单 Leader**：Leader 调用评审工具、合并严重度、判定 G14 门槛，不组建多 agent 团队。
- **门禁对齐**：MR 评审结论是 G14 的输入（`feature分支MR评审结论` 必填，G1 强制）；未通过 → `validate.ok=false` → 不推进状态。
- **冻结**：不建 Jira（G13）；不改原文（G7）；评审评论只新增（G8）。

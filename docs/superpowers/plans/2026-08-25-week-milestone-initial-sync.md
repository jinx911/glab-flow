# Week Milestone 初始挂载 Implementation Plan

> **For agentic workers:** 本计划按用户长期约束采用“先实施、后定向验证”，不使用测试先行仪式。

**Goal:** 让周内已评审需求和排期变更在 Issue 回读后立即、可恢复地同步 Week Milestone。

**Architecture:** 引擎只产出 typed `postWriteback` 意图；Leader 依据该意图在回读后执行 GitLab 关联。写回失败与 Milestone 同步失败分离审计，避免重复评论或状态回滚。

**Tech Stack:** TypeScript、Vitest、GitLab glab CLI（Leader 层）。

---

### Task 1: 纯计算同步意图

**Files:** `engine/src/types.ts`、`engine/src/plan.ts`、`engine/src/transition.ts`

- [ ] 在 `WritePlan` 中加入 `postWriteback`，并在 Story 评审、带有效计划的 Bug 开发开始和启用的排期变更时生成 `sync_week_milestone`。
- [ ] 将 playbook 显式划分为前置动作、Issue 写回、回读后同步，预览展示禁止并行的后置动作。

### Task 2: 运行契约

**Files:** `skills/glab-flow/SKILL.md`、`skills/glab-flow/gate.md`、`skills/glab-flow/nodes.md`、`skills/glab-flow/resume.md`

- [ ] 把“Harness 是唯一 writer”的旧契约改为“Leader 初始同步 + Harness 周一 rollover”的职责边界。
- [ ] 写明目标周算法、幂等操作、禁止字段以及失败恢复顺序。

### Task 3: 实现后验证

**Files:** `engine/src/transition.test.ts`、`engine/src/week-plan-change.test.ts`、`engine/src/process-contract.test.ts`

- [ ] 覆盖 Story 评审、Bug 开发开始、启用/暂停排期变更和 #175 的 W35/W36 回放。
- [ ] 运行 `pnpm test`、`pnpm typecheck` 与 `pnpm build`，再用真实 #175 输入调用 `pnpm cli transition` 做模拟走查。

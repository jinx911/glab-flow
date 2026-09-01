# Apifox 展示一致性与认证契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Per user instruction, implement each task first, then add focused tests and run verification.

**Goal:** 让 glab-flow 能将 Apifox 页面展示环境和可复用认证能力纳入版本化资产审计，并在 local/test TestRun 前严格校验。

**Architecture:** 在既有 v1 资产审计旁增加兼容的 v2 marker；测试计划按 case 声明需要页面投影和 AuthProfile。引擎只做解析、渲染、最新记录选择与门禁校验，Leader 继续负责 Apifox/GitLab I/O 与 UI 走查。

**Tech Stack:** TypeScript、Vitest、Markdown skill、Apifox CLI。

---

### Task 1: 设计 v2 纯数据契约

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/test-run.ts`
- Modify: `engine/src/asset-audit.ts`

- [x] 实现 `ApifoxAssetPresentation` 与 `ApifoxAuthProfileReceipt`，字段分别为 case、资产类型、预期/展示/报告环境，以及 case、profile、临时 token 变量。
- [x] 在 `TestPlanCase` 增加可选 `presentations` 和 `authProfiles`；解析 `presentation: TP-001 | scenario` 与 `auth-profile: TP-001 | client-user`，拒绝未知 case、重复条目、非 scenario 认证声明和空 profile。
- [x] 支持 v1/v2 两种资产审计 marker；v2 解析 `presentation`、`auth-profile` 行，未知字段、重复身份、非法环境和空 token 变量一律失败。
- [x] 校验时仅对计划声明的项目要求 v2 回执；要求 expected/displayed/report 三者相等，要求每个 AuthProfile 有相同 case 的非敏感回执，并拒绝 v1 静默满足 v2 计划。

### Task 2: 渲染、CLI 与状态门禁

**Files:**
- Modify: `engine/src/asset-audit.ts`
- Modify: `engine/src/cli.ts`
- Modify: `engine/src/guard.ts`

- [x] 渲染 v2 人类摘要和机器 marker；输出展示环境三方对比、认证 profile 与临时变量名，禁止输出凭据或 token 值。
- [x] 保持 `pnpm cli asset-audit` 为纯预览命令，接收 v1/v2 输入并以相同解析器验证自己渲染的 marker。
- [x] 保持 local/test 既有顺序；当计划声明 presentation/auth-profile 而审计不满足时，返回既有 `<environment>AssetAudit` 缺口和具体原因，不生成状态写回计划。

### Task 3: 实现后补充验证

**Files:**
- Modify: `engine/src/test-run.test.ts`
- Modify: `engine/src/asset-audit.test.ts`
- Modify: `engine/src/guard.test.ts`
- Modify: `engine/src/cli.test.ts`

- [x] 在实现后新增 v2 通过路径：local/test 计划、展示环境一致、Stage 报告一致、AuthProfile 临时变量存在，能形成资产审计和 TestRun。
- [x] 新增拒绝路径：Stage 显示 local、报告环境不符、v1 回执满足不了 v2 计划、遗漏认证回执、重复/未知 case、空 token 变量。
- [x] 新增兼容路径：未声明展示或认证的既有计划与 v1 审计继续通过。
- [x] 运行 `pnpm test`、`pnpm typecheck` 和 `git diff --check`。

### Task 4: 更新活跃运行规范

**Files:**
- Modify: `README.md`
- Modify: `docs/flow.md`
- Modify: `skills/glab-flow/nodes.md`
- Modify: `skills/glab-flow/gate.md`
- Modify: `skills/glab-flow/sub-skills/test-design.md`
- Modify: `skills/glab-flow/sub-skills/test-flow-apifox.md`
- Modify: `engine/src/process-contract.test.ts`

- [x] 写明计划环境、显式执行环境、报告环境和页面展示环境的四层事实与核对顺序。
- [x] 写明 AuthProfile、运行时变量、登录后置提取、统一鉴权头、跨场景变量传递及 401/403 不静默重试。
- [x] 写明跨环境场景的共享基础资产和环境入口规则；页面无法验证时必须停止，不得以标签或描述代替。
- [x] 增加流程契约测试，确保活跃文档仍保留引擎无 I/O、v1 兼容、v2 marker、认证安全与多环境规则。

### Task 5: 模拟走查和交付

**Files:**
- Modify: `docs/plans/2026-08-24-apifox-presentation-auth.md`

- [x] 用 CLI 输入模拟 local/test 的 v2 资产审计和 TestRun，并确认有效记录可推进、Stage 显示 local 的记录被阻断。
- [x] 重新运行全量测试、类型检查、`git diff --check`、文档/凭据扫描和变更清单检查。
- [ ] 用户已授权后，提交设计、计划、实现和验证；推送开发分支，创建 PR，合并到 master，再回读远端合并结果。

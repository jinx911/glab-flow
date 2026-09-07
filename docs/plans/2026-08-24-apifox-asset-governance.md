# Apifox 资产治理实施计划

> **For agentic workers:** 逐任务执行本计划。 Per user instruction, implement each task first, then add or update focused tests and run verification.

**Goal:** 让场景、套件/场景分组、测试数据和场景实例成为可复用、可回读、可审计的 Apifox 测试资产，并使有效资产审计成为 local/test TestRun 的前置。

**Architecture:** `asset-audit.ts` 负责纯解析与校验最新不可变资产审计评论；`test-run.ts` 继续负责测试计划和环境执行记录，并在计划中声明每个 case 的所需资产。`guard.ts` 组合资产审计和 TestRun 两道确定性门禁；Leader 仍通过当前 Apifox CLI 的 `list/get` 完成外部事实采集，不向引擎引入 I/O。

**Tech Stack:** TypeScript、Vitest、YAML 状态机、Markdown skills、Apifox CLI（Leader-owned runtime dependency）。

---

### Task 1: 定义资产计划、审计与 TestRun 关联契约

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/test-run.ts`
- Create: `engine/src/asset-audit.ts`
- Create: `engine/src/asset-audit.test.ts`
- Modify: `engine/src/test-run.test.ts`

- [x] 在 `types.ts` 定义 `ApifoxAssetType`（`scenario`、`suite-or-group`、`test-data`、`scenario-instance`）、`ApifoxAssetAction`、计划资产需求、`ApifoxAssetAudit` 与最新审计联合类型；把 `TestRun.assetAudit` 设为必填字符串。
- [x] 扩展 `test-plan` marker：每条 API case 至少有一个 `asset: <case-id> | scenario`；按实际运行入口和数据驱动需求附加 `suite-or-group`、`test-data`、`scenario-instance`。拒绝未知 case、重复需求和无 scenario 的 API case。
- [x] 新建 `asset-audit.ts`，严格解析 `glab-flow:apifox-asset-audit:v1`：单一环境/计划版本/项目/分支/未处置问题数/证据字段，多条 `asset`；最新相同环境审计无效时不回退旧记录。
- [x] 让审计校验验证：计划版本匹配、未处置问题为零、每个当前环境必需的 `case + asset type` 均有回读资产、没有未知 case/type、审计证据非空。
- [x] 更新 TestRun marker 的渲染和解析，要求 `asset-audit: <plan-version>/<environment>`；拒绝缺失或和当前环境/计划不一致的记录。
- [x] 实现后补充解析、最新无回退、缺场景、缺数据资产、未处置问题、过期计划、TestRun 审计引用不匹配的测试。

### Task 2: 将资产审计接入两个环境门禁和 CLI

**Files:**
- Modify: `engine/src/guard.ts`
- Modify: `engine/src/cli.ts`
- Modify: `engine/src/guard.test.ts`
- Modify: `engine/src/transition.test.ts`
- Modify: `engine/src/cli.test.ts`

- [x] 在 `guard.ts` 增加 `validateAssetAuditTransition`：开发中→测试中读取 local 审计，测试中→待发布读取 test 审计；先校验当前计划，再校验最新审计和 TestRun。
- [x] 将审计结果合并进 `validateTransition`，缺口名称为 `localAssetAudit` / `testAssetAudit`，并与 TestRun 门禁共同生效。
- [x] 给 `cli.ts` 增加纯 `asset-audit` 命令：stdin `{plan,audit}`，输出 `{validate,comment}`，不执行 Apifox/GitLab I/O；保留 `test-run` 命令，但要求其显式资产审计引用。
- [x] 实现后补充转换/legacy CLI 覆盖：缺 audit 阻断、local audit 不替代 test audit、错误最新 audit 不回退、正确 audit + TestRun 放行、CLI 只渲染不写外部系统。

### Task 3: 更新状态评论、流程文档与 Apifox 资产治理规范

**Files:**
- Modify: `engine/src/render.ts`
- Modify: `engine/src/render.test.ts`
- Modify: `skills/glab-flow/SKILL.md`
- Modify: `skills/glab-flow/nodes.md`
- Modify: `skills/glab-flow/gate.md`
- Modify: `skills/glab-flow/tools.md`
- Modify: `skills/glab-flow/sub-skills/test-design.md`
- Modify: `skills/glab-flow/sub-skills/test-flow-apifox.md`
- Modify: `skills/glab-flow/test-config.example.md`
- Modify: `docs/flow.md`

- [x] 在提测/测试报告内容体展示 `Apifox资产审计记录`，不把自由文本资产说明作为证据。
- [x] 明确单一计划中的资产需求、目录/命名、复用优先、场景实例优先于环境复制、套件能力发现、临时 `TMP-<iid>-` 数据清理规则。
- [x] 写明 Leader 审计顺序：先 list/get 盘点 → schema 校验后受控创建/更新 → get 回读 → 生成审计评论 → 回读 Issue → 生成 TestRun；发现空场景、空套件/分组、空数据集、未处置重复/孤儿资产立即停止。
- [x] 文档中区分 Apifox 官方资源职责与团队治理扩展；不硬编码所有项目均有测试套件，不进行自动删除或未经确认的资产写入。

### Task 4: 防回归契约与完整验证

**Files:**
- Modify: `engine/src/process-contract.test.ts`
- Modify: `docs/plans/2026-08-24-multi-environment-test-runs.md`

- [x] 增加流程契约断言：资产审计 marker、四类资产、套件能力发现、临时数据生命周期、无审计则不能 TestRun、Apifox I/O 仍由 Leader 负责。
- [x] 将前一份多环境计划标记为已完成，并在本计划完成后标记本计划全部步骤。
- [x] 运行 `pnpm test`、`pnpm typecheck`、`git diff --check` 与活跃流程文档扫描；核查无引擎 I/O、无真实 Apifox 写入、无凭据泄露、无测试先行路由。

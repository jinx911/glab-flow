# 节点契约（引擎权威来源 = engine/state-machine.yaml；本表是 Leader 速查）

**Last Updated:** 2026-09-02

> **DU-first 口径：** GitLab labels 是对外生命周期投影；DU（`.glab-flow/<iid>/du.json`）是执行证据、受影响维度、GateSet、资源、指标和 `cachedNode` 的主档；state 仅是派生缓存。每次写回前先 `reconcile`，Issue 回读成功后再用 `pnpm cli du cached-node` 更新 DU，不能反过来用缓存覆盖 GitLab。

**工作产物落点**：所有 issue 文档（需求草稿 / 技术方案 `design.md` / 测试计划 / 回滚等）→ `<workspace.root>/.glab-flow/<iid>/spec/`（路径来自 config，见 `config.md`；`<iid>` 为 GitLab Issue iid）。**禁止**写进业务代码仓的 `docs/`——文档归 Docs-as-Code 工作目录，代码仓只放代码。统一文件管理规则见下方「产物文件管理」节。

## 产物文件管理（本地脚本 + Apifox 云端统一规则）

**原则**：测试证据事实源是 DU；可复跑脚本住本地 `.glab-flow/<iid>/tests/`，可共享接口资产住 Apifox。GitLab Issue 是流转真相，只展示安全摘要；脚本、报告明细、内部链接和凭据不进公共评论。

### 本地目录树与生命周期

```
<workspace.root>/.glab-flow/
├─ test-config.md               # 项目级测试配置（一次建立，跨需求复用）
├─ apifox-vars.json             # Apifox 变量文件（仅声明 Apifox 资产时使用；脚本环境走 tests/env）
├─ <iid>-state.json             # 流程状态缓存（GitLab 为真相，此为派生）
└─ <iid>/                       # 需求工作目录
   ├─ du.json                   # DU 主档（证据/资源/门禁单/指标——执行事实）
   ├─ spec/                     # 正式产物：proposal.md / design.md / test-plan.md
   │  └─ fixtures/*.sql         # 前置 seed（数据可重放的凭证，随计划保留）
   ├─ tests/                    # 本需求测试脚本（API/E2E/数据/集成均可，按环境目录或文件名隔离）
   ├─ e2e/*.spec.ts             # 兼容旧 E2E 用例目录；新用例优先放 tests/
   ├─ lessons-*.jsonl           # run 内经验采集（learn 闭环消费）
   └─ archive/                  # 过程产物唯一归档处（历史报告快照/中间文件）
```

**生命周期三阶段**：

| 阶段 | 动作 |
|---|---|
| **流转中** | 产物按树归位，**禁止散落工作区根/全局位置**；测试脚本放 `test-config` 输出的 `scripts.root`，执行报告进 DU `detailRef` 或 `archive/`；E2E 临时执行位（`playwright-report/`、`test-results/`、根 `e2e/`）跑完即清；登录态文件用后即删 |
| **终态钩子** | `resource --op cleanup` 出清单逐项处置（Apifox 侧 TMP 资产删除/升级共享）；本地的 lessons 先经 learn 升级审批再清理 |
| **终态后** | `<iid>/` 整目录**保留**（spec 是团队 Docs-as-Code 资产、du.json 是审计证据、fixtures 是数据重放凭证——Issue 关闭不等于文档作废）；仅在「同需求 reopen 重做」或 workspace 容量治理时按用户指示清理 |

### 测试脚本与 Apifox 资产治理

- **脚本归位**：本地直接写测试脚本是首选执行方式之一，但必须被 test-plan 的 `script:` 行声明，路径相对 `test-config --env <env>` 输出的 `scripts.root`；禁止在工作区根、临时目录或个人目录散放脚本。
- **环境切换**：脚本只消费 `test-config` 输出的 `webUrl`、`databases`、`testData.prefix`、`credentials`、`scripts.envFile`/`scripts.variables`；禁止在脚本里硬编码 local/test URL、账号或数据库。local/test 切换只改 `--env`。
- **数据准备**：涉及数据的 case 必须在 test-plan 声明 `data-prep:`，进入 local/test 执行前先核对 seed/fixture、数据库引用、账号、数据前缀和生命周期；数据命名要贴近真实业务（客户、合同、组织、审批单等真实语义），禁止 `test/demo/tmp` 占位名；执行产生的可复用数据默认保留在 `<iid>/spec/fixtures/` 或登记为共享候选资产。
- **证据记录**：脚本执行结果写入 DU `test-run`，`detailRef` 指向命令摘要、CI/Jenkins 报告或本地归档；Issue 只展示计划版本和通过/失败摘要。

- **资产归位**：场景按业务域、数据集按矩阵域、套件按用途（冒烟/回归/发布回归）建目录归位，不放根目录；空目录及时删（见 `sub-skills/test-design.md`）。
- **TMP → 共享升级**：`TMP-<iid>-` 临时资产上线且矩阵稳定后去前缀升级共享（终态清理清单触发）；真实数据优先升级保留，占位数据删除。
- **报告累积**：执行报告由 Apifox 云端保留（团队可查，**不在本地归档报告文件**——E4 回读后证据指针进 DU 即完成使命）；测试问题排查所需的报告详情直接给云端链接。
- **凭据持久化**：测试账密可持久化到 Apifox 环境/全局变量（已裁定），`apifox-vars.json` 相应精简为 Apifox 环境切换所需的最小集；脚本测试使用 `scripts.envFile` / `scripts.variables`。

| 节点 | 工作agent | 产出 | 门禁 | 流转写回 |
|---|---|---|---|---|
| 分诊 triage::pending | intake | 澄清问题+建议分类 | 团队确认 | type::story+草稿中, Assignee=产品 |
| 草稿中 | spec-author | 需求草稿(六清楚) | 草稿门槛 | →待评审 |
| 待评审 | review-preview | 评审意见+问题清单+图片/OCR/路由/grilling 取证 | 需求评审(二值) | 通过→已评审 / 退回→草稿中 |
| 已评审 | spec-author/architect | 技术方案 `design.md` → `.glab-flow/<iid>/spec/` | 技术方案评审(只记录)+开发门槛 | 进开发 Assignee=研发 |
| 开发中 | git-ops+codegraph+code-review | 代码+MR描述+DU local 执行事实 | 按 GateSet 要求的代码评审 + local TestRun；声明 Apifox 资产时再要 AssetAudit | →测试中或按 `skipStates` 投影到最终目标, Assignee=测试 |
| 测试中 | test-flow（按 marker 分发到脚本/Apifox/E2E） | DU test 执行事实;必要时测试问题评论 | GateSet 要求的 test TestRun；声明 Apifox 资产时再要 AssetAudit + 阻塞全验证 | →待发布, Assignee=研发 |
| 待发布 | jenkins-deploy | 执行上线(deploy) | 发布(hard_gate) | →生产验收中, Assignee=产品 |
| 生产验收中→已完成 | Leader起草终态评论 | 验收记录 | 产品验收(hard_gate·terminal) | →已完成+关闭, Assignee=产品; 反哺context/faq/cases |

Bug 流（`type::bug` + `status::*`）同构，终态责任=测试，不需要产品；详见 `engine/state-machine.yaml` 的 `bug.transitions`。Bug 的 `已确认缺陷→开发中` 是强制 GateSet 绑定边界：必须提供非空 `declaredScopes`，或已有 frozen GateSet；若有 `declaredScopes` 但 DU 尚无 frozen GateSet，首次 transition 的 `validate.ok=false`、`plan` 未定义，playbook 仅含 `bind_gateset`，不含 `issue_writeback`，因此不写 Issue 状态。Leader 执行并落盘冻结 DU 后重新运行 transition，才生成正常 WritePlan 与 Issue 写回/最终回读。

## 节点内容评论（合并评论 = 状态变更头 + 内容体）

每个节点流转写回 Issue 的**一条合并评论** = 状态变更头（变更/实际日期/确认人/结论/依据/目标节点 Assignee，由 `renderNodeComment` 渲染）+ 内容体（按节点类型，见下表）。内容体字段只渲染结构、Leader 填、**不卡流转**——门禁只卡确定事实（日期/确认人/结论/依据/Assignee，由 `requiredFields` 在校验层保证）。本地 `.glab-flow/<iid>/spec/` 仅作 AI 工作副本，不入 GitLab；团队在 Issue 评论上看到的就是正式内容。退回（G2 二值）走 `plan-return`（`renderReturn`，带问题清单），不走合并评论。

### 通用评论头模板

所有正向流转评论先渲染统一状态头：

```md
## 状态变更

- 变更：`<from>` → `<to>`
- 实际日期：<实际日期字段>
- 确认人：<产品确认人/研发Assignee/测试Assignee/具体验收人>
- 结论：<评审结论/测试结论/验收结论/验证结论>
- 依据：<需求文档或评审记录/技术方案评审记录/回归证据/发布记录/验收依据>
- 目标节点 Assignee：<@用户>
```

随后按流转追加内容体与下一步：

```md
## <内容体标题>

- <字段1>：<值>
- <字段2>：<值>

## 下一步

- 由 <@用户> 按「<to>」节点继续推进。
```

### 正向流转评论模板清单

| 类型 | 流转 | 内容体标题 | 内容体字段 |
|---|---|---|---|
| story | 草稿中 → 待评审 | 需求提案要点 | 背景、目标、范围内、范围外、核心业务规则、验收要点 |
| story | 待评审 → 已评审 | 评审意见 | 用户诉求理解、评审要点、问题清单、改进建议、交互优化建议、提单人反馈结论、修订要求；同时追加需求评审取证摘要（OCR/视觉/路由/grilling/改进建议裁定） |
| story | 已评审 → 开发中 | 技术方案 | 技术方案版本、方案概述、影响模块、数据模型变更、API契约、前端页面与路由、权限与安全、迁移与配置、测试计划摘要、计划提测时间、计划上线时间、风险与对策、回滚方案 |
| story | 开发中 → 测试中 | 提测说明 | 代码评审结论、提测日期、研发Assignee、涉及项目与开发分支、测试说明、本次改动、测试范围、环境准备与配置、测试重点、已知限制 |
| story | 开发中 → 待发布（GateSet 跳过测试中投影） | 提测说明 | 同“开发中 → 测试中”；评论头写投影后的最终目标，校验仍按原转换执行 |
| story | 测试中 → 待发布 | 测试报告与上线方案 | 测试完成日期、测试Assignee、测试结论、回归范围或证据、阻塞发布问题均已验证通过、feature分支MR评审结论、涉及项目与开发分支、业务覆盖范围、缺陷处理结果、遗留风险、上线步骤、配置清单、回滚方案、发布建议 |
| story | 待发布 → 生产验收中 | 上线操作手册 | 发布日期、研发Assignee、发布记录或回滚信息、部署顺序、数据迁移、配置清单、上线后验证、回滚方案 |
| story | 生产验收中 → 已完成 | 验收报告 | 验收完成日期、具体产品验收人、产品Assignee、验收范围、验收结论、验收依据、遗留事项、后续行动 |
| bug | 已确认缺陷 → 开发中 | 缺陷复现与根因 | 复现步骤、根因、影响范围、修复方案 |
| bug | 开发中 → 测试中 | 提测说明 | 代码评审结论、提测日期、研发Assignee、涉及项目与开发分支、测试说明、本次改动、测试范围、环境准备与配置、测试重点、已知限制 |
| bug | 开发中 → 待发布（GateSet 跳过测试中投影） | 提测说明 | 同“开发中 → 测试中”；评论头写投影后的最终目标，校验仍按原转换执行 |
| bug | 测试中 → 待发布 | 测试报告与上线方案 | 测试完成日期、测试Assignee、测试结论、回归范围或证据、阻塞发布问题均已验证通过、feature分支MR评审结论、涉及项目与开发分支、业务覆盖范围、缺陷处理结果、遗留风险、上线步骤、配置清单、回滚方案、发布建议 |
| bug | 待发布 → 生产验证中 | 上线操作手册 | 发布日期、研发Assignee、发布记录或回滚信息、部署顺序、数据迁移、配置清单、上线后验证、回滚方案 |
| bug | 生产验证中 → 已完成 | 验证报告 | 验证完成日期、具体测试验证人、测试验证人Assignee、验证范围、验证结论、验证依据、遗留事项、后续行动 |

### 退回与旁路评论模板

- **需求评审退回**：`renderReturn` 输出 `## 状态变更（退回）` + 退回目标 + 实际日期 + 确认人 + `### 问题清单（需修订）`；不走正向合并评论。
- **技术方案评审未通过**：不退回节点，停在「已评审」继续完善方案；不得写成正向流转。
- **测试中发现问题**：`renderTestIssue` 输出 `## 测试问题`，字段为发现人、发现日期、实际结果、预期结果、复现步骤/证据、研发处理人、是否阻塞发布、当前结论、验证结果；阻塞问题未验证通过不得进待发布。
- **需求/方案/测试计划变更**：`renderChangeRequest` / `change` 输出变更影响单，open 单阻断正向流转；关闭时走 `change-close` 回执。
- **补充/更正**：`renderCorrection` 仅新增 `## 补充/更正` 评论，不编辑历史评论。

每类内容体的字段槽位见 `engine/src/render.ts` 的 `NODE_CONTENT`。`mr-review` 仍在每个受影响 MR 上以独立评论给出评审结论（G14，无 CRITICAL/HIGH 残留才放行），父 Issue 汇总不能替代 MR-local 评审。

### 评审与开发门禁绑定

- **待评审→已评审**：有效的 `reviewEvidence` 是需求评审通过的前置条件；它逐图证明 OCR/视觉核查，前端需求证明页面地址的路由/组件/分流代码证据，并证明 grilling 五类分支已覆盖且无未决项。真实用户诉求理解并补齐追问后，如有更优方案或交互优化，必须与阻塞问题分离记录为 `reviewEvidence.improvements`：每条含建议、依据和提单人采纳/不采纳/暂缓结论；采纳项同步到 proposal/design/test-plan，未采纳或暂缓不阻塞通过。
- **已评审→开发中（Story）/已确认缺陷→开发中（Bug）**：两条绑定边界都把技术方案/根因声明的受影响维度传入 `transition` 的 `declaredScopes`，引擎返回 `proposedGateSet`（`skipStates`/`environments`/`mrReview`/`regression`/`rollbackPlan`/`minUnitCases`，由 `state-machine.yaml` 的 `gateMatrix` 对所有匹配维度做组合式严格推导：逐项合并门禁，取更严格的环境、回归、回滚与用例要求；规则省略字段时继承 `matrix.defaults`）。Bug 若无非空 `declaredScopes`，必须先传入已有 frozen GateSet，否则 fail-closed。GateSet 提案与计划提测/上线日期放在**同一次 L2 批量确认**；绑定首轮由 Leader 执行 `pnpm cli du` 的 `bind-gateset` 并落盘冻结 DU，不写 Issue 状态；Bug 在此首轮明确为 `validate.ok=false`、`plan` 未定义且 playbook 不含 `issue_writeback`。DU 冻结后重新运行 transition，才生成正常 WritePlan、Issue 写回与最终回读。此后 G14 等门禁按该 GateSet 生效，变化只经 `change` 棘轮扩容（只升不降）或显式改判（`overrides` 留痕），不得静默重绑。
- **需求/方案变更（区别于实施调整）**：判据——改完后 proposal/design/test-plan 里有话变假才是变更；实现缺陷修复（方案没错）是**实施调整**，不开单（开发中=自测迭代重跑 local；测试中=测试问题评论+阻塞修复+复测，见「测试中」节）。产物层偏差才走变更：不直接改旧提案、设计评论或状态标签，先调用 `change`（首选；T1–T4 自动定级 + GateSet 棘轮扩容；source=偏差从谁暴露：requirement/technical-design/implementation·test 分别建议回退 待评审/已评审/开发中）新增 open 的变更影响单，按 `requiredArtifacts` 同步 proposal/design/test-plan/Apifox 资产、代码、环境重测或发布材料；需要回退时走 `plan-return`。所有证据齐全后调用 `change-close` 新增 closed 回执。open 单存在时 G16 阻断一切正向状态流转；T3+ 测试计划变更必须递增 `plan-version`，旧 local/test 证据自动失效（T1/T2 轻量档豁免版本严格递增）。

### 写回顺序（三阶段串行）

合并评论与标签/Assignee 按严格串行写回，每阶段记 `writebackAudit`（resume 定位首个未完成）：

1. **metadata**：标签 add/unlabel + Assignee（`glab issue update`）
2. **state-comment**：合并评论（`glab issue note`，长正文 `-F <file>`）
3. **readback**：最终回读 Issue 确认；确认成功后 Leader 用 `pnpm cli du` 的 `cached-node` 将 DU 更新为本次有效最终目标，再更新 state 派生缓存
前三阶段任一失败立即停止；恢复时先回读对账，仅重试首个未完成阶段。

### 多仓库协作

一个 Issue 跨前端/PHP/Java 等多仓时，状态机仍单线推进（节点不按仓库分支），多仓维度在配置与产物层处理：

- **Jenkins**：config 用 `jenkins.jobs` 按仓映射 job + 参数（见 `config.md`）；`jenkins-deploy` 按当前操作仓库选模板。
- **待发布发布记录**：多仓发布完成后填写发布记录或回滚信息；不以各仓部署版本作为状态门槛。
- **MR**：每仓一条 feature 分支 + 一条 MR；`git-ops` 按仓操作。

### 已评审后：测试计划（唯一版本化输入）

技术方案评审完成、编码开始前，`test-design` 必须建立唯一的 `<workspace.root>/.glab-flow/<iid>/spec/test-plan.md`。它是“开发中”的二级步骤，必须早于编码和本地自测；计划以 machine-readable marker 声明版本和每个用例应执行的环境/方法。它同时是 local 与 test 的唯一输入，不能各写一套“自测计划/测试计划”。计划发生实质变化时升级 `plan-version`，旧 TestRun 随即失效。

```text
<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api,e2e
case: TP-002 | local,test | script
script: TP-002 | leave-settlement.spec.ts | pnpm test:flow -- --case TP-002
asset: TP-001 | scenario
asset: TP-001 | suite-or-group
-->
```

### 开发中→测试中：local 完整业务闭环（门禁强制）

提测说明必须先列出**涉及项目与开发分支**：每个改动仓库写成「项目：开发分支」，多项目用分号分隔；它是测试定位代码、构建来源和回归范围的最小交接信息，缺失不允许进入测试中。

提测前必须完成代码评审，并按当前 GateSet 的 `environments` 与 `regression` 要求完成 local TestRun；若 test-plan 对该环境声明了 Apifox `asset:`，还必须完成对应 AssetAudit。对所有计划标记 `local` 的用例在本地环境实际执行。**证据优先记 DU**（`transition`/`validate` 传 `payload.du`，引擎取该环境最新执行事实），Issue 评论 marker 仅作存量 Issue 的兜底解析；执行明细不进 Issue，但**执行结论以「## 证据摘要」块随流转评论自动上传**（`renderNodeComment` 从 DU 渲染：各环境计划版本与通过/失败结论、审计结论、资源数量、GateSet、指标——Issue 是团队共享的，安全摘要必须可见；报告指针与执行明细仅保留在 DU/internal record）。缺失、格式错误、计划版本不一致、脚本文件未归位、Apifox 资源未回读（仅声明资产时）、存在未处置问题、用例未通过或缺少任一要求方法的证据，均不得进入测试中。不得用“单测/构建通过”“P0 冒烟”或自由文本结论代替闭环执行记录。

只有命中的 GateSet 环境证据缺失时，playbook 才生成回归动作（`run_affected_regression` 或 `run_full_regression`）；动作使用测试计划声明的方法执行，完成后必须用 `pnpm cli du` 的 `record` 记录 DU TestRun（声明 Apifox 资产时同时记录 AssetAudit）并重新运行 `transition`。提测顺序是 feature commit → local 回归（如缺证据）→ merge/deploy；local 不得放在 merge 或部署之后。GateSet 逻辑环境当前仅支持 `local` / `test`。

0. **接口同步 Apifox**：若本次改动新增/修改了接口，**先更新 Apifox 的接口定义再往下走**——确保自测和后续测试用的是最新接口定义，而不是过时的旧版。当前方式：IDEA Apifox 插件手动更新上传（Leader 主动提醒，不靠自觉记忆）；长期方向：后端加 springdoc/scribe 生成 OpenAPI + Apifox CLI `auto-import` 定期自动拉取。
0.5. **测试上下文注入（配置送到脸上，不靠找）**：自测开始前跑一次，环境/账号/脚本根/可选 Apifox 项目/环境 ID/数据库/前端构建/测试数据前缀**一次拿全**：
   ```bash
   cat <workspace.root>/.glab-flow/test-config.md | cd "$ENGINE_ROOT" && pnpm cli test-config --repos <本次改动仓库,逗号分隔> --env local --iid <iid>
   ```
   - `--repos` 从 Issue 影响模块/spec 的「关键文件」取改动仓库；routes 按仓库推导该用的测试入口：带 `apifox` 的路由输出 Apifox 项目，不带 `apifox` 的路由表示纯脚本测试。
   - 输出的 `scripts.root` 是脚本文件统一落点；`scripts.command` / `scripts.envFile` / `scripts.variables` 是一键切换环境的运行上下文。输出的 `apifox.envId` 仅在计划声明 Apifox 资产时喂给 Apifox CLI（`--project <projectId> --environment <envId>`）；`databases.*` 查 `config.md` 的 databases 得 MCP；`testData.prefix` 已替换 iid。
   - 文件不存在 → 引导用户按 `test-config.example.md` 建一次（每项目一次），**不让自测在无测试配置下裸跑**。字段细节见 `test-config.example.md`。
1. **接口/API、E2E、数据、手工验证、脚本**：仅执行 test-plan 中对 local 声明的方法。接口和 E2E 均被计划要求时，两者都要完成；声明 `script` 时按 `script:` 的文件与命令执行；纯后端需求没有 e2e 用例时才不执行 E2E。
2. **执行环 E0–E4（test-flow 通用）**：E0 上下文注入+**本环境数据准备检查**（按 `data-prep:` 和 `testData.seedFiles` 跑前置 fixture、从本环境库取真实行值灌 fixture/数据集，禁跨环境行值；确认命名真实、生命周期与保留/升级策略已登记）→ E1 预检（三段链路/凭据/参数完备）→ E2 资产审计（仅声明 Apifox `asset:` 时）→ E3 执行脚本/Apifox/E2E → E4 回读三核（执行环境/计划版本/stats，Apifox 再核 saveDetailType/environmentName）。失败按「失败回环」分流：改代码→该环境重跑；改资产/数据→回 local 重跑；改计划→版本递增（三类改判据定是否开变更单）。
3. **资产盘点并回读**：先查现有场景、套件/场景分组、测试数据和场景实例；复用优先，只有业务步骤/断言确有差异才新建。场景按“业务域/功能能力”命名，套件/分组仅承载稳定的冒烟/模块回归/发布回归入口；环境差异用 Profile、数据集或场景实例，不复制场景。临时数据使用 `TMP-<iid>-` 前缀（`resource --op check` 强制校验），创建即 `resource --op register` 登记，需求结束前清理或升级为共享资产。对计划声明 `presentation:` 的入口，额外回读 Apifox 页面名称、目录、标签和运行环境，并与报告 `environmentName` 核对；对 `auth-profile:`，回读登录后置临时变量和统一鉴权引用，但不记录任何凭据/token 值。以 `asset-audit` 生成并回读当前环境审计（事实记 DU），空场景、空套件/分组、空数据集、重复/孤儿资产、展示漂移或未清理临时数据均停止。
4. **生成 TestRun 事实**：将每个计划用例的 `passed`、`asset-audit: v3/local` 和 API/E2E/数据/手工证据记入 DU（`kind: test-run`、`environment: local`、`planVersion`、`outcome`、`detailRef` 指向报告/明细）；存量 Issue 也可发评论 marker 后回读。门禁只认该环境最新事实：

   ```text
   <!-- glab-flow:test-run:v1
   environment: local
   plan-version: v3
   outcome: passed
   asset-audit: v3/local
   cases: TP-001=passed,TP-002=passed
   evidence: api=report:101,e2e=note:https://...,script=cmd:pnpm-test-flow
   -->
   ```

   纯脚本计划没有 Apifox `asset:` 时，TestRun 可不带 `asset-audit` 字段；但必须带 `script` 执行证据和所有计划 case 的通过结果。

自测前**核实环境可用**（URL 可达 / 数据库 MCP 可连 / 账号有效），不可用则停下来报告缺口，不臆造环境。

### 开发中→测试中：上线步骤与配置清单（必带）

提测评论的「测试说明」必须包含**上线步骤与配置清单**，区分：

- **A 类（随代码部署生效）**：migration、init 命令（如 `init:permission`）、随版本发布的配置。
- **B 类（各环境手动配置）**：菜单/权限/开关等需在后台手工设置的项——**先核查配置机制**（查模块 `config/*.php` + 平台 init 命令），不能臆测是「手动」还是「自动同步」。

配置多的需求尤其必要；缺这份清单是提测阶段最常见的返工点。

### 测试中：test 完整业务闭环（进入节点第一步，test-context 注入）

测试执行前，Leader **必须**先拿全测试上下文——不靠记忆、不翻散落配置：

1. **跑 test-context（环境/账号/脚本根/可选 Apifox 项目一次拿全）**：
   ```bash
   cat <workspace.root>/.glab-flow/test-config.md | cd "$ENGINE_ROOT" && pnpm cli test-config --repos <改动仓库> --env <候选环境> --iid <iid>
   ```
   把 `test-config.md` 里 `environments` 的候选环境列成表让用户选（AskUserQuestion：本地 local / 测试 test / …），选中环境跑上面命令（或每个候选都跑、展示对比）。输出即完备上下文：**脚本 root/命令/env 文件/变量**、账号、数据库 MCP 引用、前端构建、测试数据前缀；若路由声明 Apifox，则同时输出 Apifox 项目+环境 ID。
2. 脚本执行只消费 `scripts.*` 和环境 Profile，不硬编码 local/test；`apifox.envId` 仅在计划声明 Apifox 资产时作为 Apifox CLI 的 `--environment`；`databases.*` 查 `config.md` 的 databases 得 MCP 名；`credentials` 仅供运行时注入和内部执行记录使用，不能写入正式 Issue 评论或公共交接内容。
3. **区分三个入口**（配错则请求落错站）：登录入口 / 接口网关（Apifox 用例以 Apifox 环境 baseUrls 为准；脚本用例以 `scripts.variables`/env 文件注入为准）/ 前端入口（`webUrl`，E2E 浏览器用）。
4. **test-config.md 不存在或缺字段** → 停下引导按 `test-config.example.md` 补（每项目一次），不臆造地址、不用本地环境冒充测试环境。
5. 按 GateSet 的 `environments` 与 `regression` 执行 test 环境验证；仅当 GateSet 要求 `test` 时执行所有标记 `test` 的用例，并将 `environment: test` 的 TestRun 事实记入 DU；若计划声明 Apifox `asset:`，同步记录 AssetAudit（存量 Issue 也可发评论 marker）。`测试中→待发布` 只读取最新、同计划版本的 test 记录；不得拿 local 结果、旧计划版本或自由文本测试报告替代。
6. 测试环境执行前的预检（三段链路健康与凭据注入）见 `sub-skills/test-flow-apifox.md`。

### 测试中→待发布：MR 评审前置（G14，按 GateSet）+ 提前产出发布计划

进「待发布」的「测试报告与上线方案」也必须列出**涉及项目与开发分支**，与提测说明保持一致并覆盖本轮测试涉及的所有仓库；这让发布负责人可追溯每个 MR 与发布内容。进「待发布」前的 playbook：建 feature→master MR（标题=Issue 地址）→ `mr-review` 评审（无 CRITICAL/HIGH 残留才放行，否则修复重评）→ `release-check` **提前产生** `release-plan`（上线步骤/配置/注意事项/回滚）。提前产生计划是为了让待发布节点只剩「上线前确认 + 执行 deploy」。G14 的必填字段 `feature分支MR评审结论` 只在 DU GateSet 的 `mrReview=true` 时强制；`mrReview=false`（如 frontend-copy）豁免。若 GateSet `rollbackPlan=true`，生产发布 playbook 使用 `verify_rollback_ready` 核对这份已生成且已回读的方案，不再次调用 `release-check` 生成计划。

进入发布转换后，Leader 在**待发布→生产验收中/生产验证中**的合并评论里给出**上线操作手册**（部署顺序 / migration / 配置 / 验证 / 回滚）；这是首次要求上线步骤对团队可见的节点。

### 跳状态投影（GateSet.skipStates）

GateSet 含 `skipStates` 时，命中节点被直接投影到其下一节点（只跳一层）：如 frontend-copy 类文案需求的 GateSet `skipStates=[测试中]`，`开发中→测试中` 的转换最终落到**待发布**。`transition.next`、标签写回和合并评论头都使用这个最终目标，`next.fastestPath` 也按同一规则展示真实路径。**校验不放松**——必填字段与门禁仍按原转换（开发中→测试中）fail-closed 判定，若最终投影目标是 hard gate，还必须按投影后的目标转换校验。环境门禁按 GateSet.environments（frontend-copy 只 local）。跳状态不能绕过生产部署或终态验收等 `hard_gate`；hard_gate 仍恒 L3、必须 `humanConfirmed`，终态仍要求原子关闭。

### 转换副作用 playbook（推进节点 = 完整动作包，不只是改 Issue）

`transition` 输出的 `playbook` 把跨节点的代码侧动作和 Issue 写回打包。引擎按 config 滤除不适用步骤；相位固定为代码到位 → Issue 写回并回读。Leader 按序执行，代码侧步骤调对应 sub-skill。

| 转换 | playbook（代码侧 → Issue 写回） | 条件 |
|---|---|---|
| 开发中→测试中（提测） | commit/push feature → merge→deploy_branch → **触发 Jenkins 构建（test 参数默认值直用直接触发，缺定义无默认值才一次问全；清单进执行记录）** → 写 Issue | 必填「涉及项目与开发分支」；merge 需 `deploy_branch`；Jenkins 需 `jenkins`；生产参数确认恒 L3 |
| 测试中→待发布（测试验收） | 提 PR feature→master（标题=Issue 地址）→ **MR 评审**（mr-review，无 HIGH 残留才放行，否则修复重评）→ **release-check 产生 release-plan**（写上线步骤/配置/注意事项/回滚）→ 写 Issue | 必填「涉及项目与开发分支」；G14 必填 `feature分支MR评审结论`，仅 GateSet `mrReview=true` 时 |
| 待发布→生产验收中/生产验证中（发布） | **执行生产部署**（当前手动点击；按 release-check 上线步骤）→ 确认部署完成并写发布记录 → 写 Issue（hard_gate）= 上线完成、待产品/生产验证 | 生产部署恒存在（手动优先，无 Jenkins 条件） |
| 其它转换 | 仅写 Issue | — |

⚠️ release-check 是**发布计划**，在「测试中→待发布」产生；「发布」只**执行**该计划。**生产部署当前手动触发**（你在平台点击，完成后确认部署完成并记录发布/回滚信息）；`config.jenkins` 只管**测试环境**（提测的 `trigger_jenkins`），**生产 `deploy` 不挂 Jenkins 条件**——部署确认后必定推进 Issue。MR 在测试中→待发布**只建+评、不合**，合并/部署在「发布」。

### 节点内部子步骤 checklist（层 2 进度可见）

节点不是黑盒——`pnpm cli node` / `transition` 输出当前节点的子步骤（`progressSteps` / `nodeProgress`），Leader 据此展示「节点内做到哪了」，避免「推进到开发中后状态卡住、不知道进度」。开发中固定为「技术方案 → 测试计划 → 编码实现 → 本地自测 → 代码评审」；测试中固定为「用例执行 → 阻塞修复 → 复测」。引擎只声明 checklist（数据），子步骤执行仍由 Leader 调对应 sub-skill；done 步骤保存在 state 的 `progress` 中（引擎不驱动子步骤执行）。

| 节点 | 子步骤 |
|---|---|
| 草稿中 | 需求澄清 / 六清楚草稿 |
| 待评审 | 评审预审 / 问题清单 |
| 已评审 | 技术方案 design.md / 技术方案评审 |
| 开发中 | 技术方案 / 测试计划 / 编码实现 / 本地自测 / 代码评审 |
| 测试中 | 用例执行 / 阻塞修复 / 复测 |
| 待发布 | 发布计划就绪 / 上线前确认 |
| 生产验收中 | 生产验证 / 验收确认 |
| 生产验证中（Bug） | 生产验证 |
| 已确认缺陷（Bug） | 复现确认 / 根因定位 |
| 已完成 | — |

#### 子步骤 ↔ sub-skill 映射（Leader 标 done 的依据）

nodeProgress 子步骤与转换 playbook 是两个维度（前者 = 节点内做到哪、后者 = 这次转换做什么），并不一一对应。Leader 委派对应 sub-skill 产出后，按此映射调 `pnpm cli progress`（stdin `{state, step, now}`）标 done；换节点时用 `progress`（stdin `{state, resetToNode, now}`）重置：

| 节点.子步骤 | 执行 sub-skill / agent |
|---|---|
| 草稿中.需求澄清 | intake / spec-author |
| 草稿中.六清楚草稿 | spec-author |
| 待评审.评审预审 / 问题清单 | review-preview |
| 已评审.技术方案 design.md | spec-author（+ architect） |
| 已评审.技术方案评审 | review-preview（技术方案评审口径） |
| 开发中.技术方案 | spec-author / architect |
| 开发中.测试计划 | test-design |
| 开发中.编码实现 | git-ops + codegraph |
| 开发中.本地自测 | test-flow（按 marker 分发到脚本/Apifox/E2E） |
| 开发中.代码评审 | code-review |
| 测试中.用例执行 | test-flow（按 marker 分发到脚本/Apifox/E2E） |
| 测试中.阻塞修复 | git-ops + code-review + 实现后验证 |
| 测试中.复测 | test-flow（按 marker 分发到脚本/Apifox/E2E） |
| 待发布.发布计划就绪 | release-check |
| 待发布.上线前确认 | Leader（核对 release-check 清单） |
| 生产验收中.生产验证 / 验收确认 | Leader（按 release-check 验证） |
| 已确认缺陷.复现确认 / 根因定位 | intake / git-ops |
| 生产验证中.生产验证 | Leader（按 release-check 验证） |

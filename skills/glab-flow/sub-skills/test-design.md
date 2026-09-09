---
name: glab-flow-test-design
description: 技术方案完成后、开发开始前的测试计划设计（用例/范围/验收→测试映射），产出 test-plan.md。
---

> 本文件是 glab-flow 自有子 skill（方法论，单 Leader）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# Test Design：测试计划设计

技术方案完成后、编码开始前，Leader 执行本文件：把规格（proposal.md / design.md 的验收标准）转成一份可执行的测试计划。计划在开发中用于 local 闭环，在测试中用于 test 验收；产出是 `test-plan.md`，落到 spec 目录，不是代码。

## 测试计划产出

唯一产出物：

```
<workspace.root>/.glab-flow/<iid>/spec/test-plan.md
```

路径与 spec-author 的 proposal.md / design.md 同目录（见 `../nodes.md` 的工作产物落点约定：所有 issue 文档统一落 `.glab-flow/<iid>/spec/`，**禁止**写进代码仓的 `docs/`）。test-plan.md 是测试执行的输入——同目录的 `test-flow-apifox.md` 方法论消费它跑接口用例。

test-plan.md 须包含下列章节，缺一不可：

- **测试目标**：本计划验证什么（对齐 proposal.md 的背景与目标）。
- **测试范围**：范围内 / 范围外（明确列出不在本轮测试的模块与原因）。
- **测试环境与数据集**（集中管理入口，值不复制——只引用 test-config 索引、脚本上下文和可选 Apifox ID）：
  - **环境矩阵**：本地 / Stage 各一行——web_url、脚本 root/命令/env 文件、Apifox envId（仅声明资产时）、凭据变量名（`credentials.vars`，值在 apifox-vars.json 或运行时 env 文件）、数据前缀（`E2E{iid}L/T`）、数据库 MCP 引用。
  - **场景 ↔ 数据集映射表**：每行 `场景 ID | 场景名 | 环境 | testDataId/fixture | 数据集名`——**环境列必填**（每环境一行）：行值来自本环境真实库时两环境各一条（各自的 testDataId/fixture）；仅当行值在两环境库都真实存在才可共用一份（映射表合并为一行标「共用」）。执行时按当前环境取对应行，杜绝拿 local 数据集跑 test 轮。
  - **前置 fixture**：哪些场景需先跑哪条 SQL seed（`fixtures/*.sql`），跑的顺序；涉及数据准备的 case 必须声明 `data-prep:`，写清数据来源、真实业务命名和生命周期（preserve/shared-candidate/temporary）。
- **用例清单**：按用例编号、标题、类型（unit/integration/e2e/API）、步骤、预期、关联验收标准。
- **验收标准 → 测试条目映射**：proposal.md 的每条 AC（AC1/AC2…）都映射到至少一个测试条目编号，确保无遗漏。
- **边界与异常用例**：空值、越界、非法输入、并发、大流量、权限越权等显式列出。
- **测试数据与前置条件**：依赖的账号、数据、环境状态。

文件顶部必须带引擎可读取的唯一计划版本；每个用例声明必须执行的环境和方法。示例：

```text
<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api,e2e
case: TP-002 | local,test | api,data
asset: TP-001 | scenario
asset: TP-001 | suite-or-group
asset: TP-002 | scenario
asset: TP-002 | test-data
data-prep: TP-002 | fixtures/华东客户合同续费.sql | 华东客户合同续费审批数据 | shared-candidate
-->
```

- `case` 的 ID 必须对应「用例清单」中的条目；`local,test` 表示同一条用例两环境都要跑，不能用不同计划绕过某个环境。
- 计划内容、覆盖范围或方法发生实质变化时递增 `plan-version`；旧版本的 TestRun 立即失效，必须按新计划重跑。
- 纯后端需求没有 UI 验收时不写 `e2e`；不要为了“每环境都跑 E2E”伪造无意义用例。
- 每个 `api` case 必须声明 Apifox `scenario`；每个 `script` case 必须声明 `script: <case> | <relative-path> | <command>`；每个 `data` case 必须声明 `data-prep: <case> | <relative-source> | <realistic-name> | <preserve|shared-candidate|temporary>`。仅在当前项目实际使用聚合入口、数据集或保存运行配置时声明 `suite-or-group`、`test-data`、`scenario-instance`。套件能力以当前 Apifox UI/CLI 回读为准，不假定所有项目都有该功能。

## 本地测试脚本治理

- 脚本文件统一放在 `pnpm cli test-config --env <env>` 输出的 `scripts.root` 下，路径在 test-plan marker 中写相对路径；禁止写绝对路径、`..`、工作区根临时脚本或个人目录。
- 同一条 case 在 local/test 可复用同一脚本，环境差异通过 `scripts.envFile`、`scripts.variables`、`webUrl`、`testData.prefix` 和数据库引用注入；脚本内部不得硬编码 local/test URL、账号、数据库或真实业务行值。
- 计划 marker 示例：
  ```text
  case: TPS010 | local,test | script
  script: TPS010 | leave-settlement.spec.ts | pnpm test:flow -- --case TPS010
  data-prep: TPS010 | fixtures/华东客户合同续费.sql | 华东客户合同续费审批数据 | shared-candidate
  ```
- 脚本执行通过 DU `test-run` 记录：`evidence.script` 写命令/CI 报告摘要，涉及数据准备时 `evidence.data` 写 seed/fixture/数据库核对摘要，`detailRef` 指向报告或归档。纯脚本 case 不要求 Apifox AssetAudit。
- 数据必须先准备再执行：进入 local/test 运行前，按 `data-prep:` 和 `test-config.testData.seedFiles` 检查 seed 文件、数据库引用、账号、数据前缀、真实命名和生命周期；缺一项即停止补配置/补 fixture，不允许边跑边猜数据。

## Apifox 资产治理

- 场景按“业务域 / 功能能力”组织，名称表达稳定业务流程；先检索、复用、引用或更新，禁止按 Issue/环境复制流程。**检索先查 workspace 资产目录**（`cli catalog --op search`，`.glab-flow/asset-catalog.md`——业务域/关键词过滤直接得 apifoxId），命中候选再对 Apifox `get` 回读确认；目录未命中才全量 list 兜底。新建共享资产或终态 TMP→共享升级时 `catalog --op upsert` 登记进目录（域/名称/ID/覆盖描述/最后验证版本）。
- 套件或场景分组按稳定执行目的组织：提交冒烟、模块回归、发布回归、定期巡检；不为每个需求叠加新入口，且必须回读成员非空。
- 测试数据承载变量化输入和边界矩阵，环境差异保持同变量名不同值；数据设计必须满足下方「数据真实性铁律」。
- 同一流程只在运行环境、数据集或循环次数上不同，优先使用 Apifox 场景实例；只有步骤或断言确有差异才新建场景。

## 数据真实性铁律（测试数据是长期资产，不是用完即弃）

测试数据会被**保留沉淀**为后续需求的回归资产——假数据沉淀下来就是长期毒资产（后续复用必假失败）。设计阶段必须满足：

1. **行值必须来自本环境真实库**：从该环境的数据库（test-config 的 `databases` MCP）取真实存在的行值——员工号、单号、供应商 ID 等业务键编造必导致 code≠0 假失败。查库取证过程记入 test-plan「测试数据与前置条件」节。
2. **环境具体化，禁跨环境行值**：每个环境的数据集从**本环境库**取行值（local 库的员工号在 test 库不存在）。矩阵稳定前按环境各建一份同名数据集（环境属性区分）；禁止拿别环境行值跑本环境。
3. **有前置 seed 先跑 fixture**：依赖前置状态的场景（库存初始化、权限开通、历史单据）在 test-plan「前置 fixture」节声明 SQL（`fixtures/*.sql` + 执行顺序）；执行环 E0 按序跑 fixture 后再灌数据集。
4. **保留数据必须可重放**：要沉淀的数据（非 TMP）必须真实且可被后续需求复用——fixture SQL 完整记录在 test-plan，让回归环境可重建；数据行只追加不覆盖语义（重灌先删旧行）。
5. **沉淀生命周期**：临时数据 `TMP-<iid>-` 前缀创建即 `resource --op register` 登记；需求上线且矩阵稳定后**升级为共享资产**（去 TMP 前缀、目录归位到矩阵域）——终态清理清单（`resource --op cleanup`）对每项给出「删除 / 升级共享 / 保留说明」三选，升级动作即在此发生。真实数据优先升级保留，占位/一次性数据删除。

## 设计要点

### 契约预检（建用例之前必做）

对涉及的每个接口：读 Apifox 响应定义 → 用最小真实请求核对 Schema 类型/可空性与实际一致（Long 序列化为 string、字段可空等漂移会造成批量假失败）→ 预期会出现的 HTTP 状态码（如越权 404）若文档没有对应 response，**先补接口文档再建用例**。禁止关闭响应校验绕过不一致。结论记入 test-plan.md「契约预检」节。

### 用例覆盖（三类 + API）

| 类型 | 范围 | 目标 |
|---|---|---|
| Unit | 单函数/方法，依赖 mock | 覆盖核心逻辑分支 |
| Integration | 端点、DB、跨模块 | 覆盖组装后的行为 |
| E2E | 关键用户流程 | 覆盖上线即用户可见的路径 |
| API | 接口契约（请求/响应/错误码） | 可由 Apifox 资产或受管脚本执行；以 test-plan marker 为准 |

API 用例在设计阶段列「用例描述 + 期望契约 + 执行入口」。新增/变更公共接口契约优先声明 Apifox `asset:`；复杂业务闭环、跨仓环境准备或需要更快本地反馈时，声明 `script:` 并把 HTTP/curl/runner 封装成受管脚本。禁止散落临场 curl：只要作为门禁证据，就必须在 test-plan 中声明 `script:` 并放入 `scripts.root`。

### 测试范围

范围按 proposal.md 的「影响模块」+ design.md 的「关键文件」推导。新增表 / 新端点 / 状态机变更 / 权限规则 必纳入范围；纯重构且行为不变的可标范围外并说明理由。回归范围覆盖受影响模块的既有功能，不只测新功能。

### 验收标准 → 测试条目映射

每条 AC 至少一个测试条目，映射关系以表格形式给出：

```
| AC | 测试条目 | 类型 | 备注 |
|----|---------|------|------|
| AC1 | T01-价格计算-正常折扣 | unit | — |
| AC1 | T02-价格计算-负数输入返回0 | unit | 边界 |
| AC2 | T03-下单接口-成功 | API | asset: Apifox 场景 或 script: 受管脚本 |
```

无映射的 AC 视为遗漏，必须补测试条目或显式标注「本轮不测 + 理由」。

### 边界与异常用例

显式列出，不靠开发者临场判断：null/空集合、越界值（min/max）、非法类型、并发与重复提交、外部依赖失败（超时、错误码）、大数据量、特殊字符（Unicode/路径穿越）。异常路径与 happy path 同等对待，每条至少一个用例。

## API 测试

接口测试的设计（用例 + 期望契约 + 执行入口）写进 test-plan.md。声明 `asset:` 时，执行交给 `test-flow-apifox.md` 并需要 AssetAudit；声明 `script:` 时，执行交给脚本运行上下文并只要求 TestRun。运行时工具清单见 `../tools.md`。test-design 不直接调用 Apifox 或脚本 runner，只产出可执行、可审计的计划。

## E2E 测试（前端 UI 流）

UI 渲染、弹窗文案、按钮显隐分支、交互时序这类验收标准，单测和代码评审抓不到——**必须标 `e2e` 策略**，由同目录 `test-flow-e2e.md` 经 e2e-runner / Playwright 真实点击执行。设计阶段在 test-plan.md 里列「场景 + 步骤 + 预期（可见性/文案/显隐）」，执行委托 test-flow-e2e，不在 test-plan.md 里手写浏览器脚本。覆盖范围参考 design.md 的「路由分流核查」——多套实现（web/mobile/租户灰度）都要有用例，不能只测一套。

## 套件跨环境规则（同一计划，参数可不同）

- **环境维度二分（判定口诀）**：环境改变的是**执行参数**（base_url/账号/数据前缀/供应商映射）→ 同套件 `-e` 切，不复制；工具或数据准备确有差异时可分目录/套件，但必须仍覆盖同一 test-plan 中该环境要求的 case，不能以“开发自测覆盖面较小”少跑计划用例。
- **禁止的是**:同一逻辑**复制 N 份仅参数不同**的场景/套件(那意味着改用例要改 N 处)——这类一律收敛为一份 + `-e` + `--variables` 文件。
- **环境切换 = 运行时**:同一测试计划,执行时只切 `test-config --env`。脚本测试使用 `scripts.command` + `scripts.env_file` / `scripts.variables`；Apifox 资产使用 `-e <envId> --variables <vars文件>`（test-context 的 apifoxTargets[].envId + test-config 的 variables_file）。每环境各跑一次各出报告，场景/脚本逻辑零改动。
- **参数三轴归位**(判定口诀):随环境轴变(每环境一值)→ `scripts.env_file` / `scripts.variables` 或 apifox-vars.json;随轮次轴变(同环境 N 值,矩阵)→ fixture/数据集（Apifox 可用云端数据集 `-d <testDataId>`，开发中可先本地行文件过渡）;不变 → 写死在 case。账号和业务参数走同一机制,不按参数种类分。
- **数据资产化**：测试数据必须贴近真实业务：字段组合、状态、金额/日期/组织层级/权限角色要能代表真实场景；命名使用业务语义（如“华东客户合同续费审批数据”），禁止 `test/demo/tmp/foo` 这类占位名。执行产生的可复用数据默认 `preserve` 或 `shared-candidate`，终态进入资源清单/资产目录；只有明确污染性、一次性数据才 `temporary` 并设计清理。
- **登录 = 共用契约**:所有项目从 test-config `login.owner` 项目持有的登录接口拿 token(`{{login.token_var}}`),后置提取注入后续步骤;不为每个项目各写一套登录。登录后置三件事（断言成功+提取 token+业务统一 `Bearer`）与多角色多 profile 规则见 `test-flow-apifox.md`「登录处理契约」。
- **AuthProfile = 可审计复用**：每条需认证 case 在计划 marker 中声明 `auth-profile: <case> | <profile>`；登录后置同时断言成功、提取命名**临时** token，后续请求统一引用 `Bearer {{token}}`。账号、密码和 token 值只存在于运行时变量文件；401/403 保留为失败，不能静默重新登录掩盖问题。
- **前后置脚本随场景设计**：需要认证链/随机单号/响应值下游引用/有副作用需清理的场景，在计划「用例步骤」里明确前置/后置脚本职责（备数据/提取/断言/清理），建模按 `test-flow-apifox.md`「前置/后置脚本使用规则」执行；**有副作用的场景必须设计清理步骤**（TMP 单据删除/状态回滚），不留污染。
- **页面展示 = 验收数据**：每个环境验收入口在计划 marker 增加 `presentation: <case> | <asset-type>`。执行后必须核对 Apifox 列表/详情中的名称、目录、标签、运行环境，并使之与该入口的报告环境相同；跨环境基础场景不能以页面显示的单一 local 值冒充 Stage 验收。
- **目录规范（官方分组用法）**：场景目录按「需求 → 功能域 →（环境子目录，仅当执行工具不同）」；套件目录按「需求域 → 用途（local/test/专项矩阵）」。场景/套件**不放根目录**——建了目录必须归位(`folder-id`)，空目录及时删。

## glab-flow 上下文

- **节点归属**：技术方案完成后、开发开始前。Leader Read 本文件内联执行；产出 `test-plan.md` 落 `.glab-flow/<iid>/spec/`，并在每次 `transition` 传入当前文本。local/test 各自的 TestRun 是后续门禁输入。
- **单 Leader**：不组建多 agent 团队，不引入团队编排、阶段闸门或状态机管道。需要探索时 spawn 至多一个 `general-purpose`。
- **测试问题挂评论**：测试执行中发现的问题挂父 GitLab Issue 评论（`glab issue note`，见 `../gate.md`）。**阻塞发布的问题须全部验证通过才放行待发布**（G11，见 `../guards.md`）——test-design 产出的用例是「全部验证」的依据，遗漏会导致门禁不放行。
- **门禁对齐**：test-plan.md 是 local 与 test 两道门禁的共同输入（见 `../nodes.md` / `../gate.md`）；计划缺失、marker 无效或 AC 未全覆盖 → Leader 不推进状态。

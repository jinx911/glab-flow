# 节点契约（引擎权威来源 = engine/state-machine.yaml；本表是 Leader 速查）

**工作产物落点**：所有 issue 文档（需求草稿 / 技术方案 `design.md` / 测试计划 / 回滚等）→ `<workspace.root>/.glab-flow/<iid>/spec/`（路径来自 config，见 `config.md`；`<iid>` 为 GitLab Issue iid）。**禁止**写进代码仓（oa-service / oa-platform 等）的 `docs/`——文档归 Docs-as-Code 工作目录，代码仓只放代码。统一存储树见 spec §7。

| 节点 | 工作agent | 产出 | 门禁 | 流转写回 |
|---|---|---|---|---|
| 分诊 triage::pending | intake | 澄清问题+建议分类 | 团队确认 | type::story+草稿中, Assignee=产品 |
| 草稿中 | spec-author | 需求草稿(六清楚) | 草稿门槛 | →待评审 |
| 待评审 | review-preview | 评审意见+问题清单+图片/OCR/路由/grilling 取证 | 需求评审(二值) | 通过→已评审 / 退回→草稿中 |
| 已评审 | spec-author/architect | 技术方案 `design.md` → `.glab-flow/<iid>/spec/` | 技术方案评审(只记录)+开发门槛 | 进开发 Assignee=研发 |
| 开发中 | git-ops+codegraph+code-review | 代码+MR描述+local 执行记录 | 代码评审 + local TestRun | →测试中, Assignee=测试 |
| 测试中 | test-flow-apifox/test-flow-e2e | test 执行记录;测试问题评论 | test TestRun + 阻塞全验证 | →待发布, Assignee=研发 |
| 待发布 | jenkins-deploy | 执行上线(deploy) | 发布(hard_gate) | →生产验收中, Assignee=产品 |
| 生产验收中→已完成 | Leader起草终态评论 | 验收记录 | 产品验收(hard_gate·terminal) | →已完成+关闭, Assignee=产品; 反哺context/faq/cases |

Bug 流（`type::bug` + `status::*`）同构，终态责任=测试，不需要产品；详见 `engine/state-machine.yaml` 的 `bug.transitions`。

## 节点内容评论（合并评论 = 状态变更头 + 内容体）

每个节点流转写回 Issue 的**一条合并评论** = 状态变更头（变更/实际日期/确认人/结论/依据/目标节点 Assignee，由 `renderNodeComment` 渲染）+ 内容体（按节点类型，见下表）。内容体字段只渲染结构、Leader 填、**不卡流转**——门禁只卡确定事实（日期/确认人/结论/依据/Assignee，由 `requiredFields` 在校验层保证）。本地 `.glab-flow/<iid>/spec/` 仅作 AI 工作副本，不入 GitLab；团队在 Issue 评论上看到的就是正式内容。退回（G2 二值）走 `plan-return`（`renderReturn`，带问题清单），不走合并评论。

| 节点流转 | 内容体标题 |
|---|---|
| 草稿中→待评审 | 需求提案要点 |
| 待评审→已评审 | 评审意见（通过）/ 退回带问题清单 |
| 已评审→开发中 | 技术方案 |
| 开发中→测试中 | 提测说明 |
| 测试中→待发布 | 测试报告 |
| 待发布→生产验收中/验证中 | 上线操作手册 |
| 生产验收中→已完成 | 验收报告 |
| 生产验证中→已完成（bug） | 验证报告 |
| 已确认缺陷→开发中（bug） | 缺陷复现与根因 |

每类内容体的字段槽位见 `engine/src/render.ts` 的 `NODE_CONTENT`。`mr-review` 仍在每个受影响 MR 上以独立评论给出评审结论（G14，无 CRITICAL/HIGH 残留才放行），父 Issue 汇总不能替代 MR-local 评审。

### Story 周排期契约（Harness 读取）

- **待评审→已评审**：在同一条「状态变更头 + 内容体」合并评论中追加一次完整 `## 周排期` 与 `## 需求评审取证` 区块。有效的 `weekPlan` 和 `reviewEvidence` 是需求评审通过的前置条件；后者逐图证明 OCR/视觉核查，前端需求证明页面地址的路由/组件/分流代码证据，并证明 grilling 五类分支已覆盖且无未决项。`计划覆盖周`由引擎推导，Leader 不手填或推测。
- **已评审→开发中**：除技术方案与既有计划提测/上线字段外，必须从刚回读的 Issue notes 验证**最新** `## 周排期` 区块。最新区块可为「启用」或「暂停」，但必须完整有效；最新无效或缺失就停止，不能用旧排期回退放行。
- **排期变更**：不推进节点。用 `week-plan-change` 只新增一条 `## 排期变更` + replacement `## 周排期` 评论，不改标签、Assignee、Issue 正文或历史评论；评论回读成功后，再执行一次 Week Milestone 同步。
- **需求/方案变更**：不直接改旧提案、设计评论或状态标签。先调用 `change-impact` 新增 open 的变更影响单，按 `requiredArtifacts` 同步 proposal/design/test-plan/Apifox 资产、代码、环境重测、排期或发布材料；需要回退时走 `plan-return`。所有证据齐全后调用 `change-close` 新增 closed 回执。open 单存在时 G16 阻断一切正向状态流转；测试计划变更必须递增 `plan-version`，旧 local/test 证据自动失效。

**初始挂载与 rollover 分工**：Leader 是周内初始挂载的执行者，Harness 周一任务是后续跨周 rollover 的执行者。引擎只在 `plan.postWriteback` 声明 `sync_week_milestone`，没有 GitLab I/O 或 Milestone `WriteOp`。Leader 只能在状态/排期评论已回读后，按最新有效且启用的计划幂等创建目标 Week Milestone 或关联 Issue；标题遵循 Harness 的 `Week YYYY-Www`，其起止日期为目标 ISO 周的周一/周日。不得修改 Issue 状态、Assignee、正文或评论。同步失败只记 `week-milestone-sync` 审计并重试，不回滚已确认的状态或排期。

### 写回顺序（三阶段串行）

合并评论与标签/Assignee 按严格串行写回，每阶段记 `writebackAudit`（resume 定位首个未完成）：

1. **metadata**：标签 add/unlabel + Assignee（`glab issue update`）
2. **state-comment**：合并评论（`glab issue note`，长正文 `-F <file>`）
3. **readback**：最终回读 Issue 确认
4. **week-milestone-sync（条件动作）**：仅 `plan.postWriteback` 存在时执行；以 Asia/Shanghai 业务日期决定目标周，记录成功或失败审计

前三阶段任一失败立即停止；Milestone 同步失败不撤回前三阶段，恢复时先回读对账，仅重试 `week-milestone-sync`。

### 多仓库（OA 常态）

一个 Issue 跨前端/PHP/Java 等多仓时，状态机仍单线推进（节点不按仓库分支），多仓维度在配置与产物层处理：

- **Jenkins**：config 用 `jenkins.jobs` 按仓映射 job + 参数（见 `config.md`）；`jenkins-deploy` 按当前操作仓库选模板。
- **待发布「生产版本」**：多仓时填**各仓部署版本**（分号分隔，如 `oa-service:v1.2; oa-frontend:v3.4`），不再是单一版本号。
- **MR**：每仓一条 feature 分支 + 一条 MR；`git-ops` 按仓操作。

### 已评审后：测试计划（唯一版本化输入）

技术方案评审完成、编码开始前，`test-design` 必须建立唯一的 `<workspace.root>/.glab-flow/<iid>/spec/test-plan.md`。它是“开发中”的二级步骤，必须早于编码和本地自测；计划以 machine-readable marker 声明版本和每个用例应执行的环境/方法。它同时是 local 与 test 的唯一输入，不能各写一套“自测计划/测试计划”。计划发生实质变化时升级 `plan-version`，旧 TestRun 随即失效。

```text
<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api,e2e
asset: TP-001 | scenario
asset: TP-001 | suite-or-group
-->
```

### 开发中→测试中：local 完整业务闭环（门禁强制）

提测前必须完成代码评审、当前 test-plan 的 local Apifox 资产审计，并对所有标记 `local` 的用例在本地环境实际执行。引擎从刚回读的 Issue 评论读取**最新**审计与 local TestRun；缺失、格式错误、计划版本不一致、资源未回读、存在未处置问题、用例未通过或缺少任一要求方法的证据，均不得进入测试中。不得用“单测/构建通过”“P0 冒烟”或自由文本结论代替闭环执行记录。

0. **接口同步 Apifox**：若本次改动新增/修改了接口，**先更新 Apifox 的接口定义再往下走**——确保自测和后续测试用的是最新接口定义，而不是过时的旧版。当前方式：IDEA Apifox 插件手动更新上传（Leader 主动提醒，不靠自觉记忆）；长期方向：后端加 springdoc/scribe 生成 OpenAPI + Apifox CLI `auto-import` 定期自动拉取。
0.5. **测试上下文注入（配置送到脸上，不靠找）**：自测开始前跑一次，环境/账号/Apifox 项目/环境 ID/数据库/前端构建/测试数据前缀**一次拿全**：
   ```bash
   cat <workspace.root>/.glab-flow/test-config.md | cd "$ENGINE_ROOT" && pnpm cli test-config --repos <本次改动仓库,逗号分隔> --env local --iid <iid>
   ```
   - `--repos` 从 Issue 影响模块/spec 的「关键文件」取改动仓库；routes 按仓库推导该用的 **Apifox 项目**（如 oa-platform+前端→oa_platform，oa-service→oa_service），不用记。
   - 输出的 `apifox.envId` 直接喂 Apifox CLI（`--project <projectId> --environment <envId>`）；`databases.*` 查 `config.md` 的 databases 得 MCP；`testData.prefix` 已替换 iid。
   - 文件不存在 → 引导用户按 `test-config.example.md` 建一次（每项目一次），**不让自测在无测试配置下裸跑**。字段细节见 `test-config.example.md`。
1. **接口/API、E2E、数据、手工验证**：仅执行 test-plan 中对 local 声明的方法。接口和 E2E 均被计划要求时，两者都要完成；纯后端需求没有 e2e 用例时才不执行 E2E。
2. **执行环境与版本**：先执行 `test-config --env local`，完成三段链路健康检查和本地运行版本校验；API 与 E2E 执行细节分别遵循 `sub-skills/test-flow-apifox.md` / `sub-skills/test-flow-e2e.md`。
3. **资产盘点并回读**：先查现有场景、套件/场景分组、测试数据和场景实例；复用优先，只有业务步骤/断言确有差异才新建。场景按“业务域/功能能力”命名，套件/分组仅承载稳定的冒烟/模块回归/发布回归入口；环境差异用 Profile、数据集或场景实例，不复制场景。临时数据使用 `TMP-<iid>-` 前缀，需求结束前清理或升级为共享资产。对计划声明 `presentation:` 的入口，额外回读 Apifox 页面名称、目录、标签和运行环境，并与报告 `environmentName` 核对；对 `auth-profile:`，回读登录后置临时变量和统一鉴权引用，但不记录任何凭据/token 值。以 `asset-audit` 生成并回读当前环境审计，空场景、空套件/分组、空数据集、重复/孤儿资产、展示漂移或未清理临时数据均停止。
4. **生成并回读 TestRun**：将每个计划用例的 `passed`、代码版本、`asset-audit: v3/local` 和 API/E2E/数据/手工证据生成 marker，新增到 Issue 后立刻回读；只认可最新 local marker：

   ```text
   <!-- glab-flow:test-run:v1
   environment: local
   plan-version: v3
   version: service:abc123
   outcome: passed
   asset-audit: v3/local
   cases: TP-001=passed
   evidence: api=report:101,e2e=note:https://...
   -->
   ```

自测前**核实环境可用**（URL 可达 / 数据库 MCP 可连 / 账号有效），不可用则停下来报告缺口，不臆造环境。

### 开发中→测试中：上线步骤与配置清单（必带）

提测评论的「测试说明」必须包含**上线步骤与配置清单**，区分：

- **A 类（随代码部署生效）**：migration、init 命令（如 `init:permission`）、随版本发布的配置。
- **B 类（各环境手动配置）**：菜单/权限/开关等需在后台手工设置的项——**先核查配置机制**（查模块 `config/*.php` + 平台 init 命令），不能臆测是「手动」还是「自动同步」。

配置多的需求尤其必要；缺这份清单是提测阶段最常见的返工点。

### 测试中：test 完整业务闭环（进入节点第一步，test-context 注入）

测试执行前，Leader **必须**先拿全测试上下文——不靠记忆、不翻散落配置：

1. **跑 test-context（环境/账号/Apifox 项目一次拿全）**：
   ```bash
   cat <workspace.root>/.glab-flow/test-config.md | cd "$ENGINE_ROOT" && pnpm cli test-config --repos <改动仓库> --env <候选环境> --iid <iid>
   ```
   把 `test-config.md` 里 `environments` 的候选环境列成表让用户选（AskUserQuestion：本地 local / 测试 test / …），选中环境跑上面命令（或每个候选都跑、展示对比）。输出即完备上下文：**Apifox 项目+环境 ID**（routes 按改动仓库推导，不用记该用 oa_platform 还是 oa_service）、账号、数据库 MCP 引用、前端构建、测试数据前缀。
2. `apifox.envId` 直接作为 Apifox CLI 的 `--environment`；`databases.*` 查 `config.md` 的 databases 得 MCP 名；`credentials` 为本轮测试账号，写进测试报告（见内容体 keys）。
3. **区分三个入口**（配错则请求落错站）：登录入口 / 接口网关（API base 以 Apifox 环境的 baseUrls 为准，不复制进本地配置）/ 前端入口（`webUrl`，E2E 浏览器用）。
4. **test-config.md 不存在或缺字段** → 停下引导按 `test-config.example.md` 补（每项目一次），不臆造地址、不用本地环境冒充测试环境。
5. 以同一份当前 test-plan 盘点、回读 test 环境的资产后执行所有标记 `test` 的用例，并新增且回读 `environment: test` 的 AssetAudit 与 TestRun。`测试中→待发布` 只读取最新 test 记录；不得拿 local 结果、旧计划版本或自由文本测试报告替代。
6. 测试环境执行前的预检（三段链路健康 / 运行版本）与凭据注入规则见 `sub-skills/test-flow-apifox.md`。

### 测试中→待发布：MR 评审前置（G14）+ 提前产出发布计划

进「待发布」前的 playbook：建 feature→master MR（标题=Issue 地址）→ `mr-review` 评审（无 CRITICAL/HIGH 残留才放行，否则修复重评）→ `release-check` **提前产生** `release-plan`（上线步骤/配置/注意事项/回滚）。提前产生计划是为了让待发布节点只剩「上线前确认 + 执行 deploy」。

进入发布转换后，Leader 在**待发布→生产验收中/生产验证中**的合并评论里给出**上线操作手册**（部署顺序 / migration / 配置 / 验证 / 回滚）；这是首次要求上线步骤对团队可见的节点。

### 转换副作用 playbook（推进节点 = 完整动作包，不只是改 Issue）

`transition` 输出的 `playbook` 把跨节点的代码侧动作、Issue 写回和条件性回读后同步打包。引擎按 config 滤除不适用步骤；相位固定为代码到位 → Issue 写回并回读 → Week Milestone 同步（如存在 `postWriteback`）。Leader 按序执行，代码侧步骤调对应 sub-skill。

| 转换 | playbook（代码侧 → Issue 写回） | 条件 |
|---|---|---|
| 开发中→测试中（提测） | commit/push feature → merge→deploy_branch → **触发 Jenkins 构建（交互问 job/分支/test_version/DEPLOY_ENV/force_package 等参数 → 清单确认）** → 写 Issue | merge 需 `deploy_branch`；Jenkins 需 `jenkins`；**参数确认独立于 run_mode** |
| 测试中→待发布（测试验收） | 提 PR feature→master（标题=Issue 地址）→ **MR 评审**（mr-review，无 HIGH 残留才放行，否则修复重评）→ **release-check 产生 release-plan**（写上线步骤/配置/注意事项/回滚）→ 写 Issue | G14 必填 `feature分支MR评审结论` |
| 待发布→生产验收中/生产验证中（发布） | **执行生产部署**（当前手动点击；按 release-check 上线步骤）→ 确认部署版本 → 写 Issue（hard_gate）= 上线完成、待产品/生产验证 | 生产部署恒存在（手动优先，无 Jenkins 条件） |
| 其它转换 | 仅写 Issue | — |

⚠️ release-check 是**发布计划**，在「测试中→待发布」产生；「发布」只**执行**该计划。**生产部署当前手动触发**（你在平台点击，完成后把生产版本号告诉 Leader）；`config.jenkins` 只管**测试环境**（提测的 `trigger_jenkins`），**生产 `deploy` 不挂 Jenkins 条件**——部署确认后必定推进 Issue。MR 在测试中→待发布**只建+评、不合**，合并/部署在「发布」。

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
| 开发中.本地自测 | test-flow-apifox / test-flow-e2e（实现后验证） |
| 开发中.代码评审 | code-review |
| 测试中.用例执行 | test-flow-apifox / test-flow-e2e |
| 测试中.阻塞修复 | git-ops + code-review + 实现后验证 |
| 测试中.复测 | test-flow-apifox / test-flow-e2e |
| 待发布.发布计划就绪 | release-check |
| 待发布.上线前确认 | Leader（核对 release-check 清单） |
| 生产验收中.生产验证 / 验收确认 | Leader（按 release-check 验证） |
| 已确认缺陷.复现确认 / 根因定位 | intake / git-ops |
| 生产验证中.生产验证 | Leader（按 release-check 验证） |

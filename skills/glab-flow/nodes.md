# 节点契约（引擎权威来源 = engine/state-machine.yaml；本表是 Leader 速查）

**工作产物落点**：所有 issue 文档（需求草稿 / 技术方案 `design.md` / 测试计划 / 回滚等）→ `<workspace.root>/.glab-flow/<iid>/spec/`（路径来自 config，见 `config.md`；`<iid>` 为 GitLab Issue iid）。**禁止**写进代码仓（oa-service / oa-platform 等）的 `docs/`——文档归 Docs-as-Code 工作目录，代码仓只放代码。统一存储树见 spec §7。

| 节点 | 工作agent | 产出 | 门禁 | 流转写回 |
|---|---|---|---|---|
| 分诊 triage::pending | intake | 澄清问题+建议分类 | 团队确认 | type::story+草稿中, Assignee=产品 |
| 草稿中 | spec-author | 需求草稿(六清楚) | 草稿门槛 | →待评审 |
| 待评审 | review-preview | 评审意见+问题清单 | 需求评审(二值) | 通过→已评审 / 退回→草稿中 |
| 已评审 | spec-author/architect | 技术方案 `design.md` → `.glab-flow/<iid>/spec/` | 技术方案评审(只记录)+开发门槛 | 进开发 Assignee=研发 |
| 开发中 | git-ops+tdd-guide+codegraph | 代码+MR描述+自测 | 代码评审与自测 | →测试中, Assignee=测试 |
| 测试中 | test-design/test-flow-apifox/test-flow-e2e | 测试计划;测试问题评论 | 测试验收(阻塞全验证) | →待发布, Assignee=研发 |
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

### 写回顺序（三阶段串行）

合并评论与标签/Assignee 按严格串行写回，每阶段记 `writebackAudit`（resume 定位首个未完成）：

1. **metadata**：标签 add/unlabel + Assignee（`glab issue update`）
2. **state-comment**：合并评论（`glab issue note`，长正文 `-F <file>`）
3. **readback**：最终回读 Issue 确认

任一阶段失败立即停止；恢复时先回读对账，仅重试首个未完成阶段。

### 多仓库（OA 常态）

一个 Issue 跨前端/PHP/Java 等多仓时，状态机仍单线推进（节点不按仓库分支），多仓维度在配置与产物层处理：

- **Jenkins**：config 用 `jenkins.jobs` 按仓映射 job + 参数（见 `config.md`）；`jenkins-deploy` 按当前操作仓库选模板。
- **待发布「生产版本」**：多仓时填**各仓部署版本**（分号分隔，如 `oa-service:v1.2; oa-frontend:v3.4`），不再是单一版本号。
- **MR**：每仓一条 feature 分支 + 一条 MR；`git-ops` 按仓操作。

### 开发中→测试中：自测（门禁强制，层次化）

提测前必须自测——门禁强制 `代码评审结论` + `自测计划` + `接口自测结论` 三个字段非空，不能只填一个"结论"跳过。自测有层次（缩小版 test-flow）：

0. **接口同步 Apifox**：若本次改动新增/修改了接口，**先更新 Apifox 的接口定义再往下走**——确保自测和后续测试用的是最新接口定义，而不是过时的旧版。当前方式：IDEA Apifox 插件手动更新上传（Leader 主动提醒，不靠自觉记忆）；长期方向：后端加 springdoc/scribe 生成 OpenAPI + Apifox CLI `auto-import` 定期自动拉取。
1. **自测计划**：本次改动的测试范围——接口测试（后端 API）/ E2E（前端）/ 数据断言（数据·逻辑）/ 手工验证（配置·部署）。按需求选，用例可 Apifox 新建或复用。
2. **接口测试**（`sub-skills/test-flow-apifox.md`，Apifox CLI）：按 config 的 `testEnvironments.<env>.url` + `databases.<env>.mcp` 配环境——注意区分**登录入口**与**接口网关**（两者常是不同环境，配错则请求落到前端站返回 HTML 404）。建用例前先跑**契约预检**（Schema 类型/可空性 + 状态码覆盖，见 test-design）；执行前跑**预检**（三段链路健康 + 本地运行版本 commit 校验，源码新/旧 class 会假验证）。执行接口用例确认 API 通 + 数据对。**接口没问题才进 E2E**。
3. **E2E**（前端需求，`sub-skills/test-flow-e2e.md`，Playwright）：接口通过后验证 UI/交互。纯后端需求跳过。
4. **填结果**：`接口自测结论` = 通过/退回 + 证据（Apifox 执行结果 / E2E 截图）。

自测前**核实环境可用**（URL 可达 / 数据库 MCP 可连 / 账号有效），不可用则停下来报告缺口，不臆造环境。

### 开发中→测试中：上线步骤与配置清单（必带）

提测评论的「测试说明」必须包含**上线步骤与配置清单**，区分：

- **A 类（随代码部署生效）**：migration、init 命令（如 `init:permission`）、随版本发布的配置。
- **B 类（各环境手动配置）**：菜单/权限/开关等需在后台手工设置的项——**先核查配置机制**（查模块 `config/*.php` + 平台 init 命令），不能臆测是「手动」还是「自动同步」。

配置多的需求尤其必要；缺这份清单是提测阶段最常见的返工点。

### 测试中→待发布：MR 评审前置（G14）+ 提前产出发布计划

进「待发布」前的 playbook：建 feature→master MR（标题=Issue 地址）→ `mr-review` 评审（无 CRITICAL/HIGH 残留才放行，否则修复重评）→ `release-check` **提前产生** `release-plan`（上线步骤/配置/注意事项/回滚）。提前产生计划是为了让待发布节点只剩「上线前确认 + 执行 deploy」。

进入发布转换后，Leader 在**待发布→生产验收中/生产验证中**的合并评论里给出**上线操作手册**（部署顺序 / migration / 配置 / 验证 / 回滚）；这是首次要求上线步骤对团队可见的节点。

### 转换副作用 playbook（推进节点 = 完整动作包，不只是改 Issue）

`transition` 输出的 `playbook` 把跨节点的代码侧动作 + Issue 写回打包。引擎按 config 滤除不适用步骤；Issue 写回恒为末步（代码到位 → 才标记节点）。Leader 按序执行，代码侧步骤调对应 sub-skill。

| 转换 | playbook（代码侧 → Issue 写回） | 条件 |
|---|---|---|
| 开发中→测试中（提测） | commit/push feature → merge→deploy_branch → **触发 Jenkins 构建（交互问 job/分支/test_version/DEPLOY_ENV/force_package 等参数 → 清单确认）** → 写 Issue | merge 需 `deploy_branch`；Jenkins 需 `jenkins`；**参数确认独立于 run_mode** |
| 测试中→待发布（测试验收） | 提 PR feature→master（标题=Issue 地址）→ **MR 评审**（mr-review，无 HIGH 残留才放行，否则修复重评）→ **release-check 产生 release-plan**（写上线步骤/配置/注意事项/回滚）→ 写 Issue | G14 必填 `feature分支MR评审结论` |
| 待发布→生产验收中/生产验证中（发布） | **执行生产部署**（当前手动点击；按 release-check 上线步骤）→ 确认部署版本 → 写 Issue（hard_gate）= 上线完成、待产品/生产验证 | 生产部署恒存在（手动优先，无 Jenkins 条件） |
| 其它转换 | 仅写 Issue | — |

⚠️ release-check 是**发布计划**，在「测试中→待发布」产生；「发布」只**执行**该计划。**生产部署当前手动触发**（你在平台点击，完成后把生产版本号告诉 Leader）；`config.jenkins` 只管**测试环境**（提测的 `trigger_jenkins`），**生产 `deploy` 不挂 Jenkins 条件**——部署确认后必定推进 Issue。MR 在测试中→待发布**只建+评、不合**，合并/部署在「发布」。

### 节点内部子步骤 checklist（层 2 进度可见）

节点不是黑盒——`pnpm cli node` / `transition` 输出当前节点的子步骤（`progressSteps` / `nodeProgress`），Leader 据此展示「节点内做到哪了」，避免「推进到开发中后状态卡住、不知道进度」。引擎只声明 checklist（数据），子步骤执行仍由 Leader 调对应 sub-skill；done 步骤保存在 state 的 `progress` 中（引擎不驱动子步骤执行）。

| 节点 | 子步骤 |
|---|---|
| 草稿中 | 需求澄清 / 六清楚草稿 |
| 待评审 | 评审预审 / 问题清单 |
| 已评审 | 技术方案 design.md / 技术方案评审 |
| 开发中 | 技术方案 / 编码实现 / 自测 / 代码评审 |
| 测试中 | 测试计划 / 用例执行 / 阻塞修复 / 复测 |
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
| 开发中.编码实现 | git-ops + tdd-guide |
| 开发中.自测 | tdd-guide |
| 开发中.代码评审 | code-review |
| 测试中.测试计划 | test-design |
| 测试中.用例执行 | test-flow-apifox / test-flow-e2e |
| 测试中.阻塞修复 | git-ops + tdd-guide |
| 测试中.复测 | test-flow-apifox / test-flow-e2e |
| 待发布.发布计划就绪 | release-check |
| 待发布.上线前确认 | Leader（核对 release-check 清单） |
| 生产验收中.生产验证 / 验收确认 | Leader（按 release-check 验证） |
| 已确认缺陷.复现确认 / 根因定位 | intake / git-ops |
| 生产验证中.生产验证 | Leader（按 release-check 验证） |

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

### 多仓库（OA 常态）

一个 Issue 跨前端/PHP/Java 等多仓时，状态机仍单线推进（节点不按仓库分支），多仓维度在配置与产物层处理：

- **Jenkins**：config 用 `jenkins.jobs` 按仓映射 job + 参数（见 `config.md`）；`jenkins-deploy` 按当前操作仓库选模板。
- **待发布「生产版本」**：多仓时填**各仓部署版本**（分号分隔，如 `oa-service:v1.2; oa-frontend:v3.4`），不再是单一版本号。
- **MR**：每仓一条 feature 分支 + 一条 MR；`git-ops` 按仓操作。

### 开发中→测试中：上线步骤与配置清单（必带）

提测评论的「测试说明」必须包含**上线步骤与配置清单**，区分：

- **A 类（随代码部署生效）**：migration、init 命令（如 `init:permission`）、随版本发布的配置。
- **B 类（各环境手动配置）**：菜单/权限/开关等需在后台手工设置的项——**先核查配置机制**（查模块 `config/*.php` + 平台 init 命令），不能臆测是「手动」还是「自动同步」。

配置多的需求尤其必要；缺这份清单是提测阶段最常见的返工点。

### 测试中→待发布：MR 评审前置（G14）+ 发布计划就绪

进「待发布」前的 playbook：建 feature→master MR（标题=Issue 地址）→ `mr-review` 评审（无 CRITICAL/HIGH 残留才放行，否则修复重评）→ `release-check` 写**发布计划**（上线步骤/配置/注意事项/回滚）。两者都就绪才进待发布——待发布节点本身只剩「上线前确认 + 执行 deploy」。这是为了避免阻塞 bug 漏到「待发布」之后、以及发布时才发现没上线计划。

### 转换副作用 playbook（推进节点 = 完整动作包，不只是改 Issue）

`transition` 输出的 `playbook` 把跨节点的代码侧动作 + Issue 写回打包。引擎按 config 滤除不适用步骤；Issue 写回恒为末步（代码到位 → 才标记节点）。Leader 按序执行，代码侧步骤调对应 sub-skill。

| 转换 | playbook（代码侧 → Issue 写回） | 条件 |
|---|---|---|
| 开发中→测试中（提测） | commit/push feature → merge→deploy_branch → 触发 Jenkins 构建 → 写 Issue | merge 需 `deploy_branch`；Jenkins 需 `jenkins` |
| 测试中→待发布（测试验收） | 提 PR feature→master（标题=Issue 地址）→ **MR 评审**（mr-review，无 HIGH 残留才放行，否则修复重评）→ **release-check**（写上线步骤/配置/注意事项/回滚）→ 写 Issue | G14 必填 `feature分支MR评审结论` |
| 待发布→生产验收中/生产验证中（发布） | **执行生产部署**（当前手动点击；按 release-check 上线步骤）→ 确认部署版本 → 写 Issue（hard_gate）= 上线完成、待产品/生产验证 | 生产部署恒存在（手动优先，无 Jenkins 条件） |
| 其它转换 | 仅写 Issue | — |

⚠️ release-check 是**发布计划**，在「测试中→待发布」就绪；「发布」只**执行**该计划。**生产部署当前手动触发**（你在平台点击，完成后把生产版本号告诉 Leader）；`config.jenkins` 只管**测试环境**（提测的 `trigger_jenkins`），**生产 `deploy` 不挂 Jenkins 条件**——部署确认后必定推进 Issue。MR 在测试中→待发布**只建+评、不合**，合并/部署在「发布」。

### 节点内部子步骤 checklist（层 2 进度可见）

节点不是黑盒——`pnpm cli node` / `transition` 输出当前节点的子步骤（`progressSteps` / `nodeProgress`），Leader 据此展示「节点内做到哪了」，避免「推进到开发中后状态卡住、不知道进度」。引擎只声明 checklist（数据），子步骤执行仍由 Leader 调对应 sub-skill；done 步骤的记录留待 state 后续扩展。

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

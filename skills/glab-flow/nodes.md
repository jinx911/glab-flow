# 节点契约（引擎权威来源 = engine/state-machine.yaml；本表是 Leader 速查）

**工作产物落点**：所有 issue 文档（需求草稿 / 技术方案 `design.md` / 测试计划 / 回滚等）→ `<workspace.root>/.glab-flow/<iid>/spec/`（路径来自 config，见 `config.md`；`<iid>` 为 GitLab Issue iid）。**禁止**写进代码仓（oa-service / oa-platform 等）的 `docs/`——文档归 Docs-as-Code 工作目录，代码仓只放代码。统一存储树见 spec §7。

| 节点 | 工作agent | 产出 | 门禁 | 流转写回 |
|---|---|---|---|---|
| 分诊 triage::pending | intake | 澄清问题+建议分类 | 团队确认 | type::story+草稿中, Assignee=产品 |
| 草稿中 | spec-author | 需求草稿(六清楚) | 草稿门槛 | →待评审 |
| 待评审 | review-preview | 评审意见+问题清单 | 需求评审(二值) | 通过→已评审 / 退回→草稿中 |
| 已评审 | spec-author/architect | 技术方案 `design.md` → `.glab-flow/<iid>/spec/` | 技术方案评审(只记录)+开发门槛 | 进开发 Assignee=研发 |
| 开发中 | git-ops+tdd-guide+codegraph | 代码+MR描述+自测 | 代码评审与自测 | →测试中, Assignee=测试 |
| 测试中 | test-design/test-flow-apifox | 测试计划;测试问题评论 | 测试验收(阻塞全验证) | →待发布, Assignee=研发 |
| 待发布 | release-check+jenkins-deploy | 风险/检查清单/回滚 | 发布(hard_gate) | →生产验收中, Assignee=产品 |
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

### 测试中→待发布：feature MR 评审前置（G14）

进「待发布」前必须填 `feature分支MR评审结论`：用 `code-review` sub-skill 跑 feature→master **全 MR diff**，确认无 CRITICAL/HIGH 残留。这是为了避免阻塞 bug 漏到「待发布」阶段（届时已过测试验收，回头补要重新部署测试）。有残留 → 留在测试中修复，不进 待发布。

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

## 正式产物回执（完成前必须回读）

本地 `.glab-flow/<iid>/spec/` 只是工作副本；正式产物只有在 GitLab 目标上**新增回执、回读并解析成功**后才可标记完成。所有 Agent 必须使用下方「唯一可执行的回执模板」：marker 内的基础字段始终是 `kind`、`source`、`sha256`，并在评论正文提供人工可读的摘要。Leader 将回读得到的 Note ID/时间写入派生 state 缓存后，才可用 `progress` 标记子步骤完成。

### 唯一可执行的回执模板

以下是 `artifact.ts` 能解析的规范评论。复制相应的完整结构并替换示例值；不得省略字段、改名字段或用省略号代替字段。`source` 是本次产物相对 `<workspace.root>` 的路径，`sha256` 是该文件的完整 SHA-256；在 marker 后追加面向人的摘要即可。

**普通父 Issue 产物**（`proposal`、`design`、`data-evidence`、`test-plan` 或 `release-plan` 只替换 `kind` 与实际文件路径）：

```markdown
<!-- glab-flow:artifact-receipt:v1
kind: design
source: .glab-flow/42/spec/design.md
sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
-->

## 产物回执：技术方案

已生成并供本 Issue 评审。
```

**MR 评审**（必须写在该 MR，不是父 Issue）：

```markdown
<!-- glab-flow:artifact-receipt:v1
kind: mr-review
source: .glab-flow/42/reviews/group-api!17.md
sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
outcome: passed
method: mr-review-lite
high-findings: none
-->

## 产物回执：MR 评审

group/api!17 已通过评审，无 CRITICAL/HIGH 残留。
```

`method` 只允许 `mr-review-lite` 或 `code-review`；`outcome` 必须为 `passed`，`high-findings` 必须为 `none`。

**自动化部署证据**：

```markdown
<!-- glab-flow:artifact-receipt:v1
kind: deployment-evidence
source: .glab-flow/42/deployment/test-oa-service.md
sha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
mode: automation
capability: jenkins-deploy
job: oa-service
branch: feature/42
environment: test
build: 123
version: test-v1
verification: smoke-pass
-->

## 产物回执：自动化部署

测试环境构建已验证。
```

**手工部署降级证据**：

```markdown
<!-- glab-flow:artifact-receipt:v1
kind: deployment-evidence
source: .glab-flow/42/deployment/production-manual.md
sha256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
mode: manual
unavailable-reason: Jenkins job access unavailable
operator: @release-operator
performed-at: 2026-08-12T09:30:00Z
deployed-version: v1.4.0
environment: production
verification: production-smoke-pass
-->

## 产物回执：手工部署

已由发布负责人完成生产部署并验证。
```

`performed-at` 必须是 UTC 的 `Z` 结尾时间，例如上例；它不是 Issue 评论创建时间的替代品。

| 产物 kind | 产生节点/转换 | 唯一回执目标 | 条件 |
|---|---|---|---|
| `proposal` | 草稿中 → 待评审 | **父 Issue** | 总是 |
| `design` | 已评审 → 开发中 | **父 Issue** | 总是 |
| `data-evidence` | 已评审 → 开发中 | **父 Issue** | `data-backed` profile |
| `deployment-evidence` | 开发中 → 测试中 | **父 Issue** | playbook 启用 Jenkins |
| `test-plan` | 测试中 → 待发布 | **父 Issue** | 总是 |
| `mr-review` | 测试中 → 待发布 | **每个受影响 feature→master MR** | 总是；MR 清单为空或任一 MR 缺失即阻塞 |
| `release-plan` | 测试中 → 待发布时产生；待发布 → 生产验收中/生产验证中时校验 | **父 Issue** | 只在发布转换前要求并重新回读；不得阻塞测试中 → 待发布 |

`mr-review` 必须在每一个对应 MR 上新增并回读；父 Issue 的汇总仅供导航，**不能以父 Issue 评论替代 MR 回执**。其他种类不得写到 MR 来代替父 Issue。产物回执必须先于状态写回；全部回执完成后，状态写回从**标签 + Assignee**开始，随后新增状态变更评论，最后回读 Issue。

### 数据型需求 profile

在草稿中 → 待评审时，Leader 显式选择并保存 `standard` 或 `data-backed`，绝不凭关键词自行猜测。`data-backed` 必须在技术方案前追加 `data-evidence` 回执，至少包括：**代码数据流**、数据源/真理源决策；如请求生产数据，还须有**只读生产取证**及所用路由/授权约束。`standard` 不需要这条附加回执。

### 回执与状态写回固定顺序

每个产物都严格走「生成文件并计算 SHA-256 → 新增对应目标的回执 → 回读目标 → 解析 marker → state 缓存 → progress 完成」。全部产物完成后才走「标签 + Assignee → 状态变更评论 → 最终 Issue 回读」。任一失败立即停止；恢复时先回读并对账，仅重试首个未完成阶段。

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

### 测试中→待发布：MR 评审前置（G14）+ 提前产出发布计划

进「待发布」前的 playbook：建 feature→master MR（标题=Issue 地址）→ `mr-review` 评审（无 CRITICAL/HIGH 残留才放行，否则修复重评）→ `release-check` **提前产生** `release-plan`（上线步骤/配置/注意事项/回滚）。提前产生计划是为了让待发布节点只剩「上线前确认 + 执行 deploy」，但**测试中→待发布不要求 `release-plan` 的 GitLab 回执**，也不因它缺失阻塞这次转换。该文件和摘要可以在此时准备好。

进入发布转换后，Leader 在**待发布→生产验收中/生产验证中**的最终状态写回前，向父 Issue 新增下方模板的 `release-plan` 回执，回读同一 Issue 并将结果传给 `transition.artifactContext`；这是首次强制门禁，也是恢复时必须重新核验的门禁。测试中阶段的本地文件或缓存均不能预先满足这次发布门禁。

### 转换副作用 playbook（推进节点 = 完整动作包，不只是改 Issue）

`transition` 输出的 `playbook` 把跨节点的代码侧动作 + Issue 写回打包。引擎按 config 滤除不适用步骤；Issue 写回恒为末步（代码到位 → 才标记节点）。Leader 按序执行，代码侧步骤调对应 sub-skill。

| 转换 | playbook（代码侧 → Issue 写回） | 条件 |
|---|---|---|
| 开发中→测试中（提测） | commit/push feature → merge→deploy_branch → **触发 Jenkins 构建（交互问 job/分支/test_version/DEPLOY_ENV/force_package 等参数 → 清单确认）** → 写 Issue | merge 需 `deploy_branch`；Jenkins 需 `jenkins`；**参数确认独立于 run_mode** |
| 测试中→待发布（测试验收） | 提 PR feature→master（标题=Issue 地址）→ **MR 评审**（mr-review，无 HIGH 残留才放行，否则修复重评）→ **release-check 产生 release-plan**（写上线步骤/配置/注意事项/回滚；此转换不校验其回执）→ 写 Issue | G14 必填 `feature分支MR评审结论` |
| 待发布→生产验收中/生产验证中（发布） | **执行生产部署**（当前手动点击；按 release-check 上线步骤）→ 确认部署版本 → 写 Issue（hard_gate）= 上线完成、待产品/生产验证 | 生产部署恒存在（手动优先，无 Jenkins 条件） |
| 其它转换 | 仅写 Issue | — |

⚠️ release-check 是**发布计划**，在「测试中→待发布」产生；「发布」只**执行**该计划，并在最终状态写回前按本页模板新增、回读 `release-plan` 回执。**生产部署当前手动触发**（你在平台点击，完成后把生产版本号告诉 Leader）；`config.jenkins` 只管**测试环境**（提测的 `trigger_jenkins`），**生产 `deploy` 不挂 Jenkins 条件**——部署确认后必定推进 Issue。MR 在测试中→待发布**只建+评、不合**，合并/部署在「发布」。

### 节点内部子步骤 checklist（层 2 进度可见）

节点不是黑盒——`pnpm cli node` / `transition` 输出当前节点的子步骤（`progressSteps` / `nodeProgress`），Leader 据此展示「节点内做到哪了」，避免「推进到开发中后状态卡住、不知道进度」。引擎只声明 checklist（数据），子步骤执行仍由 Leader 调对应 sub-skill；done 步骤保存在 state 的 `progress` 中。带正式产物的步骤须先有已回读的对应 receipt，不能以本地文件替代。

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

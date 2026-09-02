# 统一多环境测试执行设计

## 目标

将本地、测试环境（以及未来可选的生产环境）统一为同一条测试流程的不同执行环境。每个需求只维护一份测试计划；环境执行记录是可验证的事实，而不是「自测通过」之类的自由文本。

本次交付必须阻止以下误放行：代码单测、语法检查、构建和代码评审均通过，但没有在本地完成真实业务闭环验证，仍可从「开发中」流转到「测试中」。

## 现状与问题

当前 `test-config` 已能为 `local` 与 `test` 注入地址、账号、测试数据和 Apifox 环境，但引擎的开发中→测试中门禁只检查「自测计划」「接口自测结论」等非空字段。它不能确认：

- 是否使用了正式 `test-plan.md`；
- 是否在 `local` 执行；
- 是否覆盖计划中的全部必测用例；
- 是否执行了接口、E2E、数据断言或明确了不适用原因；
- 测试环境是否复用同一版本的测试计划。

因此现有「双跑」仅是说明性规则，不是引擎可执行契约。

## 范围

本次实现以下能力：

1. 定义纯数据的测试计划清单与环境执行记录，并支持从 Issue 最新评论读取；
2. 将 `local` 通过记录设为开发中→测试中的硬性前置；
3. 将 `test` 通过记录设为测试中→待发布的硬性前置；
4. 要求两次执行使用同一个测试计划版本，计划变更后旧记录不再满足门禁；
5. 让节点评论保留团队可读的报告，同时附带机器可解析的执行记录；
6. 让 `test-config`、测试设计、接口测试和 E2E 子技能采用同一环境中立流程。

本次不做生产环境自动测试、实际执行 Apifox/浏览器、数据库写入或 GitLab I/O。生产环境只保留兼容的配置/记录结构，日后由单独需求决定是否纳入终态门禁。

本项目后续不采用测试先行。实现完成后必须运行定向测试、全量回归、类型检查、契约检查和代码走查；测试用于验证已实现的行为，不作为“先写失败测试再编码”的前置仪式。相应地，开发节点与文档不再委派或引用已废弃的测试先行子流程。

## 核心模型

### 测试计划

`test-plan.md` 是每个 Issue 唯一且版本化的测试计划，位于：

```text
<workspace.root>/.glab-flow/<iid>/spec/test-plan.md
```

计划必须声明稳定的 `planVersion`（内容修改时递增）和用例清单。每条用例至少包含：

- `id`：稳定编号，例如 `TP-001`；
- `acceptanceCriteria`：对应的需求验收标准；
- `methods`：`api`、`e2e`、`data`、`manual` 中的一项或多项；
- `requiredEnvironments`：至少含 `local`、`test`；
- `expected`：可验证的预期结果。

不适用不是隐式跳过：例如纯后端需求的 UI 用例不应生成 E2E 用例；若某既有用例在特定环境不可执行，必须在执行记录中列出理由，且该理由须由计划明确允许。

### 环境执行记录

每次执行在父 Issue 新增一条不可编辑评论。评论由可读摘要和机器块组成：

```markdown
## 测试执行记录

- 环境：local
- 计划版本：v3
- 被测版本：sample-service:abc123; sample-web:def456
- 结论：通过
- 用例统计：6 passed, 0 failed, 0 skipped

<!-- glab-flow:test-run:v1
environment: local
plan-version: v3
version: sample-service:abc123; sample-web:def456
outcome: passed
cases: TP-001=passed,TP-002=passed
evidence: apifox-report=12345,e2e=issue-note-url,data=assertion-summary
-->
```

解析规则严格：环境、计划版本、被测版本、结论、用例列表和证据均不可为空；环境必须等于目标门禁要求；结论只能是 `passed`；每一个该环境必测用例必须恰好记录为 `passed`。最新、有效且计划版本匹配的记录才可满足门禁。任何最新格式错误、失败或计划版本不一致都不允许回退使用旧记录。

## 流程与门禁

```text
技术方案完成
  → 编写/更新唯一 test-plan.md
  → local：按计划执行完整业务闭环并写 TestRun(local)
  → 开发中 → 测试中（引擎验证 local 记录）
  → test：按相同计划执行完整业务闭环并写 TestRun(test)
  → 测试中 → 待发布（引擎验证 test 记录）
```

- 计划在本地执行之后被更新：`planVersion` 必须改变，原 `local` 记录立即失效，须重跑；测试环境同理。
- 本地与测试环境的**步骤和计划相同**；差异只来自 `test-config` Profile，例如 URL、账号、数据库引用、构建/部署方式、数据前缀和 Apifox 环境 ID。
- 本地运行不以单测、构建或静态检查替代。它必须实际调用计划要求的业务接口、UI/E2E、数据断言或手工验证。
- 测试环境运行也不以本地结论替代；它必须在 `test` Profile 下重新执行同一计划。
- 未来生产验证使用同一 `TestRun` 格式，可在后续变更中把指定生产用例接入「生产验收中→已完成」门禁；本次不激活该门禁。

## 引擎边界

新增纯函数，不引入 GitLab、Apifox、浏览器、数据库或文件系统 I/O：

1. 解析 `test-plan.md` 的机器可读清单；
2. 解析 Issue notes 中 `glab-flow:test-run:v1` 块；
3. 在给定计划与 notes 时选择最新记录，并验证环境、版本、必测用例和证据；
4. 在 `validateTransition` / `transition` / legacy `validate` / legacy `plan` 统一调用测试运行门禁；
5. 提供模板渲染，供 Leader 写入可读摘要与机器块。

`TransitionInput` 增加当前测试计划内容和刚回读的 Issue notes。不能只从本地 state 或自由文本 fields 判断测试完成；GitLab 最新评论是运行时事实源。

## 错误与恢复

- 缺计划、计划格式错误、缺环境执行记录、记录格式错误、失败记录、缺证据、漏必测用例、计划版本不匹配，均返回明确 `missing` / `reasons`，且不产生 `WritePlan`。
- 最新记录无效时停止，不能回退到更早记录。
- 写入执行记录后必须回读父 Issue，再调用 `transition`；回读失败不更新本地进度或推进状态。
- 失败用例、环境不可用或数据清理失败必须以 Issue 评论记录；修复后写新执行记录，不编辑旧记录。

## 云端报告上传授权预检

`apifox test-suite run ... --upload-report detail` 同时包含两类副作用：向目标环境发起真实业务请求，以及向 Apifox 云端创建带详情的测试报告。用户在会话中同意测试，不等于终端沙箱和 Apifox 外部 AI 写入权限已经放行；两层权限必须分别成立。

每个环境的首次正式运行按以下顺序进行：

1. Leader 展示精确命令、Apifox 项目/分支、环境、套件、测试数据前缀，以及「将上传请求/响应详情报告」这一副作用；
2. 执行端按宿主平台请求**受限的提升权限**。在 Codex 中，`apifox test-suite run` 必须使用 `require_escalated`，并请求可复用的窄前缀 `apifox test-suite run`；不以普通沙箱命令重试；
3. 若 Apifox 返回 AI 写入受限，停止执行，不降级移除 `--upload-report detail`。提示用户在目标项目/分支的「项目设置 → 功能设置 → AI 功能设置 → 外部 AI 编辑权限」开启直接编辑权限，或由用户在客户端手动触发同一套件；
4. 权限变更或手动执行后，必须用 `apifox test-report get <reportId> --project <projectId>` 回读。只有回读显示该环境、报告详情和统计与本次执行一致，才可写入 `TestRun`；
5. 终端授权拒绝、Apifox 拒绝或报告回读不完整时，TestRun 保持未完成，相关状态门禁继续阻塞，并把拒绝原因写入父 Issue。

不得把授权状态写入 `test-config.md` 当作永久许可；配置只描述目标环境，不能替代宿主平台和 Apifox 在执行时作出的授权决定。CLI 当前支持的 `--upload-report` 值以当次 `apifox test-suite run --help` 与 `test-report get` 回读为准；若 `detail` 在某版本不被支持，应停止并提示升级或改用已验证的等价参数，不能伪造报告详情。

## 文档与配置

- `test-config.md` 的 `environments` 保持 Profile 结构，不将 local/test 写死进配置解析器；`local` 与 `test` 是本次状态机的默认门禁环境名。
- `test-design` 在技术方案完成后、编码前生成或更新 `test-plan.md`；不再等进入「测试中」才首次设计计划。
- API、E2E、数据、手工验证都消费同一计划，按 `test-config` 选择环境 Profile；环境切换不复制计划或用例。
- 节点内容评论的「提测说明」和「测试报告」引用相应 `TestRun`，避免再次用笼统的「自测通过」替代执行事实。

## 验收标准

1. 没有 `local` 通过记录时，Story/Bug 的开发中→测试中被拒绝，且不返回写回计划。
2. `local` 记录的计划版本、必测用例或证据不完整时，转换被拒绝。
3. `local` 通过后，测试中→待发布仍在缺少 `test` 通过记录时被拒绝。
4. `test` 通过记录必须与当前计划版本一致；计划版本更新会令旧 local/test 记录均失效。
5. 最新 malformed/failed 记录不能通过回退到旧 passed 记录绕过门禁。
6. `transition`、`validate`、`plan` 三个入口具有一致结果。
7. 测试计划、执行模板与子技能明确本地和测试环境走同一流程，仅使用不同 Profile。
8. 全量单元、契约和 CLI 回归测试通过；引擎生产代码不包含 GitLab/Apifox/浏览器/数据库 I/O。
9. `--upload-report detail` 被终端或 Apifox 权限拦截时，流程能明确区分两类拒绝、给出恢复动作，并保持 TestRun 与状态门禁未完成；不得静默去掉上传参数或以本地 stdout 伪造通过。

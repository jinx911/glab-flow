# Apifox 多环境、页面展示与认证一致性设计

## 目标

glab-flow 的 local、test（OA 中为 Stage）和未来 production 使用同一份版本化测试计划。除真实运行外，Apifox 页面中用户可见的场景、套件和数据集也必须准确表达环境与用途；登录能力必须可复用，不能让每个接口重复处理账号、token 和鉴权头。

## 四层环境事实

| 层次 | 事实源 | 作用 |
|---|---|---|
| 计划环境 | `test-plan.md` | 此用例应验证的 logical environment |
| 目标执行环境 | Apifox CLI 的显式 `--environment <id>` | 禁止依赖默认环境 |
| 实际执行环境 | 测试报告的 `environmentName`、报告 ID 与统计 | TestRun 的运行证据 |
| 页面展示环境 | Apifox 列表/详情中的环境、名称、目录、标签与结果 | 防止用户被 UI 误导 |

OA Platform #172 已证明四层必须分开：Stage 场景请求实际指向 `stage-oa`，且 Stage 报告的 `environmentName` 为 `Stage`，但列表仍可显示本地。场景 `get` 也没有可作为事实源的稳定默认环境字段。因此列表不能替代报告，却必须经过独立审计。

## 环境入口与资产复用

- 场景用例保存稳定业务步骤、断言、变量传递与清理；测试数据保存输入矩阵；套件或场景分组保存稳定执行入口。
- 单环境入口的名称、目录、标签、页面运行环境、显式运行参数和报告环境必须一致。
- 同一流程只有环境、数据集或循环配置不同时，优先使用 Apifox 场景实例；不能复制整套步骤。
- 若 UI 无法准确表达一个“多环境”入口，则建立 local/test 的环境实例或轻量包装入口，引用共享基础场景。共享基线必须标记 `baseline`/`template`，不得充当环境验收入口。
- 环境专属入口可带 `local` / `stage` 名称以消除歧义；基础资产仍使用业务语义名称。

## AuthProfile 共用认证契约

每个需要登录的项目定义可复用 `AuthProfile`：

```text
profile：client-user | hr-admin | supplier-admin
owner：登录接口所在项目/场景
environment binding：环境 ID 与运行变量入口
credential reference：本机安全凭据引用
bootstrap：登录、成功断言、token JSONPath、临时变量名
injection：公共鉴权头，例如 Bearer {{auth_token}}
scope：角色与可调用业务域
teardown：可选登出；业务数据清理独立执行
```

- 账号、密码和环境参数只在运行时 `--variables` 文件中按 environment ID 注入；不得进入 Apifox 资产、Issue 评论、审计 marker 或报告正文。
- 登录后置操作必须断言登录成功、确认 token 存在并将 token 提取到本次场景有效的临时变量；后续接口统一引用该变量。
- 同场景的临近步骤可直接引用前置响应；作为可复用契约时应使用命名临时变量，避免依赖步骤序号。
- 跨场景/套件复用 token 时，登录引导必须位于执行链路首部并显式启用运行时变量传递；独立入口默认重新登录。
- 401/403 不得静默登录重试；除非计划明确覆盖刷新 token 的业务行为，否则保留为失败证据。

## 版本化审计

保留 `glab-flow:apifox-asset-audit:v1` 的历史兼容；在同一最新审计选择逻辑中新增 `v2`：

```text
presentation: <case> | <asset-type> | <expected-environment> | <displayed-environment> | <report-environment>
auth-profile: <case> | <profile> | <temporary-token-variable>
```

测试计划可选声明 `presentation` 与 `auth-profile`。只要计划声明它们，v2 审计必须逐项满足：

1. 预期、页面显示与报告环境完全相等；
2. 资产类型和 case 必须是该环境计划中已声明的资产；
3. AuthProfile 必须由相同 case 声明，且仅记录 profile、临时变量名等非敏感元数据；
4. `mismatch`、缺少页面投影、报告环境不符、未知/重复声明或空 token 变量均令审计无效；
5. 历史 v1 审计只可满足未要求展示/认证契约的计划，不能被静默当作 v2 通过。

## 流程和门禁

```text
TestPlan → 盘点/回读资产 → 受控写入 → CLI 回读
→ 显式环境运行 → 报告 environmentName 回读 → 页面投影核对
→ AssetAudit v2 → TestRun → 状态推进
```

引擎只解析、渲染和校验这些结构化记录；Leader 仍负责 Apifox CLI、浏览器读取、GitLab 评论写回及其回读。local TestRun 是开发中→测试中前置，test TestRun 是测试中→待发布前置；任一展示或认证审计失败均阻断对应 TestRun。

## 验收

1. v1 历史审计保持可解析；v2 严格校验展示环境和认证契约。
2. Stage 页面显示 local、报告环境不符、遗漏 AuthProfile 或记录持久 token 都被拒绝。
3. API case 仍必须有 scenario 资产；公共 API 可以不声明 AuthProfile。
4. CLI 只预览评论，不产生 Apifox/GitLab I/O。
5. 活跃流程文档明确同一计划、多环境、临时 token、`--carry-runtime-variables`、认证失败不静默重试和页面审计顺序。

---
name: glab-flow-jenkins-deploy
description: glab-flow 发布节点的 Jenkins 部署子 skill。交互式选择 job 与参数、最终确认后触发构建并轮询结果。vendor 自 ~/.claude/skills/jenkins-deploy 并按 GitLab-native 适配。
---

> 本文件是 glab-flow 自有子 skill（vendor 自 `~/.claude/skills/jenkins-deploy` 并按 GitLab-native 适配）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# Jenkins Deploy — 交互式部署

**配置来源**：job 名 / 分支参数名 / 默认参数来自 glab-flow 配置（见 `../config.md`）：
- `jenkins.job_name` —— 单仓目标构建作业名
- `jenkins.jobs` —— 多仓作业映射（键=仓库名，值=`{ job_name, branch_param?, env_param?, default_params? }`）；配了之后按当前操作仓库选 job + 参数模板
- `jenkins.branch_param` —— 分支参数名，默认 `oa_branch`
- `jenkins.default_params` —— 默认构建参数键值表

`jenkins.job_name` 与 `jenkins.jobs` 都空 → 不启用 Jenkins 能力（发布节点跳过构建触发）。

## Job 参数映射（参考）

已知 oa 项目族的 job 与参数（实际 job 以配置 `jenkins.job_name` 为准）：

| Job | 环境 (默认 stage) | 分支 (默认 test) | 额外参数 |
|-----|---------|---------|---------|
| oa-platform-php | test_version (kn/stage/u1) | platform_branch, module_branch, capital_branch | force_package, isForce, rmNodeModules |
| oa-service | test_version (kn/stage/u1) | oa_branch | — |
| oa-gateway | test_version (kn/stage/u1) | oa_branch | — |
| oa-frontend | DEPLOY_ENV (kn/u1/stage) | GIT_BRANCH | RUN_LINT=true |
| oa-integration | environment (kn/stage/u1/kn2) | integration, message, calendar, common, approval, employees, recruitment | — |
| oa-go | test_version (attendance/clock/user/employee/delivery) | branch | — |
| oa-web-app-v2 | test_version (kn/kn2/stage/u1) | default_branch | — |

## 参数默认值

| 参数类型 | 默认值 | 说明 |
|---------|-------|------|
| 环境类 (test_version / DEPLOY_ENV) | **stage** | 用户未指定时 |
| 分支类 | **test** | 用户未指定时；分支参数名取 `jenkins.branch_param` |
| Boolean | 字符串 `"true"` / `"false"` | ⚠️ MCP 工具不接受布尔值 |
| Password / registry_* | 跳过 | 使用 Jenkins 默认值 |

未在映射表中显式列出的参数，回退到 `jenkins.default_params` 给定的默认值。

## 工作流

### 0. 能力发现与降级判定

开始前先确认 Jenkins 工具当前确实可调用、目标 job 可读取、参数定义可取得。配置或已安装 skill 只能作为线索，不能替代**能力发现**。发现结果决定 `deployment-evidence`：

- **automation**：能力和 job 都可用，继续下列流程；回执应包含发现到的能力、job/分支/环境参数、构建号或版本与验证结果。
- **manual（手工）**：工具不可调用、job 不可访问或自动化明确不可用时，停止自动触发，由人工执行；记录不可用原因、操作者、执行时间、部署版本/环境与验证结果。

部署结果（automation 的构建号/版本，或 manual 的操作者/时间/版本）作为「提测说明」合并评论的一部分（见 `../nodes.md`「节点内容评论」），不单独发 marker 回执。手工降级仍须对实际环境/版本征得用户确认。

### 1. 确定 Job

- 编排器/用户指定 job 名 → 直接使用
- 否则若 config 有 `jenkins.jobs` → 按当前操作仓库取对应 job（多仓常态，OA 跨 oa-service/oa-frontend 等）
- 否则读 glab-flow config `jenkins.job_name` → 用之
- 都无 → AskUserQuestion multiSelect 让用户选择（支持多项目）
- 用户说"部署 N 个项目" → 按上下文推断

### 2. 交互式参数收集

每个选中 Job 调用 `jenkins_get_job` 获取参数定义后，按类型交互：

**Choice 参数** (如 test_version)：
- 有默认值且用户未指定 → 使用默认值
- 用户需要调整 → AskUserQuestion 列出 choices 选项

**String 参数** (如分支)：
- 有默认值 → 在确认清单中展示，用户可调整
- 无默认值 → AskUserQuestion 让用户输入

**Boolean 参数**：
- 使用默认值，在确认清单中展示

**force_package vs isForce（仅 oa-platform-php）**：
- `force_package`：**指定模块强制打包**，填模块名（如 `oa-app-workflow`），多个用英文逗号分隔。用于只重新打包指定模块的前端/后端，不影响其他模块。
- `isForce`：**全局强制打包**，布尔值。重新打包所有模块，耗时较长。
- **互斥原则**：用户指定了 `force_package` 时，`isForce` 保持默认 `false`；用户说"全部强制打包"时才设 `isForce=true`。

**Password 参数**：跳过。

**多项目共享**：环境和分支参数只询问一次，共享给所有项目。

### 3. 最终确认

所有参数收集后，**必须**用 AskUserQuestion 展示完整清单让用户确认。粗粒度授权（例如「去发布」「合并并部署」「触发 Jenkins」）不等于构建参数确认；`test_version` / `DEPLOY_ENV` / 分支等会改变目标环境的参数必须逐项展示后再触发：

```
📋 部署清单

[1] oa-platform-php
    test_version = stage, platform_branch = test, module_branch = test, capital_branch = test

[2] oa-frontend
    DEPLOY_ENV = stage, GIT_BRANCH = test, RUN_LINT = true

确认部署？
```

用户确认后才能触发构建。

### 4. 触发构建（默认非阻塞）

> **默认用非阻塞触发 + 延时轮询，不要用 `jenkins_build_and_watch` 阻塞。** 内网 Jenkins 的 watch 轮询常因 DNS 解析失败/超时干等数百秒；非阻塞触发后用 `jenkins status`（`jenkins_get_build`）自查更可靠。

**单项目（默认）**：
1. `jenkins_build`（非阻塞）触发，记录 queue URL / build number
2. 延时用 `jenkins_get_build` 轮询状态（或交由用户用 `jenkins status` 查）
3. 不阻塞用户其他工作

**多项目并行**：所有项目同时 `jenkins_build` 触发 → 各自记录 build number → 轮询 `jenkins_get_build`。

仅在用户明确要求「等它跑完」且环境 watch 可达时，才用 `jenkins_build_and_watch`；watch 超时/失败立即回退到 `jenkins_get_build` 兜底。

### 5. 结果展示

```
📊 构建结果
[1] oa-platform-php  → ✅ SUCCESS  #<build-number>  (3m20s)
[2] oa-frontend      → ✅ SUCCESS  #<build-number>  (2m45s)
```

失败 → 提示查看对应 job/build 的日志。

## 规则

- 只用 MCP 工具 (`mcp__jenkins__jenkins_*`)，禁止 curl/bash
- 参数不完整必须交互询问，不自行编造
- **触发前必须展示清单让用户确认**
- Boolean 参数必须传字符串 `"true"` / `"false"`

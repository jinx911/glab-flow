---
name: glab-flow-jenkins-deploy
description: glab-flow 测试构建与生产部署的 Jenkins 子 skill。测试参数默认值直用；生产部署仍需 L3 逐项确认后触发并轮询结果。vendor 自 ~/.claude/skills/jenkins-deploy 并按 GitLab-native 适配。
---

> 本文件是 glab-flow 自有子 skill（vendor 自 `~/.claude/skills/jenkins-deploy` 并按 GitLab-native 适配）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# Jenkins Deploy — 交互式部署

**Last Updated:** 2026-09-02

**调用边界**：本子 skill 只负责能力发现、参数解析和 Jenkins 构建/手工部署动作，不读取或写回 GitLab 状态。Leader 在调用前完成 DU-first `reconcile`，并在 Issue 最终回读后通过 `pnpm cli du` 的 `cached-node` 更新 DU `cachedNode`；本子 skill 不能绕过 GateSet 或 `hard_gate`。

**配置来源**：job 名 / 分支参数名 / 默认参数来自 glab-flow 配置（见 `../config.md`）：
- `jenkins.job_name` —— 单仓目标构建作业名
- `jenkins.jobs` —— 多仓作业映射（键=仓库名，值=`{ job_name, branch_param?, env_param?, default_params? }`）；配了之后按当前操作仓库选 job + 参数模板
- `jenkins.branch_param` —— 分支参数名，默认 `branch`
- `jenkins.default_params` —— 默认构建参数键值表

`jenkins.job_name` 与 `jenkins.jobs` 都空 → 不启用 Jenkins 能力；引擎会从开发中→测试中的 playbook 移除 `trigger_jenkins`，不要求 Leader 临时选 job。生产发布当前是独立的手动部署动作，不因 Jenkins 配置存在而自动触发。

## 参数默认值

| 参数类型 | test/非生产处理 | production 处理 |
|---------|-------|------|
| 环境类 | Jenkins Job 或配置默认值直用 | 展示实际值并逐项确认 |
| 分支类 | Jenkins Job 或配置默认值直用；参数名取 `jenkins.branch_param` | 展示实际值并逐项确认 |
| Boolean | 默认值直用，传字符串 `"true"` / `"false"` | 展示实际值并逐项确认 |
| Password / registry_* | 跳过敏感值，使用 Jenkins 默认值 | 不在文档或命令中回显；按平台安全流程确认 |

test 构建只有在参数定义缺失且没有默认值时才一次性询问全部缺口，不逐参数打断；解析后的参数清单写入 DU/提测说明供审计。未在映射表中显式列出的参数，回退到 `jenkins.default_params` 给定的默认值。生产部署不是普通 Jenkins test 构建：即使未来配置了 prod job，也必须保留 L3 的逐项确认。

## 工作流

### 0. 在 canonical playbook 中的位置

- **开发中→测试中（提测）**：`commit/push` →（有 `deploy_branch` 时）合并到测试分支 →（有 `jenkins` 时）触发 test Jenkins 构建 → Issue 写回。GateSet 只在启用环境缺少证据时发出回归动作；local 回归在 feature commit 后、merge/deploy 前执行，完成后由 Leader 记录 DU 证据并重新运行 transition。test 参数默认值直用，构建结果/版本/环境记录进 DU，并由提测合并评论携带摘要。
- **测试中→待发布（发布准备）**：`release-check` 生成 `release-plan`，包括上线步骤、配置、注意事项和回滚方案；它是生成器，不能由生产发布阶段重复生成。
- **待发布→生产验收中/生产验证中（发布）**：生产部署是独立 `hard_gate`/L3 动作；若 GateSet `rollbackPlan=true`，先执行 `verify_rollback_ready` 核对已生成且已回读的方案，再由人工在 Jenkins/平台触发部署，Leader 只在逐项确认后推进 Issue。不要把 test 构建成功当成生产部署，也不要把 L2 流转确认当成生产参数确认。GateSet 的 `skipStates` 只影响状态投影，不会降低生产 hard gate。

### 0. 能力发现与降级判定

开始前先确认 Jenkins 工具当前确实可调用、目标 job 可读取、参数定义可取得。配置或已安装 skill 只能作为线索，不能替代**能力发现**。发现结果决定 `deployment-evidence`：

- **automation**：能力和 job 都可用，继续下列流程；面向团队的评论只写可测试版本/环境和验证结论。
- **manual（手工）**：工具不可调用、job 不可访问或自动化明确不可用时，停止自动触发，由人工执行；详细不可用原因、操作者、执行时间、构建号等写入 DU/内部执行记录。

部署结果的团队可读摘要（版本/环境/验证结论）作为「提测说明」合并评论的一部分（见 `../nodes.md`「节点内容评论」），不单独发 marker 回执。构建号、报告 ID、内部 URL、账号和本地路径不得进入正式 Issue 评论；手工降级仍须对实际环境/版本征得用户确认。

### 1. 确定 Job

- 编排器/用户指定 job 名 → 直接使用
- 否则若 config 有 `jenkins.jobs` → 按当前操作仓库取对应 job
- 否则读 glab-flow config `jenkins.job_name` → 用之
- 都无：若当前是**提测**，按 playbook 条件跳过 Jenkins，不临时编造 job；若用户明确要求手动构建，进入 manual 降级并记录原因。生产发布不在此处选择 test job。
- 用户说"部署 N 个项目" → 按上下文推断并逐仓记录 job/参数

### 2. 参数收集（按环境分层：test 自动，生产必确认）

**test/非生产环境的构建参数与凭据同理——测试数据，默认值直用，不逐参数交互确认**（已裁定打通：减少确认点提高效率）。只有**缺参数定义且无默认值**才问（一次性问全，不逐个问）；生产部署（发布节点）参数确认保留（L3 红线）。

- Choice 参数（如 test_version）：有默认值 → 直用；无默认值 → AskUserQuestion 一次列出
- String 参数（如分支）：有默认值 → 直用；无默认值 → 与其他缺参一次问全
- Boolean / Password 参数：默认值直用 / 跳过
- 多项目共享：环境和分支参数解析一次，共享给所有项目

### 3. 触发前记录（test 环境）

test 环境参数解析完成后**直接触发**，参数清单写入内部执行记录（版本/环境摘要可进入提测说明合并评论，构建号等内部定位信息留在 DU）；不再有独立的「部署清单确认」对话——提测流转的 L2 批量确认已覆盖放行判断。**生产部署**：仍必须 AskUserQuestion 展示完整清单逐项确认后触发（粗粒度授权不等于生产参数确认，L3 红线）：

```
📋 生产部署清单（必须逐项确认）

[1] sample-service
    DEPLOY_ENV = prod, branch = release/123

[2] sample-frontend
    DEPLOY_ENV = prod, GIT_BRANCH = release/123

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
[1] sample-service   → ✅ SUCCESS  #<build-number>  (3m20s)
[2] sample-frontend  → ✅ SUCCESS  #<build-number>  (2m45s)
```

失败 → 提示查看对应 job/build 的日志。

## 规则

- 只用 MCP 工具 (`mcp__jenkins__jenkins_*`)，禁止 curl/bash
- 参数不完整必须交互询问，不自行编造
- **test 环境默认值直用直接触发（清单进执行记录）；生产部署触发前必须展示清单让用户逐项确认**
- Boolean 参数必须传字符串 `"true"` / `"false"`

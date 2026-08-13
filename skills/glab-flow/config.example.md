---
name: glab-flow-config-example
description: glab-flow 项目配置示例。由 /init-glab-flow 生成 .glab-flow/config.md，或复制本文件手填。
---

# glab-flow 项目配置（示例）

> 实际配置由 `/init-glab-flow` 写到 `<workspace.root>/.glab-flow/config.md`。
> 引擎解析其中的 ```yaml 代码块（`pnpm cli config`）。

```yaml
gitlab:
  host: "git.kuainiujinke.com"            # 必填；glab api --hostname 用
  project_id: "3915"                      # 必填；或用 project_path: "oa/oa"
  # harness_clone: "/Users/.../oa-ai-native-harness"  # 可选；glab remote 自动识别用

workspace:
  root: "/Users/eliojin/IdeaProjects/oa"  # 必填；.glab-flow/ 落点

branch_naming:
  format: "{type}/{iid}"
  type_map: { story: feat, bug: fix }

run_mode: "semi-auto"                     # semi-auto（默认）| full-auto

# ---- 可选（按需开启）----

# deploy_branch: "test"                  # 自动部署分支；不配则发布节点跳过合并

# roles:                                  # 角色→默认 @用户；Issue 无交付协同表时兜底，减少反复反问
#   产品: "@pm"
#   研发: "@dev"
#   测试: "@qa"

# jenkins:                                # 单仓：只给 job_name
#   job_name: "oa-service"
#   branch_param: "oa_branch"            # 默认 oa_branch
#   default_params: { deploy_type: "api", test_version: "kn" }

# jenkins:                                # 多仓：按仓库映射 job + 参数（与单 job_name 二选一或共存）
#   jobs:
#     oa-service: { job_name: oa-service, branch_param: oa_branch }
#     oa-frontend: { job_name: oa-frontend, branch_param: GIT_BRANCH, env_param: DEPLOY_ENV, default_params: { RUN_LINT: "true" } }

# databases:                              # 按环境命名
#   local: { mcp: "mcp__platform-local__mysql_query", desc: "本地主库" }
#   # stage: { mcp: "mcp__platform-stage__mysql_query", desc: "预发库（只读）" }

# test_environments:                      # 多环境分别列出
#   local:
#     url: "http://tenant.oa.com"
#     account: ""
#     password: ""
#     desc: "本地全栈"
#   stage:
#     url: "http://stage.oa.com"
#     account: ""
#     password: ""
#     desc: "预发环境"
```

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

# databases:                              # 逻辑数据目标；不放连接串、密码或 DMS 凭据
#   local_platform: { mcp: "mcp__platform-local__mysql_query", desc: "本地 Docker 平台库" }
#   local_tenant: { mcp: "mcp__tenant-local__mysql_query", desc: "本地默认租户库" }
#   test_platform: { mcp: "dms:test:platform-stage", desc: "测试平台库；执行时按 DMS 规则选库" }

# test_environments:                      # 只维护 local/test 两个运行 Profile
#   local:
#     url: "http://tenant.oa.com"
#     runtime: "local-docker"
#     login: { credential_ref: "local_hr_admin", role: "HR 管理员" }
#     data:
#       platform: { database_ref: "local_platform" }
#       default_tenant: { website: "tenant.oa.com", database_ref: "local_tenant" }
#       tenants:
#         default: { website: "tenant.oa.com", database_ref: "local_tenant" }
#       test_data: { prefix: "E2E<issue>", cleanup_required: true, prohibited: ["既有业务数据"] }
#     frontend:
#       build: { required: true, command: "pnpm build:backend", workdir: "/workspace/frontend", output_dir: "/workspace/platform/public/frontend" }
#   test:
#     url: "https://stage.example.com"
#     runtime: "deployed"
#     login: { credential_ref: "test_hr_admin", role: "HR 管理员" }
#     data:
#       platform: { database_ref: "test_platform" }
#       default_tenant: { website: "stage.example.com", resolver: "test_platform.websites.uuid" }
#     frontend: { build: { required: false } }
#
# `credential_ref` 由本机钥匙串、环境变量或受控密钥注入解析；严禁写 account/password/token。

# apifox:                                 # 按仓库选择 Apifox 项目；接口先行测试使用
#   projects:
#     oa_platform:
#       project_id: "8731182"
#       branch: "main"
#       environments:
#         local: { name: "本地 tenant", base_url: "http://tenant.oa.com" }
#         test:  { id: "<环境ID>", name: "测试环境", base_url: "https://test.example.com" }
#     oa_service:
#       project_id: "8372255"
#       branch: "main"
#       environments:
#         local: { id: "<环境ID>", name: "本地网关", base_url: "http://127.0.0.1:8082" }
#         test:  { id: "<环境ID>", name: "测试环境", base_url: "https://test.example.com" }
#   routes:                                 # API 域/受影响仓库 → 项目，前端改 PHP API 时也按此路由
#     employee_contract:
#       project: "oa_platform"
#       repositories: ["oa-platform", "oa-app-employee", "oa-frontend-intergration"]
#       api_prefixes: ["/frontend/employee/**"]
```

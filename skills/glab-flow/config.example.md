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

# jenkins:
#   job_name: "oa-service"
#   branch_param: "oa_branch"            # 默认 oa_branch
#   default_params: { deploy_type: "api", test_version: "kn" }

# databases:
#   main: { mcp: "mcp__platform-local__mysql_query", desc: "主数据库" }

# test_environments:
#   default:
#     url: "http://your-test-env.example.com"
#     account: ""
#     password: ""
#     desc: "默认测试环境"
```

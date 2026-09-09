---
name: glab-flow-test-config-example
description: glab-flow 测试配置示例。放到 <workspace.root>/.glab-flow/test-config.md;统一 local/test 环境上下文、脚本运行根、可选 Apifox 项目索引、数据库MCP、前端构建、测试数据和账号。
---

# glab-flow 测试配置(示例)

> 边界:**环境切换只走这里**——local/test 的 URL、账号、数据库引用、测试数据前缀、脚本根目录和可选 Apifox 环境索引集中管理，测试脚本不得自己硬编码环境事实。
> 本文件承载测试运行上下文:**改动仓库 → 该用哪个测试入口**(routes)、脚本运行根、数据库 MCP 引用、前端构建策略、测试数据策略、测试账号；Apifox 项目索引是可选能力，只在测试计划声明 Apifox 资产时使用。
> 消费方:glab-flow 的 local 与 test TestRun（`pnpm cli test-config`）。二者采用同一份版本化 test-plan，只切换环境 Profile；本配置不授予 Codex shell 或 Apifox 外部 AI 写入权限。
> 资产治理:本配置只提供环境 Profile；本地测试脚本由 test-plan 的 `script:` 声明并放在统一脚本根；Apifox 场景/套件/数据集只有在 test-plan 声明 `asset:` 时才需要 `apifox-asset-audit`。
> 消费命令:`cat <本文件> | pnpm cli test-config --repos <改动仓库,逗号分隔> --env <环境名> [--iid <iid>]` → 完备测试上下文(配置送到脸上,不靠找)。

```yaml
# ---- 环境矩阵:每个环境一个 Profile(索引 Apifox 项目+环境,不复制 base_url) ----
environments:
  local:                              # 本地 Docker 完整业务闭环（开发中→测试中门禁）
    apifox: { project: sample_web, env: local }
    databases:                        # 键 → config.md databases 的引用(连接信息在交付配置)
      platform: local_platform
      tenant: local_tenant
    frontend:                         # 本地前端构建(仅本地环境;测试环境由 CI 构建禁止本地 build)
      build: "pnpm build:backend"
      workdir: "/path/to/business-workspace/frontend"
      output: "/path/to/business-workspace/public/frontend"
    test_data:
      prefix: "E2E{iid}L"                       # L/T 后缀隔离环境数据
      cleanup_required: true
      prohibited: [非本需求前缀数据]
      seed_files: [".glab-flow/{iid}/spec/fixtures/华东客户合同续费.sql"]  # E0 数据预检必须可读
      asset_retention: "promote-shared"          # preserve | promote-shared | cleanup
      realistic_naming: true                     # 测试数据命名必须贴近真实业务
    credentials:
      account: "developer@example.test"
      password: "<本地密码>"
      vars: { account: local_client_email, password: local_client_password }  # 场景 {{变量名}} 映射,执行时按名注入
    login: { owner: sample_web, endpoint: "/api/login", token_var: access_token }  # 共用登录契约:所有项目从此拿 token
    web_url: "http://app.local.test"   # 前端入口(E2E 浏览器用;API base 以 Apifox 环境为准)
    scripts:
      root: ".glab-flow/{iid}/tests/local"       # 本需求脚本统一根;test-plan 的 script 路径相对此目录
      command: "pnpm test:flow -- --env=local"   # 默认执行命令;case 可在 test-plan 中声明更细命令
      env_file: ".glab-flow/{iid}/env/local.env" # 可选;由 Leader 生成/维护,不得含生产凭据
      variables: { BASE_URL: "http://app.local.test", TEST_DATA_PREFIX: "E2E{iid}L" }
    desc: "本地 Docker；前端必须构建到业务应用目录"

  test:                               # 已部署测试环境完整业务闭环（测试中→待发布门禁）
    apifox: { project: sample_web, env: test }
    databases: { platform: test_platform }
    test_data:
      prefix: "E2E{iid}T"
      cleanup_required: true
      prohibited: [本地E2E数据]
      seed_files: [".glab-flow/{iid}/spec/fixtures/华东客户合同续费.sql"]
      asset_retention: "promote-shared"
      realistic_naming: true
    credentials: { account: "qa@example.test", password: "<测试密码>" }
    web_url: "https://app.test.example"
    scripts:
      root: ".glab-flow/{iid}/tests/test"
      command: "pnpm test:flow -- --env=test"
      env_file: ".glab-flow/{iid}/env/test.env"
      variables: { BASE_URL: "https://app.test.example", TEST_DATA_PREFIX: "E2E{iid}T" }
    desc: "测试环境；由 CI/Jenkins 构建部署，禁止本地 build"

# ---- Apifox 项目索引:名字 → ID(启动时可用 CLI 校验,漂移即改这里) ----
apifox_projects:
  sample_web:                         # Web 应用/前端集成的接口测试项目
    project_id: "<项目 ID>"
    branch: "main"
    envs: { local: "<本地环境 ID>", test: "<测试环境 ID>" }   # 环境名 → Apifox 环境 ID
  sample_service:                     # 后端服务的接口测试项目
    project_id: "<项目 ID>"
    branch: "main"
    envs: { local: "<本地环境 ID>", test: "<测试环境 ID>" }

# ---- 仓库 → Apifox 项目路由:改了哪些仓,就用哪个项目测(核心索引) ----
routes:
  - repos: [web-app, frontend]                       # Web 应用/前端改动
    apifox: sample_web
  - repos: [service-api, gateway]                    # 后端服务改动
    apifox: sample_service
```

## 字段说明

| 键 | 必填 | 说明 |
|---|---|---|
| `environments.<name>.apifox` | Apifox 用例时必填 | `{project, env}` 索引——project 指向 apifox_projects 的键,env 指向该项目的环境名(用于取环境 ID) |
| `environments.<name>.databases` | — | 键→引用映射;值是 `config.md` 里 `databases` 的键名(如 `local_platform`),引擎只透传键,Leader 用它查 MCP |
| `environments.<name>.frontend` | — | 本地构建策略;`test` 环境不配(禁本地 build) |
| `environments.<name>.test_data` | 数据用例时必填 | `{iid}` 占位在 test-context 输出时替换为本 Issue iid；`seed_files` 必须是受管相对路径；`asset_retention` 表示执行产生的数据保留/升级策略；`realistic_naming=true` 表示禁用 test/demo/tmp 占位命名 |
| `environments.<name>.credentials.vars` | — | 场景变量名映射:account/password 的 `{{名}}`,执行时按名注入(不落 Apifox) |
| `environments.<name>.login` | — | 共用登录契约:`owner`(持有登录接口的项目)/`endpoint`/`token_var`(token 变量名);跨项目统一从此拿 token |
| `environments.<name>.credentials` | — | 测试账号(可持久化到 Apifox 环境/全局变量以减少注入步骤;生产凭据除外) |
| `environments.<name>.web_url` | — | 前端入口(E2E);API base 不在这里,以 Apifox 环境的 baseUrls 为准 |
| `environments.<name>.scripts` | 脚本测试时必填 | 统一脚本根、默认命令、env 文件和环境变量模板；`root` / `env_file` 必须是受管相对路径，不能以 `/` 开头或包含 `..`；`{iid}`/`{env}` 会在输出时替换 |
| `apifox_projects.<name>` | Apifox 用例时必填 | 项目 ID + 环境名→环境 ID 索引;环境 ID 缺失时 test-context 报错退出 |
| `routes[]` | ✅ | `repos` 命中任一即启用该路由；带 `apifox` 时推导 Apifox 项目，不带时表示纯脚本测试路由 |

## 输出示例

```bash
cat .glab-flow/test-config.md | pnpm cli test-config --repos web-app,frontend --env local --iid 172
```
```json
{
  "env": "local",
  "apifox": { "project": "sample_web", "projectId": "<项目 ID>", "branch": "main", "envName": "local", "envId": "<本地环境 ID>" },
  "apifoxTargets": [ { "project": "sample_web", "projectId": "<项目 ID>", "envId": "<本地环境 ID>" } ],  // 多项目需求含多个，逐项目跑
  "login": { "owner": "sample_web", "endpoint": "/api/login", "tokenVar": "access_token" },
  "databases": { "platform": "local_platform", "tenant": "local_tenant" },
  "frontend": { "build": "pnpm build:backend", "workdir": "...", "output": "..." },
  "testData": {
    "prefix": "E2E172",
    "cleanupRequired": true,
    "seedFiles": [".glab-flow/172/spec/fixtures/华东客户合同续费.sql"],
    "assetRetention": "promote-shared",
    "realisticNaming": true
  },
  "credentials": { "account": "developer@example.test", "password": "..." },
  "webUrl": "http://app.local.test",
  "scripts": {
    "root": ".glab-flow/172/tests/local",
    "command": "pnpm test:flow -- --env=local",
    "envFile": ".glab-flow/172/env/local.env",
    "variables": { "BASE_URL": "http://app.local.test", "TEST_DATA_PREFIX": "E2E172L" }
  },
  "resolution": { "repos": ["web-app", "frontend"], "matchedRoutes": ["sample_web"], "unmatchedRepos": [], "scriptOnlyRoutes": [] },
  "warnings": []
}
```

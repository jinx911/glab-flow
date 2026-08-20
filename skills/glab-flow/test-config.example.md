---
name: glab-flow-test-config-example
description: glab-flow 测试配置示例。放到 <workspace.root>/.glab-flow/test-config.md;Apifox 是测试资产事实源,本配置只承载 Apifox 不知道的(仓库→项目映射/环境ID索引/数据库MCP/前端构建/测试数据/账号)。
---

# glab-flow 测试配置(示例)

> 边界:**Apifox 能承载的不在这里**——环境 base_url、接口定义、用例、套件、报告都以 Apifox 为准(本文件只存"项目名→ID/环境名→ID"索引)。
> 本文件承载 Apifox 不知道的:**改动仓库 → 该用哪个 Apifox 项目测**(routes)、数据库 MCP 引用、前端构建策略、测试数据策略、测试账号。
> 消费方:glab-flow 开发中自测 / 测试中(`pnpm cli test-context`)。test-flow 用 `.claude/project-config.md`,与本文互不相干。
> 消费命令:`cat <本文件> | pnpm cli test-config --repos <改动仓库,逗号分隔> --env <环境名> [--iid <iid>]` → 完备测试上下文(配置送到脸上,不靠找)。

```yaml
# ---- 环境矩阵:每个环境一个 Profile(索引 Apifox 项目+环境,不复制 base_url) ----
environments:
  local:                              # 本地 Docker 开发自测(开发中自测用)
    apifox: { project: oa_platform, env: local }
    databases:                        # 键 → config.md databases 的引用(连接信息在交付配置)
      platform: local_platform
      tenant: local_tenant_kn
    frontend:                         # 本地前端构建(仅本地环境;测试环境由 CI 构建禁止本地 build)
      build: "pnpm build:backend"
      workdir: "/Users/<you>/IdeaProjects/oa/oa-frontend-intergration"
      output: "/Users/<you>/IdeaProjects/oa/oa-platform/public/frontend"
    test_data: { prefix: "E2E{iid}", cleanup_required: true, prohibited: [非本需求前缀数据] }
    credentials: { account: "you@kn.group", password: "<本地密码>" }
    web_url: "http://tenant.oa.com"   # 前端入口(E2E 浏览器用;API base 以 Apifox 环境为准)
    desc: "本地 Docker;前端必须构建到 oa-platform"

  test:                               # 已部署测试环境(测试中验收用)
    apifox: { project: oa_platform, env: test }
    databases: { platform: test_platform }
    test_data: { prefix: "E2E{iid}", cleanup_required: true, prohibited: [本地E2E数据] }
    credentials: { account: "qa@kn.group", password: "<测试密码>" }
    web_url: "https://stage-oa.kuainiu.io"
    desc: "Stage 测试环境;由 CI/Jenkins 构建部署,禁止本地 build"

# ---- Apifox 项目索引:名字 → ID(启动时可用 CLI 校验,漂移即改这里) ----
apifox_projects:
  oa_platform:                        # 平台/PHP 模块/前端集成 的接口测试项目
    project_id: "8731182"
    branch: "main"
    envs: { local: "48389105", test: "48357135" }   # 环境名 → Apifox 环境 ID
  oa_service:                         # Java 后端(oa-service/oa-gateway)的接口测试项目
    project_id: "8372255"
    branch: "main"
    envs: { local: "46095111", test: "46538004" }

# ---- 仓库 → Apifox 项目路由:改了哪些仓,就用哪个项目测(核心索引) ----
routes:
  - repos: [oa-platform, oa-frontend-intergration]   # 平台/模块/前端改动
    apifox: oa_platform
  - repos: [oa-service, oa-gateway]                  # Java 后端改动
    apifox: oa_service
```

## 字段说明

| 键 | 必填 | 说明 |
|---|---|---|
| `environments.<name>.apifox` | ✅ | `{project, env}` 索引——project 指向 apifox_projects 的键,env 指向该项目的环境名(用于取环境 ID) |
| `environments.<name>.databases` | — | 键→引用映射;值是 `config.md` 里 `databases` 的键名(如 `local_platform`),引擎只透传键,Leader 用它查 MCP |
| `environments.<name>.frontend` | — | 本地构建策略;`test` 环境不配(禁本地 build) |
| `environments.<name>.test_data` | — | `{iid}` 占位在 test-context 输出时替换为本 Issue iid |
| `environments.<name>.credentials` | — | 测试账号(明文已确认可接受;不持久化到 Apifox) |
| `environments.<name>.web_url` | — | 前端入口(E2E);API base 不在这里,以 Apifox 环境的 baseUrls 为准 |
| `apifox_projects.<name>` | ✅ | 项目 ID + 环境名→环境 ID 索引;环境 ID 缺失时 test-context 报错退出 |
| `routes[]` | ✅ | `repos` 命中任一即用 `apifox` 项目;多项目命中取第一个并 warning |

## 输出示例

```bash
cat .glab-flow/test-config.md | pnpm cli test-config --repos oa-platform,oa-frontend-intergration --env local --iid 172
```
```json
{
  "env": "local",
  "apifox": { "project": "oa_platform", "projectId": "8731182", "branch": "main", "envName": "local", "envId": "48389105" },
  "databases": { "platform": "local_platform", "tenant": "local_tenant_kn" },
  "frontend": { "build": "pnpm build:backend", "workdir": "...", "output": "..." },
  "testData": { "prefix": "E2E172", "cleanupRequired": true },
  "credentials": { "account": "you@kn.group", "password": "..." },
  "webUrl": "http://tenant.oa.com",
  "resolution": { "repos": ["oa-platform", "oa-frontend-intergration"], "matchedRoutes": ["oa_platform"], "unmatchedRepos": [] },
  "warnings": []
}
```

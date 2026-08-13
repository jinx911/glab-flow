---
name: glab-flow-config
description: glab-flow 配置格式与查找链。项目配置在 <workspace.root>/.glab-flow/config.md（由 /init-glab-flow 生成）。
---

# glab-flow 配置格式与查找链

glab-flow 是自包含的 GitLab-native 流程引擎：所有项目相关的参数（GitLab 实例、项目、工作区根、分支命名、run 模式、Jenkins、数据库、测试环境）都集中在一个 markdown 配置文件里，引擎通过确定性解析器读取，Leader（编排者）从不在代码里硬编码这些值。本文件规定配置的格式、查找链与字段语义。

## 格式

配置文件是一个 markdown 文档，**有且只有一个** ` ```yaml ` 围栏代码块。引擎只解析这个代码块，围栏之外的文字（标题、说明、注释）给人看，不影响解析。

解析命令（在 glab-flow 仓库根执行）：

```bash
cat <config.md 路径> | pnpm cli config
```

stdin 是整份 markdown 文件内容，stdout 是 `GlabConfig` JSON。解析器（`engine/src/config.ts` 的 `parseConfig`）用正则 `` ```yaml\n([\s\S]*?)\n``` `` 精确匹配第一个 yaml 围栏块；匹配不到 → 抛 `config: no \`\`\`yaml fenced block found`。因此文件必须包含字面量 `` ```yaml `` 起始围栏和 `` ``` `` 结束围栏，且两者各自独占一行（不要在围栏上加点缀）。

代码块内的键使用 snake_case，对应 YAML 语义。**必填键**：

- `gitlab.host` —— GitLab 实例域名，供 `glab api --hostname <host>` 使用。
- `gitlab.project_id`（或 `gitlab.project_path`）—— 项目标识。`project_id` 是数字 ID（如 `"3915"`），`project_path` 是全路径（如 `"oa/oa"`）。二者任给其一即可；都给则以 `project_id` 为准。
- `workspace.root` —— 业务工作区根目录的绝对路径。`.glab-flow/` 基础设施目录与 `<iid>/spec/` 文档目录都落在这里，**不是** glab-flow 引擎仓库。

**可选键**（不配则取默认或跳过对应能力）：

- `gitlab.harness_clone` —— harness 仓库的本地克隆路径（如 `/Users/.../oa-ai-native-harness`）。配了之后 Leader 可在该目录直接跑 `glab issue ...`，glab 自动从 remote 推断 host/project；不配则用 `glab api --hostname <host> "<path>"` 显式调用。
- `branch_naming.format` —— 分支命名模板，默认 `"{type}/{iid}"`。
- `branch_naming.type_map` —— Issue 类型到分支前缀的映射，默认 `{ story: feat, bug: fix }`。
- `run_mode` —— `semi-auto`（默认）或 `full-auto`；决定门禁预览是展示后 AskUserQuestion 还是护栏 ok 即自动应用（hard_gate 两模式都强制人工，见 `gate.md`）。
- `deploy_branch` —— 自动部署目标分支（如 `"test"`）；不配则发布节点跳过合并这一步。
- `roles` —— 角色 → 默认 `@用户` 映射（如 `{ 产品: "@a", 研发: "@b", 测试: "@c" }`）。Issue 正文无「交付协同」表时，引擎按目标节点 `assigneeRole` 从此兜底，免去每个节点反复反问。
- `jenkins.job_name` / `jenkins.branch_param` / `jenkins.default_params` —— 单仓 Jenkins 构建参数；`branch_param` 默认 `"oa_branch"`。
- `jenkins.jobs` —— 多仓 Jenkins 作业映射，每项 `{ job_name, branch_param?, env_param?, default_params? }`，键为仓库名（如 `oa-service`、`oa-frontend`）。配了之后 jenkins-deploy 按当前操作仓库选 job + 参数模板；与单 `job_name` 可共存。
- `databases` —— 命名的数据库 MCP 映射，每项 `{ mcp, desc? }`，如 `main: { mcp: "mcp__platform-local__mysql_query", desc: "主数据库" }`。建议按环境命名（`local` / `stage` / `prod`）。
- `test_environments` —— 命名的测试环境，每项 `{ url, account?, password?, desc? }`；多环境时分别列出（如 `local` / `stage`）。

完整模板见同目录的 `config.example.md`——直接复制、改值即可。

## 查找链（按顺序）

Leader 启动 glab-flow 时按下面的顺序找第一份存在的配置文件，找到即停：

1. **项目级（首选）**：`<workspace.root>/.glab-flow/config.md`。这是规范落点，随项目工作区走。Leader 用 `bash` 检查：`[ -f "$ROOT/.glab-flow/config.md" ] && echo found`。`workspace.root` 通常来自用户调用 `/glab-flow <iid>` 时的当前业务工作区或 `$ARGUMENTS`。
2. **全局兜底**：`~/.claude/skills/glab-flow/config.md`。用户可把一份通用配置放这里，覆盖多个没有项目级配置的工作区。仅当项目级不存在时才回退到此。
3. **都没有**：Leader 用 `AskUserQuestion` 引导用户运行 `/init-glab-flow <workspace.root>` 生成项目级配置，再继续。不要让 flow 在无配置下裸跑——`gitlab.host`/`project_id`/`workspace.root` 缺一不可。

查找链只解决"配置文件在哪"，不解决"配置值是什么"。一旦选定文件，所有字段都从该文件解析得到，Leader 不在两份配置间混取。

## Leader 读取流程

定位到配置文件后，Leader 按以下步骤把它变成可用的 `GlabConfig`：

1. 在链中自上而下找到第一份存在的文件，记其路径为 `<chosen>`。
2. 在 glab-flow 仓库根执行 `cat <chosen> | pnpm cli config`，捕获 stdout。这是唯一的解析入口——不要自己 split YAML、不要 sed 取键。
3. 解析失败（进程非 0 退出或 stderr 有 `config: ...` 报错）→ 把错误贴给用户，引导修配置或重跑 `/init-glab-flow`，不继续 flow。
4. 解析成功 → 得到 `GlabConfig` JSON。从此对象派生后续编排所需的全部项目参数：
   - `workspace.root` ← `config.workspace.root`
   - `gitlab.host` ← `config.gitlab.host`
   - `gitlab.project_id` ← `config.gitlab.projectId`（或 `project_path`，取决于用户填法；解析后统一落在 `gitlab.projectId`）
   - `run_mode` ← `config.runMode`
   - 可选项按需读取（`deployBranch` / `jenkins` / `databases` / `testEnvironments`）。

**绝不硬编码** `host`/`project_id`/`workspace.root`——这三个值因项目而异，写死会让 glab-flow 只能服务一个项目。同一份引擎 + 不同配置 = 不同项目的流程驱动。

## 字段说明表

下表与 `config.example.md` 一一对应；YAML 键名以配置文件里的 snake_case 为准，"解析后字段"是 `GlabConfig` JSON 里的驼峰路径。

| YAML 键 | 必填/可选 | 解析后字段 | 用途 |
|---|---|---|---|
| `gitlab.host` | 必填 | `gitlab.host` | GitLab 实例域名；`glab api --hostname` 用 |
| `gitlab.project_id` | 必填* | `gitlab.projectId` | 项目数字 ID（如 `"3915"`）；与 `project_path` 二选一 |
| `gitlab.project_path` | 必填* | `gitlab.projectId` | 项目全路径（如 `"oa/oa"`）；与 `project_id` 二选一 |
| `gitlab.harness_clone` | 可选 | `gitlab.harnessClone` | harness 本地克隆路径；配了可在该目录直接跑 `glab issue` |
| `workspace.root` | 必填 | `workspace.root` | 业务工作区根；`.glab-flow/` 与 `<iid>/spec/` 落点 |
| `branch_naming.format` | 可选 | `branchNaming.format` | 分支命名模板，默认 `"{type}/{iid}"` |
| `branch_naming.type_map` | 可选 | `branchNaming.typeMap` | 类型→分支前缀映射，默认 `{ story: feat, bug: fix }` |
| `run_mode` | 可选 | `runMode` | `semi-auto`（默认）或 `full-auto`；门禁执行模式 |
| `deploy_branch` | 可选 | `deployBranch` | 自动部署分支；不配则发布节点跳过合并 |
| `roles` | 可选 | `roles` | 角色→默认 `@用户` 映射；无交付协同表时兜底 |
| `jenkins.job_name` | 可选 | `jenkins.jobName` | 单仓 Jenkins 构建作业名 |
| `jenkins.branch_param` | 可选 | `jenkins.branchParam` | 分支参数名，默认 `"oa_branch"` |
| `jenkins.default_params` | 可选 | `jenkins.defaultParams` | 默认构建参数键值表 |
| `jenkins.jobs.<repo>.job_name` | 可选 | `jenkins.jobs.<repo>.jobName` | 多仓作业映射，键为仓库名 |
| `jenkins.jobs.<repo>.branch_param` | 可选 | `jenkins.jobs.<repo>.branchParam` | 该仓库的分支参数名 |
| `jenkins.jobs.<repo>.env_param` | 可选 | `jenkins.jobs.<repo>.envParam` | 该仓库的环境参数名（如 `DEPLOY_ENV`） |
| `jenkins.jobs.<repo>.default_params` | 可选 | `jenkins.jobs.<repo>.defaultParams` | 该仓库的默认构建参数 |
| `databases.<name>.mcp` | 可选 | `databases.<name>.mcp` | 数据库 MCP 工具名（如 `mcp__platform-local__mysql_query`） |
| `databases.<name>.desc` | 可选 | `databases.<name>.desc` | 数据库说明 |
| `test_environments.<name>.url` | 可选 | `testEnvironments.<name>.url` | 测试环境地址 |
| `test_environments.<name>.account` | 可选 | `testEnvironments.<name>.account` | 测试环境账号 |
| `test_environments.<name>.password` | 可选 | `testEnvironments.<name>.password` | 测试环境密码 |
| `test_environments.<name>.desc` | 可选 | `testEnvironments.<name>.desc` | 测试环境说明 |
| `repos` | 可选 | `repos` | 多仓项目全部可能涉及的仓库 path 清单;声明后 transition 启用 MR 覆盖性校验(测试中→待发布 时每个 repo 须在 `mergeRequests` 或 `artifactContext.reposWithoutMr` 显式表态,防漏评一个仓的 MR) |

\* `project_id` 与 `project_path` 至少给一个；都给以 `project_id` 为准；都不给 → 解析器抛 `missing required fields`。

`jenkins.*` 启用条件：`job_name` 或 `jobs` 任一存在即启用 Jenkins 能力（`default_params` 缺省为空表，`branch_param` 缺省 `"oa_branch"`）；两者皆空则不启用。`roles` / `databases` / `test_environments` 都是命名映射，按需列出每项；整个键缺省则该能力不可用。`repos` 是字符串数组(仓库 path 清单),缺省则 MR 覆盖性校验跳过(向后兼容);多仓项目建议声明,以在测试中→待发布 强制每个仓的 MR 处置显式表态。

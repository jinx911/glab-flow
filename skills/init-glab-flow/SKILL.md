---
name: init-glab-flow
description: 探测 GitLab 环境并生成 <workspace.root>/.glab-flow/config.md（交付流程）与 test-config.md（测试配置）。
---

# /init-glab-flow：生成项目级 glab-flow 配置

`/init-glab-flow` 是一次性的环境探测与配置生成命令。开始前必须确认全量安装已通过：在 glab-flow 仓库根运行 `scripts/doctor.sh --workspace <workspace.root>`，有任何 `FAIL` 都先修复，不能带缺口生成配置。通过后它询问少量必要信息，以 `skills/glab-flow/config.example.md` + `skills/glab-flow/test-config.example.md` 为模板，把探测到的值分别填进：

- `<workspace.root>/.glab-flow/config.md` — **交付流程配置**（GitLab/分支/Jenkins/数据库索引）
- `<workspace.root>/.glab-flow/test-config.md` — **测试配置**（Apifox 项目路由/环境 ID/凭据变量/测试数据策略；接口测试启用时才生成）

让 `/glab-flow <iid>` 能在该工作区直接跑起来。**本命令只写配置基础设施，不写业务代码、不动 Issue。**

## 输入

`$ARGUMENTS` = workspace root（业务工作区根目录的绝对路径），可选。

- 给了 → 直接用作 `<workspace.root>`。
- 没给 → Leader 用 `AskUserQuestion` 问用户一个工作区根目录（提示："请提供业务工作区根目录的绝对路径（例如 `/path/to/business-workspace`），glab-flow 会在这里建 `.glab-flow/` 基础设施目录。"），拿到后继续。

## 探测步骤（Leader 执行）

按顺序逐步探测。每一步凡是有歧义都用 `AskUserQuestion` 让用户拍板，不要替用户猜。

1. **确定 `workspace.root`**。取 `$ARGUMENTS` 或上一步问到的路径。Leader 执行 `mkdir -p <root>/.glab-flow` 建好基础设施目录（这是 glab-flow 自己的工作目录，不是业务代码仓的 `docs/`，不污染代码仓）。最终配置会写到 `<root>/.glab-flow/config.md`，state 文件 `<root>/.glab-flow/<iid>-state.json`，spec 文档 `<root>/.glab-flow/<iid>/spec/`。

2. **探测 GitLab host**。Leader 跑 `glab auth status` 列出已登录的 host；若只有一个则请用户确认，多个则让用户选择，未登录则先完成登录。host 必须是裸域名，不带 `https://`、不带末尾 `/`。

3. **探测项目**。`AskUserQuestion` 问用户给 `project_id`（数字 ID）或 `project_path`（`namespace/name` 全路径）。不确定时 Leader 可辅助查询：`glab api --hostname <host> "projects?search=<关键字>&per_page=20"` 列出候选项目的 `id` 与 `path_with_namespace`，让用户从列表里挑。最终在配置里写用户确认的那一个。

4. **选 `run_mode`**。`AskUserQuestion` 二选一：
   - `semi-auto`（默认，推荐）：每个节点门禁预览后 `AskUserQuestion` 确认再应用。
   - `full-auto`：护栏全 ok 即自动应用，仅在 hard_gate（待发布/验收/关闭）强制人工。
   两模式的红线一致——hard_gate 永远人工（G3），不可关。

5. **可选项**（一次性逐项问，用户说"跳过"就不配）：
   - `deploy_branch`：是否要自动部署到某分支（如 `test`）？是 → 填分支名；否 → 不配（发布节点跳过合并）。
   - `jenkins`：是否配 Jenkins 构建？是 → 收 `job_name`（必填）、`branch_param`（默认 `branch`）、`default_params`（键值表，可空）。
   - `databases`：是否声明逻辑数据目标？是 → 收 `<name>: { mcp, desc }` 对；不收连接串、密码或 Token。测试租户只记录 `websites.uuid` 解析规则，DMS 的 RDS/镜像选择留到执行时由用户确认。

6. **测试配置**（要做接口/E2E 测试才生成，跳过则整个 test-config.md 不建）：
   - `apifox_projects`：对每个接口测试项目收 `{ project_id, branch, envs: {local, test} }`（环境名 → Apifox 环境 ID；用 `apifox environment list --project <id>` 现场探测）。
   - `routes`：改动仓库 → Apifox 项目映射（改哪些仓用哪个项目测）。
   - `environments`：`local`/`test` 各一个 Profile——数据库引用、前端构建（本地）、测试数据前缀（`E2E{iid}L/T`）、凭据变量名（`credentials.vars`）、共用登录契约（`login.owner/endpoint/token_var`）、`web_url`。
   - `variables_file`：固定 `.glab-flow/apifox-vars.json`——**同步生成该文件**（`environments[]` 每环境条目存凭据值 + data_prefix，格式见 test-config.example）。⚠️ CLI 只认 `--variables` 文件（环境 UI 配的变量运行时不生效，实测坐实）。
   - 明文凭据策略：test-config 与 vars 文件落在 `.glab-flow/`（gitignore 范围）内可存明文；若团队要求更高，值留占位由用户手填。

## 生成

Leader 以 `skills/glab-flow/config.example.md` 为模板，把上面探测到的值填进 yaml 围栏块（必填项就填实值，未开启的可选项保持注释或删除）。写到：

```
<workspace.root>/.glab-flow/config.md
```

测试配置以 `skills/glab-flow/test-config.example.md` 为模板写到 `<workspace.root>/.glab-flow/test-config.md`（步骤 6 跳过则不生成），并同时生成 `<workspace.root>/.glab-flow/apifox-vars.json`。

文件保留 frontmatter（`name: glab-flow-config-example` 仅是模板自带说明，生成到项目时 frontmatter 可保留也可去掉，引擎只看 ` ```yaml ` 围栏块，不解析 frontmatter）。保持 markdown 标题与注释，方便人读。

## 校验

写完后在 **glab-flow 仓库根** 执行校验（不是业务工作区）：

```bash
cat <workspace.root>/.glab-flow/config.md | pnpm cli config
cat <workspace.root>/.glab-flow/test-config.md | pnpm cli test-config --repos <仓库,逗号分隔> --env local   # 生成了 test-config 才跑
```

期望：config 输出合法 JSON（`gitlab.host`/`gitlab.projectId`/`workspace.root`/`runMode`）；test-config 输出 TestContext JSON（`apifoxTargets[].envId` 非空、无 warnings 或 warnings 已解释）。若失败（stderr 出现 `config: ...` / `test-config: ...`）→ 读错误信息定位缺哪个键、哪个围栏不对，修文件后再跑，直到 JSON 合法。**未通过校验不算完成**——`/glab-flow` 在坏配置上会直接挂。

## 完成提示

校验通过后，Leader 给用户一句确认：

> config 已写入 `<workspace.root>/.glab-flow/config.md`（+ test-config.md / apifox-vars.json）。可用 `/glab-flow <iid>` 开始。

并附带一行解析出的关键字段摘要（host / projectId / root / runMode；测试启用时附 apifox 项目与 envId），让用户一眼确认探测无误。若用户想改某个值，直接编辑该文件后再跑一次校验命令即可，不必重跑 `/init-glab-flow`。

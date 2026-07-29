---
name: glab-flow
description: 当用户提供 GitLab Issue URL/编号，需要按 harness 状态机驱动需求从分诊到上线/验收时使用。引擎只做确定性计算（节点/校验/计划/渲染/配置/状态），GitLab 读写由 Leader 直接用 glab CLI 完成，每次写回前预览确认。自有配置与状态缓存，不依赖任何外部 skill。
---

# glab-flow：harness GitLab 状态机驱动引擎

glab-flow 是 GitLab-native、自包含的流程引擎：引擎只做确定性计算（节点推导 / 护栏校验 / 计划构建 / 文本渲染 / 配置解析 / 状态初始化），所有 GitLab 读写由 Leader 直接用 glab CLI 完成，每次写回前预览确认。项目参数走配置文件，不在代码里硬编码；文档落自有工作目录，不进代码仓。

## 输入

`$ARGUMENTS` = GitLab Issue URL 或 iid。

为空（`/glab-flow` 无参）→ 按 `resume.md` 列出未完成 flow：扫描 `<workspace.root>/.glab-flow/*-state.json`，让用户选一个恢复，或开新 flow。

## 配置（启动第一件事）

glab-flow 是配置驱动的——`host`/`project_id`/`workspace.root` 等参数因项目而异，绝不写死。每次启动 flow，**先读 config**：

1. 按 `config.md` 的查找链取**首个存在**的配置文件（项目级 `<workspace.root>/.glab-flow/config.md` → 全局兜底 `~/.claude/skills/glab-flow/config.md`）。
2. 在 glab-flow 仓库根跑解析：

   ```bash
   cat <config.md 路径> | pnpm cli config
   ```

   stdout 是 `GlabConfig` JSON，从中派生后续编排所需的全部项目参数：`gitlab.host` / `gitlab.projectId` / `workspace.root` / `runMode`（以及可选项 `harnessClone` / `deployBranch` / `jenkins` / `databases` / `testEnvironments`）。

3. 解析失败 → 把错误贴给用户，引导重跑 `/init-glab-flow`。配置文件不存在（查找链都没命中）→ 用 `AskUserQuestion` 引导运行 `/init-glab-flow <workspace.root>` 生成项目级配置后再继续——**不让 flow 在无配置下裸跑**。

配置格式、字段语义、查找链细节见 `config.md`。

## 引擎（纯计算，无 I/O）

引擎仓库就是 glab-flow 自身。在仓库根执行：

```bash
cd /Users/eliojin/IdeaProjects/glab-flow && pnpm cli <cmd>
```

命令列表：

| 命令 | 作用 |
|---|---|
| `node` | 推导当前节点：`pnpm cli node <type> <labels...>` |
| `validate` | 护栏校验：stdin `{type,labels,payload}` → `{ok,missing,reasons}` |
| `render` | 渲染评论正文 |
| `plan` | 正向建写回计划：`pnpm cli plan <iid>`，stdin `{payload}` |
| `plan-return` | 退回建写回计划：stdin `{type,from,target,issues,confirmer,date,assigneeUser?}` |
| `evidence` | 从 GitLab notes 抽证据（确认人/日期/结论/阻塞验证） |
| `config` | 解析配置 markdown → `GlabConfig` JSON |
| `state-init` | 生成 state 文件：stdin `{iid,type,host,projectId,workspaceRoot,runMode?,now?}` → `RunState` |

引擎不做任何 GitLab 调用、不读文件系统之外的 I/O；所有副作用由 Leader 跑 glab 产生。

## GitLab 读写（Leader 直接 glab CLI）

Leader 直接用 glab CLI 操作 GitLab（glab 已认证，**无需 token**，不在环境里配 token）。两条路径，由配置决定走哪条：

- **有 `gitlab.harnessClone`**：在配置提供的 harness 克隆目录跑 `glab issue …`，glab 自动从 remote 推断 host/project。

  ```bash
  glab issue view <iid> --output json        # 从克隆目录跑
  glab issue update <iid> --label ... --unlabel ... --assignee <@user>
  glab issue note <iid> -m "<正文>"
  glab issue close <iid>
  ```

- **无 `harnessClone` 或需显式调用**：用 `glab api`，host 与 path 来自配置（`gitlab.host` / `gitlab.projectId`）：

  ```bash
  glab api --hostname <host> "projects/<id>/issues/<iid>"
  glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100"
  ```

`<host>` 与 `<id>` 一律从 `GlabConfig` 取，不在命令里硬编码域名或项目号。

## Leader 每轮编排

每个节点、每轮都按这 8 步走（门禁细节见 `gate.md`）：

1. **读状态**：用 config 提供的 `host`/`projectId`/`harnessClone`，跑 `glab issue view <iid> --output json` → 取 labels/description；`pnpm cli node <type> <labels...>` 得当前节点。0 或 ≥2 个状态标签 → 脏状态，停，列给人工（见 `resume.md` 脏状态处理）。
2. **查契约**：从 `nodes.md` 取当前节点的下一节点 / 必填项 / 门禁 / Assignee 角色。
3. **判断证据是否齐**：证据齐 → 起草 Payload；不齐 → 委派节点工作 agent（见下文「内容生成」）生成缺失内容（评论/分支/spec 文档），不推进状态。
4. **护栏校验**：`pnpm cli validate`（stdin `{type,labels,payload}`）。`ok:false` → 停，把 `missing`+`reasons` 列给用户问需要补什么。
5. **构建写计划**：正向 `pnpm cli plan <iid>`（stdin `{payload}`）；退回 `pnpm cli plan-return <iid>`（门禁二值，见 `gate.md`）。
6. **预览确认**：把计划翻译成 glab 命令序列，以 diff 形式展示给用户（标签 add/remove、Assignee、评论正文、是否 close）。
7. **应用（Leader 直接跑 glab）**：按 `gate.md` 的 run 模式决定 AskUserQuestion 后应用还是护栏 ok 即自动应用；`hard_gate` 两模式都强制人工。命令见上文「GitLab 读写」。
8. **下一节点**：写回成功后更新 state 缓存（见下文），循环到「已完成」或用户停。

### 状态缓存

首轮进入 flow 时，Leader 用 `state-init` 生成 state 文件，把"上次到哪一步"缓存到本地：

```bash
echo '{...}' | pnpm cli state-init
# → 写到 <workspace.root>/.glab-flow/<iid>-state.json
```

之后每轮门禁写回 GitLab 成功后，更新 `cachedNode`/`cachedNodeAt`/`lastActions`/`updatedAt` 写回该文件；门禁走 `gate.md`；恢复（无参 `/glab-flow`）走 `resume.md`。**GitLab Issue 标签是唯一真理**，state 仅是派生缓存——两者不一致时以 GitLab 为准（对账逻辑见 `resume.md`）。

### Assignee 解析与证据抽取

- **Assignee 解析**：从 Issue 正文「交付协同」表取角色对应的 `@用户`（Leader 解析 description）；缺则反问用户，不接受角色名占位（G6）。
- **证据抽取**：

  ```bash
  glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100" | pnpm cli evidence
  ```

  从 notes 抽 `## 状态变更` 块的结构化证据（确认人/日期/结论/阻塞问题验证），供护栏 G1/G3/G11 取证。

## 门禁

每节点门禁仪式（取证 → 校验 → 计划 → 预览 → 确认 → 应用，6 步不可跳序）+ semi/full-auto 模式 + hard_gate 红线，全部见 `gate.md`。SKILL.md 不重复展开。

## 硬规则

要点（完整判定见 `guards.md` G1–G13）：

- 三类评审分离（G4）：reviewType 必须等于门禁要求，防技评/代码评审替代需求评审。
- 门禁二值（G2）：通过走 `plan`，退回走 `plan-return`，没有"附带条件通过"。
- hard_gate 人工（G3）：待发布 / 生产验收中 / 已完成 必须人工 `humanConfirmed`，无论 run 模式，不可关闭。
- 冻结不改原文/评论（G7/G8）：永不 `update --description`，永不 edit/delete 已发评论。
- 日期需确认（G10）：`datesConfirmed` 必须为真。
- Assignee 必须 `@用户`（G6），不接受角色名占位。
- 不建 Jira（G13）：流程只在 GitLab Issue 上走，不外建工单。
- 测试问题挂父需求（G11）：阻塞发布问题全部验证通过才放行待发布。

## 内容生成

节点内容生成由 `sub-skills/` 内置子 skill 提供——Leader 对每个节点 Read 对应子 skill 后内联执行，或 spawn `general-purpose` 以其为 prompt：

- 需求/方案 → `spec-author`
- 开发 → `git-ops` / `tdd-guide` / `code-review`
- 测试 → `test-design` / `test-flow-apifox`
- 发布 → `jenkins-deploy`

自带 agent（随 skill 一起定义，直接 spawn）：

- `intake` —— 分诊/澄清，读 triage Issue 产出澄清问题 + 建议分类 + 建议 Assignee。
- `review-preview` —— 需求评审预审，对照门槛产出评审意见 + 问题清单。
- `release-check` —— 发布前检查，产出风险等级 + 必补事项 + 发布后检查清单 + 回滚方案。

证据不足时（`validate` 返回 `ok:false`），委派对应子 skill/agent 生成缺失内容，落回 Issue 评论或 spec 文档后重走门禁——**门禁不通过 → 回去干活，而不是改门禁**。

## 文档落点

所有 issue 文档（需求草稿 / 技术方案 `design.md` / 测试计划 / 回滚等）统一落到：

```
<workspace.root>/.glab-flow/<iid>/spec/
```

路径来自配置（`workspace.root`，见 `config.md`）；`<iid>` 为 GitLab Issue iid。**禁止**写进代码仓（oa-service / oa-platform 等）的 `docs/`——文档归 Docs-as-Code 工作目录，代码仓只放代码。统一存储树见 `nodes.md`。

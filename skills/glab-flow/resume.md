---
name: glab-flow-resume
description: 从 .glab-flow/*-state.json 恢复未完成 flow；GitLab 标签为唯一真理，本地仅缓存。
---

# glab-flow 恢复（resume）

glab-flow 在 Issue 流转过程中会把"上次到哪一步"缓存到本地 `<workspace.root>/.glab-flow/<iid>-state.json`，让用户回到工作区或新开会话时能续上未完成的 flow。但这条缓存只是**派生数据**——流程的权威状态永远在 GitLab Issue 的标签上。本文件规定恢复入口、与 GitLab 的对账逻辑、state 持久化时机与脏状态处理。

## 真理源声明

**GitLab Issue 标签为唯一真理。** Issue 上的 `story-status::*` / `status::*` 状态标签代表流程真正所在节点，由 `pnpm cli node <type> <labels...>` 推导（见 SKILL.md）。`<workspace.root>/.glab-flow/<iid>-state.json` 里的 `cachedNode` 是上次本地写回后留下的快照，仅用于"快速展示进度 + 缩短恢复查询"，**不**是状态机本身。

这意味着：(a) 任何时候本地缓存与 GitLab 标签不一致，以 GitLab 为准；(b) 删掉 state 文件不会丢流程进度，只会让下次恢复多做一次 `glab issue view`；(c) state 文件可跨会话、跨机器重建，只要 Issue 还在。这一约定对应规格 §8 的"GitLab 单一真理 + 本地缓存"。

## 列出未完成 flow（`/glab-flow` 无参）

当用户运行 `/glab-flow` 不带 iid 时，Leader 进入"恢复选择"模式：

1. Leader 用 bash 列出所有 state 文件：

   ```bash
   ls <workspace.root>/.glab-flow/*-state.json 2>/dev/null
   ```

2. 对每个 `<iid>-state.json` 读出 `iid`、`cachedNode`、`updatedAt`、`runMode`，并按节点契约（`nodes.md`）算一个粗略进度条（例如 `分诊→草稿中→待评审→已评审→开发中→测试中→待发布→生产验收中→已完成`，根据 `cachedNode` 定位涂黑到哪一格）。

3. 用 `AskUserQuestion` 把列表展示给用户，每条一行格式参考：

   ```
   #<iid>  节点=cachedNode  [■■■□□□□□□] 3/9  模式=semi-auto  更新=2026-07-29 14:03
   ```

   让用户选一个要恢复的 iid，或选"都不选 / 开新 flow"。

4. **没有 state 文件**（`ls` 返回空）→ 直接提示：

   > 无未完成 flow，用 `/glab-flow <iid>` 开新 flow。

   不进入恢复流程。

`workspace.root` 从配置文件读取（见 `config.md` 查找链）；若配置也不存在，先引导跑 `/init-glab-flow`。

## 恢复流程（4 步，必须照此写）

选定要恢复的 `<iid>` 后，Leader 严格按下面 4 步执行。核心是"先问 GitLab，再对账本地"——顺序不能反。

1. **读 `<iid>-state.json`**。`cat <workspace.root>/.glab-flow/<iid>-state.json` 拿到 `RunState`，从中取 `type`（`story`/`bug`）、`project`（`{host, id}`）、`runMode`、`specDir`。这些决定后续用哪套状态机（story vs bug）、去哪个 GitLab 实例查、以及恢复后门禁按哪种 run 模式走。

2. **从 GitLab 重推导当前节点**。这是真理源查询，不能跳：
   - 取最新 Issue：`glab issue view <iid> --output json`。若**配置**里有 `gitlab.harness_clone`（`config.gitlab.harnessClone`），在该克隆目录跑（glab 自动识别 remote）；否则用 `glab api --hostname <host> "projects/<id>/issues/<iid>"`。
   - 从返回 JSON 取 `labels` 数组。
   - 推导节点：`pnpm cli node <type> <labels...>`（在 glab-flow 仓库根跑），stdout 的 `node` 即 **GitLab 当前节点**。

3. **对比 `cachedNode` vs GitLab 节点**。把 state 里的 `cachedNode` 与上一步 GitLab 推导出的节点字符串比较：
   - **一致** → 本地缓存有效，直接续；`cachedNodeAt` 不变。
   - **不一致** → **GitLab 为准**。Leader 停下来给用户一句明确提示：

     > 标签在 flow 外被改过（本地缓存=<cachedNode>，GitLab=<gitlabNode>），以 GitLab 为准。

     然后把 state 的 `cachedNode` 更新为 GitLab 节点、`cachedNodeAt` 刷成当前时间、`updatedAt` 同步，写回文件。继续按 GitLab 节点编排。

   不一致常见于：用户或他人在 GitLab UI 手改了标签、或上次写回失败但本地 state 已更新。绝不能反过来用 `cachedNode` 去"纠正"GitLab 标签。

4. **从当前节点继续 SKILL.md 编排循环**。节点定了之后，按 `SKILL.md` 的"Leader 每轮编排"走：查 `nodes.md` 契约 → 判断证据是否齐 → `validate` → `plan`/`plan-return` → 门禁预览确认（见 `gate.md`）→ glab 应用。恢复只是把 Leader 重新放到正确的节点上，后续动作与首次进入完全相同。

## state schema 参考

state 文件的 TypeScript 权威定义在 `engine/src/state.ts` 的 `RunState` 接口；初始化由 `pnpm cli state-init` 完成（stdin JSON `{iid,type,host,projectId,workspaceRoot,runMode?,now?}` → stdout `RunState`）。字段表：

| 字段 | 类型 | 用途 |
|---|---|---|
| `iid` | string | GitLab Issue iid |
| `type` | `'story' \| 'bug'` | Issue 类型，决定状态机分支 |
| `project.host` | string | GitLab 实例域名（从配置派生） |
| `project.id` | string | GitLab 项目 ID（从配置派生） |
| `cachedNode` | string | 上次写回后的节点名（派生缓存，非真理） |
| `cachedNodeAt` | string (ISO) | `cachedNode` 最后刷新时间 |
| `docVersion` | number | spec 文档版本号，初值 1 |
| `specDir` | string | spec 文档目录绝对路径（`<root>/.glab-flow/<iid>/spec`） |
| `runMode` | `'semi-auto' \| 'full-auto'` | 门禁执行模式 |
| `lastActions[]` | string[] | 最近动作审计尾迹（用于续接与回看） |
| `spawnedAgents[]` | string[] | 本 flow 已委派过的 agent 名单（去重/记账） |
| `lessonsCaptured` | number | 已反哺的 lesson 条数（已完成节点反哺 context/faq/cases 时 +1） |
| `updatedAt` | string (ISO) | state 最后写入时间 |

## 持久化时机

state 文件不是每条命令都写，只在以下时机落盘：

- **写回 GitLab 后**：每次 Leader 用 glab 成功推进节点（标签/Assignee/评论/关闭）后，更新 `cachedNode`、`cachedNodeAt`、`lastActions`（append 本次动作摘要）、`updatedAt`，写回 `<iid>-state.json`。失败则不更新——让缓存留在上一个确定态。
- **capture lesson 后**：在已完成节点的反哺环节（context/faq/cases），每捕获一条 lesson，`lessonsCaptured++` 并 `updatedAt` 刷新。
- **终态（已完成）**：Issue 进入已完成并关闭后，state 使命完成——**删除** `<iid>-state.json`（保留 `<iid>/spec/` 下的文档）。这样它就不会出现在 `/glab-flow` 的未完成列表里。删之前可把最终摘要作为最后一条评论留在 Issue 上。

`spawnedAgents` 在每次 Leader 委派 agent（intake / spec-author / 各 reviewer 等）后追加去重。

## 脏状态

脏状态指 Issue 上的状态标签无法推导出唯一节点。`pnpm cli node <type> <labels...>` 在下列情况返回脏信号：

- **0 个状态标签**：Issue 上既无 `story-status::*` 也无 `status::*`（被全部清掉）。stdout `node` 为空 / 标识未就绪。
- **≥2 个状态标签**：同时挂着两个冲突的状态（如 `story-status::待评审` 和 `story-status::开发中`）。引擎无法判断真实节点。

任何一种 → Leader **停**，不做推测性流转。把 GitLab 推导结果与 Issue 链接列给人工：

> 脏状态：Issue #<iid> 当前标签=[...]，推导出 0/≥2 个状态节点。请人工确认正确状态标签后再 `/glab-flow <iid>`。

此时不写回 GitLab、不更新 `cachedNode`（避免把错误状态固化到缓存）。用户在 GitLab UI 修好标签后重跑 `/glab-flow <iid>`，恢复流程的第 2 步会重新从 GitLab 推导出唯一节点。

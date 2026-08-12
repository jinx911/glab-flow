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

## 恢复流程（5 步，必须照此写）

选定要恢复的 `<iid>` 后，Leader 严格按下面 5 步执行。核心是"先问 GitLab，再对账本地"——顺序不能反。

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

   **进度对账（层 2）**：若 `state.progress.node !== GitLab 当前节点`（节点在 flow 外被改过、或上次换节点时未重置），`progress.done` 已失效——用 `pnpm cli progress`（stdin `{state, resetToNode: <GitLab 节点>, now}`）重置后再展示「子步骤 ✓/☐」。一致则直接拿 `nodeProgress`（来自 `node`/`transition`）对照 `progress.done` 涂黑已完成项。

4. **回读产物与串行写回阶段并对账**。先从父 Issue 重新拉取 notes；有 `mr-review` 要求时，逐个拉取 state/transition 提供的 affected MR notes。每条 GitLab `{id, body, created_at, web_url?}` 都必须映射为 `{id: String(id), body, observedAt: created_at, url: web_url?}`；同时重新计算本轮所有 active artifact 的本地 `source` 与完整 64 位小写十六进制 `sha256`，组成 `artifactManifest`。将它们与当前 config 的 `projectId`、`issueNotes`、`mergeRequests: [{projectPath, iid, notes}]`、`dataEvidenceProfile` 一起传入 `transition.artifactContext`。`created_at` 必须是 `artifact.ts` 接受的规范 UTC `Z` 时间；否则停止 receipt 校验、报告 `malformed readback` 并重新读取/修正输入，不得使用 state 缓存绕过。解析 `glab-flow:artifact-receipt:v1` 后，只有 source/hash 与 manifest 完全一致的 GitLab 实际回读结果才能重建 `artifactReceipts`；不得因本地文件、旧缓存或“已发送”推断回执存在。再检查 `writebackAudit`：产物评论、metadata（标签 + Assignee）、state-comment、readback 四个阶段中，哪个是**首个未完成阶段**。任一阶段曾失败或状态不明，先记录回读结果，只重试这个首个未完成阶段；已回读成功的评论不得重复发送。

5. **从当前节点继续 SKILL.md 编排循环**。节点定了之后，按 `SKILL.md` 的"Leader 每轮编排"走：查 `nodes.md` 契约 → 判断证据是否齐 → `validate` → `plan`/`plan-return` → 门禁预览确认（见 `gate.md`）→ glab 应用。恢复只是把 Leader 重新放到正确的节点上，后续动作与首次进入完全相同。

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
| `artifactReceipts[]` | `ArtifactReceipt[]` | 已由 GitLab 回读验证的产物回执；派生缓存，绝不代替重新回读 |
| `dataEvidenceProfile` | `'standard' \| 'data-backed'` | 显式的数据型需求判定，决定是否要求 `data-evidence` 回执 |
| `writebackAudit[]` | 审计阶段数组 | `artifact-comment` / `metadata` / `state-comment` / `readback` 的串行成功/失败记录，用于恢复定位首个未完成阶段 |
| `lessonsCaptured` | number | 已 capture 的 lesson 条数；只作经验统计，不驱动门禁 |
| `progress` | `{ node, done[] }` | 节点内子步骤进度（层 2）：`node` = 这批 done 所属节点；换节点时重置 |
| `updatedAt` | string (ISO) | state 最后写入时间 |

## 持久化时机

state 文件不是每条命令都写，只在以下时机落盘：

- **每个已回读回执后**：用纯计算 state helper 追加/去重 `artifactReceipts`，再允许更新关联 `progress`；回读失败不写 receipt 缓存。
- **草稿中 → 待评审前**：用 `state-data-evidence-profile` 保存 `standard` 或 `data-backed`；恢复时读取该缓存并仍将显式值传回 `transition.artifactContext`，不能缺省或重新猜测。
- **每个串行写回阶段后**：追加 `writebackAudit`（成功或失败），并更新 `lastActions`/`updatedAt`。阶段顺序固定为：全部产物回执 → 标签 + Assignee → 状态变更评论 → 最终回读。失败立即停止，后续阶段不写入；恢复先回读，再从首个未完成阶段续跑。
- **capture lesson 后**：每捕获一条 lesson，`lessonsCaptured++` 并 `updatedAt` 刷新；这些记录不影响任何状态门禁。
- **终态（已完成）**：Issue 进入已完成并关闭后，state 使命完成——**删除** `<iid>-state.json`（保留 `<iid>/spec/` 下的文档）。这样它就不会出现在 `/glab-flow` 的未完成列表里。删之前可把最终摘要作为最后一条评论留在 Issue 上。

`spawnedAgents` 在每次 Leader 委派 agent（intake / spec-author / 各 reviewer 等）后追加去重。

## 脏状态

脏状态指 Issue 上的状态标签/状态无法推导出唯一、合法的当前节点。`pnpm cli transition`（或 `node`）在下列情况返回脏信号（`transition.dirty=true`）：

- **0 个状态标签**：Issue 上既无 `story-status::*` 也无 `status::*`（被全部清掉）。
- **≥2 个状态标签**：同时挂着两个冲突的状态（如 `story-status::待评审` 和 `story-status::开发中`）。引擎无法判断真实节点。
- **已关闭但非终态**：Issue `state=closed` 但状态标签 ≠ `已完成`（如挂着 `待发布` 却被提前 close）。`transition` 在入口检测到此组合即标脏。

任何一种 → Leader **停**，不做推测性流转。把 GitLab 推导结果与 Issue 链接列给人工：

> 脏状态：Issue 当前标签=[...]、state=<opened/closed>，推导出 0/≥2 个状态节点、或已关闭但非终态。请人工确认正确状态标签（必要时 reopen）后再 `/glab-flow <iid>`。

此时不写回 GitLab、不更新 `cachedNode`（避免把错误状态固化到缓存）。用户在 GitLab UI 修好标签（或 reopen 误关的 Issue）后重跑 `/glab-flow <iid>`，恢复流程的第 2 步会重新从 GitLab 推导出唯一节点。

---
name: glab-flow-resume
description: 从 .glab-flow/*-state.json 恢复未完成 flow；GitLab 标签为唯一真理，本地仅缓存。
---

# glab-flow 恢复（resume）

glab-flow 在 Issue 流转过程中会把"上次到哪一步"缓存到本地 `<workspace.root>/.glab-flow/<iid>-state.json` 与交付工作包 `<workspace.root>/.glab-flow/<iid>/du.json`，让用户回到工作区或新开会话时能续上未完成的 flow。但这两条缓存只是**派生数据**——流程的权威状态永远在 GitLab Issue 的标签上。本文件规定恢复入口、与 GitLab 的对账逻辑、state 持久化时机与脏状态处理。

## 真理源声明

**GitLab Issue 标签为唯一真理。** Issue 上的 `story-status::*` / `status::*` 状态标签代表流程真正所在节点，由 `pnpm cli node <type> <labels...>` 推导（见 SKILL.md）。`<workspace.root>/.glab-flow/<iid>-state.json` 里的 `cachedNode` 与 DU 的 `cachedNode` 是上次本地写回后留下的快照，仅用于"快速展示进度 + 缩短恢复查询 + 对账"，**不**是状态机本身。

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

1. **读 `<iid>-state.json`（及 DU）**。`cat <workspace.root>/.glab-flow/<iid>-state.json` 拿到 `RunState`，从中取 `type`（`story`/`bug`）、`project`（`{host, id}`）、`runMode`、`specDir`；同目录有 `<iid>/du.json` 时一并读出 DU（执行事实/资源/GateSet/指标所在）。这些决定后续用哪套状态机（story vs bug）、去哪个 GitLab 实例查、以及恢复后按 DU 供证据与门禁。

2. **从 GitLab 重推导当前节点**。这是真理源查询，不能跳：
   - 取最新 Issue：`glab issue view <iid> --output json`。若**配置**里有 `gitlab.harness_clone`（`config.gitlab.harnessClone`），在该克隆目录跑（glab 自动识别 remote）；否则用 `glab api --hostname <host> "projects/<id>/issues/<iid>"`。
   - 从返回 JSON 取 `labels` 数组。
   - 推导节点：`pnpm cli node <type> <labels...>`（在 glab-flow 仓库根跑），stdout 的 `node` 即 **GitLab 当前节点**。

   同时读取 Issue notes，供后续 Story 周排期回读：`已评审→开发中` 只接受**最新** `## 周排期` 区块的解析结果。最新有效「启用」或「暂停」可继续；最新区块缺失或无效则停止，记录排期缺口，**不得回退（fallback）到旧/更早的有效区块**。

3. **对比 `cachedNode` vs GitLab 节点**。把 state 里的 `cachedNode` 与上一步 GitLab 推导出的节点字符串比较：
   - **一致** → 本地缓存有效，直接续；`cachedNodeAt` 不变。
   - **不一致** → 先跑 `pnpm cli reconcile`（stdin `{type, labels, state, du}`）拿 verdict 与处理方向（见下文「脏状态与对账」），按方向处置后再续。Leader 给用户一句明确提示：

     > 标签在 flow 外被改过（本地缓存=<cachedNode>，GitLab=<gitlabNode>），以 GitLab 为准。

     然后把 state 的 `cachedNode` 更新为 GitLab 节点、`cachedNodeAt` 刷成当前时间、`updatedAt` 同步，写回文件。继续按 GitLab 节点编排。

   不一致常见于：用户或他人在 GitLab UI 手改了标签、或上次写回失败但本地 state 已更新。绝不能反过来用 `cachedNode` 去"纠正"GitLab 标签。

   **进度对账（层 2）**：若 `state.progress.node !== GitLab 当前节点`（节点在 flow 外被改过、或上次换节点时未重置），`progress.done` 已失效——用 `pnpm cli progress`（stdin `{state, resetToNode: <GitLab 节点>, now}`）重置后再展示「子步骤 ✓/☐」。一致则直接拿 `nodeProgress`（来自 `node`/`transition`）对照 `progress.done` 涂黑已完成项。

4. **对账串行写回阶段**。先从父 Issue 重新拉取 notes（有受影响 MR 时也逐个拉取 MR notes）。再检查 `writebackAudit`：metadata（标签 + Assignee）、state-comment（合并评论）、readback 三个阶段中，哪个是**首个未完成阶段**。任一阶段曾失败或状态不明，先记录回读结果，只重试这个首个未完成阶段；已回读成功的评论不得重复发送。三阶段均已回读而 `week-milestone-sync` 未成功时，只重试这一独立同步，绝不重发评论或回滚状态。

5. **从当前节点继续 SKILL.md 编排循环**。节点定了之后，按 `SKILL.md` 的"Leader 每轮编排"走：查 `nodes.md` 契约 → 判断证据是否齐 → `validate` → `plan`/`plan-return` → 门禁预览确认（见 `gate.md`）→ glab 应用。恢复只是把 Leader 重新放到正确的节点上，后续动作与首次进入完全相同。

若只是日期或安排发生变化，不从恢复流程伪造一次状态流转。走独立的 `week-plan-change`：它只新增一条 `## 排期变更` + replacement `## 周排期` 评论，保留状态、Assignee、Issue 正文和历史评论。启用计划的评论回读后，由 `postWriteback.sync_week_milestone` 触发 Leader 幂等同步；引擎本身仍不会生成 GitLab Milestone API 或 `WriteOp`。

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
| `runMode` | `'semi-auto' \| 'full-auto'` | 审计字段：记录运行模式偏好，不参与确认判定（确认由动作分层决定，见 `gate.md`） |
| `lastActions[]` | string[] | 最近动作审计尾迹（用于续接与回看） |
| `spawnedAgents[]` | string[] | 本 flow 已委派过的 agent 名单（去重/记账） |
| `writebackAudit[]` | 审计阶段数组 | `metadata` / `state-comment` / `readback` 的串行成功/失败记录，以及独立 `week-milestone-sync` 记录，用于恢复定位首个未完成阶段或同步重试 |
| `lessonsCaptured` | number | 已 capture 的 lesson 条数；只作经验统计，不驱动门禁 |
| `progress` | `{ node, done[] }` | 节点内子步骤进度（层 2）：`node` = 这批 done 所属节点；换节点时重置 |
| `updatedAt` | string (ISO) | state 最后写入时间 |

## 持久化时机

state 文件不是每条命令都写，只在以下时机落盘：

- **每个串行写回阶段后**：追加 `writebackAudit`（成功或失败），并更新 `lastActions`/`updatedAt`。阶段顺序固定为：metadata（标签 + Assignee）→ state-comment（合并评论）→ readback（最终回读）→（有 `postWriteback` 时）week-milestone-sync。前三阶段失败立即停止；最后同步失败只重试同步，不撤回前三阶段。
- **capture lesson 后**：每捕获一条 lesson，`lessonsCaptured++` 并 `updatedAt` 刷新；这些记录不影响任何状态门禁。
- **终态（已完成）**：Issue 进入已完成并关闭后，state 使命完成——**删除** `<iid>-state.json`（保留 `<iid>/spec/` 下的文档）。这样它就不会出现在 `/glab-flow` 的未完成列表里。删之前可把最终摘要作为最后一条评论留在 Issue 上。

`spawnedAgents` 在每次 Leader 委派 agent（intake / spec-author / 各 reviewer 等）后追加去重。

## 脏状态与对账（先 reconcile）

投影（GitLab labels）与本地事实（DU `cachedNode`）不一致时，**先 `pnpm cli reconcile` 对账**，不再一律当异常推倒重来。stdin `{type, labels, state, du}`，输出 5 种 verdict 及处理方向：

| verdict | 含义 | 处理方向 |
|---|---|---|
| `in-sync` | 标签与 DU 一致 | 直接续跑，无事发生 |
| `label-ahead` | 人工推进了标签（label 节点在 DU 之前） | 二选一（一次 L2 确认）：将 DU 对齐到标签（接受人工推进）或回改标签（以 DU 为准） |
| `du-ahead` | DU 领先标签（上次写回可能中断） | 补发流转评论并写回标签；先查 `writebackAudit` 定位首个未完成阶段，不得重发已回读评论 |
| `external-close` | Issue 被人工关闭但标签非终态 | 确认验收事实后补终态评论，或 reopen |
| `dirty-labels` / `unknown-node` | 标签 0/≥2 个、或节点名不在状态机 states 中 | 引擎无法裁决 → 走下方人工修标签兜底 |

对账不写回 GitLab、不更新 `cachedNode`——引擎只裁决方向，执行仍走 Leader 的预览确认。

**人工修标签兜底（dirty-labels / unknown-node）**：`pnpm cli transition`（或 `node`）在下列情况返回脏信号（`transition.dirty=true`）：

- **0 个状态标签**：Issue 上既无 `story-status::*` 也无 `status::*`（被全部清掉）。
- **≥2 个状态标签**：同时挂着两个冲突的状态（如 `story-status::待评审` 和 `story-status::开发中`）。引擎无法判断真实节点。
- **已关闭但非终态**：Issue `state=closed` 但状态标签 ≠ `已完成`（如挂着 `待发布` 却被提前 close）——reconcile 侧对应 `external-close`。
- **节点名不在状态机**：标签或 DU 的节点名拼错/被手改（`unknown-node`）。

任何一种 → Leader **停**，不做推测性流转。把 GitLab 推导结果与 Issue 链接列给人工：

> 脏状态：Issue 当前标签=[...]、state=<opened/closed>，推导出 0/≥2 个状态节点、或已关闭但非终态。请人工确认正确状态标签（必要时 reopen）后再 `/glab-flow <iid>`。

此时不写回 GitLab、不更新 `cachedNode`（避免把错误状态固化到缓存）。用户在 GitLab UI 修好标签（或 reopen 误关的 Issue）后重跑 `/glab-flow <iid>`，恢复流程的第 2 步会重新从 GitLab 推导出唯一节点。

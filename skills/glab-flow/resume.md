---
name: glab-flow-resume
description: 从 .glab-flow/*-state.json 恢复未完成 flow；GitLab labels 是状态投影真理，DU 是交付事实主档，state 仅缓存。
---

# glab-flow 恢复（resume）

**Last Updated:** 2026-09-02

glab-flow 在 Issue 流转过程中会把会话缓存写入 `<workspace.root>/.glab-flow/<iid>-state.json`，把交付事实写入交付工作包 `<workspace.root>/.glab-flow/<iid>/du.json`，让用户回到工作区或新开会话时能续上未完成的 flow。**labels 是对外节点投影真理，DU 是执行事实与 GateSet 主档，state 是派生缓存**；本文件规定恢复入口、与 GitLab 的对账逻辑、DU/state 持久化时机与脏状态处理。

## 真理源声明

**GitLab Issue labels 是对外生命周期投影的真理；DU 是交付事实与 GateSet 的主档。** Issue 上的 `story-status::*` / `status::*` 状态标签代表对外当前节点，由 `pnpm cli node <type> <labels...>` 推导（见 SKILL.md）；DU 的 `evidence`、`affectedScopes`、冻结 `gateSet`、资源、指标和 `cachedNode` 承载本地执行事实与投影对账基准。`<workspace.root>/.glab-flow/<iid>-state.json` 的 `cachedNode` 仅是 state 快照，**不**是状态机或事实主档。

这意味着：(a) 任何写回前都必须用最新 GitLab 读数 + DU 运行 `reconcile`，不能直接用 state/旧评论决定写回；(b) Issue 最终回读成功后，才用 `pnpm cli du cached-node` 更新 DU，再更新 state；(c) 删掉 state 文件不会丢流程进度，只会让下次恢复多做一次读取；DU 丢失时可用 Issue 状态流转评论摘要及外部报告回建，但不要把旧 state 当作 DU 事实；(d) state 文件可跨会话、跨机器重建，只要 Issue 还在。

**恢复也不降低 hard_gate：** 对账或恢复只能定位并补齐未完成动作，不能用 `skipStates`、`run_mode`、旧缓存或外部部署结果绕过生产部署/终态验收的 `hard_gate`；这两类转换仍是 L3，必须 `humanConfirmed`，终态仍需标签、Assignee、评论和 close 原子完成。

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

3. **先跑 `reconcile`，再处理 `cachedNode` 漂移**。比较 DU `cachedNode` 与 GitLab 推导节点（state 的 `cachedNode` 只作提示）：
   - **`in-sync`** → DU 对账基准与 labels 一致，继续。
   - **`label-ahead`** → GitLab 投影领先，必须一次 L2 选择“接受人工推进并更新 DU”或“回改标签以 DU 为准”；未选择前不得写回。
   - **`du-ahead`** → DU 领先，按 `writebackAudit` 定位首个未完成阶段，补回该阶段；已回读成功的评论不得重复发送。
   - **`external-close`** → Issue 被提前关闭，确认验收事实后补终态，或 reopen；不得直接推进。
   - **`dirty-labels` / `unknown-node`** → 停止，人工修标签/节点后重跑。

   漂移常见于 UI 手改标签、手动部署或上次写回中断。Leader 可提示 labels 与 DU 的节点差异，但不能先改缓存掩盖漂移。

     > 投影漂移（DU=<duNode>，GitLab=<gitlabNode>）。请先按 verdict 选择处置；不得用缓存覆盖 GitLab。

   只有一次合法 Issue 写回完成并最终回读确认后，才执行 `pnpm cli du` 的 `cached-node`，传入本次 `next` 的有效最终目标（跳状态也传投影后的最终目标），再更新 state `cachedNode`/`cachedNodeAt`。绝不能在漂移尚未处置时直接把 state 或 DU 改成 GitLab 节点。

   **进度对账（层 2）**：若 `state.progress.node !== GitLab 当前节点`（节点在 flow 外被改过、或上次换节点时未重置），`progress.done` 已失效——用 `pnpm cli progress`（stdin `{state, resetToNode: <GitLab 节点>, now}`）重置后再展示「子步骤 ✓/☐」。一致则直接拿 `nodeProgress`（来自 `node`/`transition`）对照 `progress.done` 涂黑已完成项。

4. **对账串行写回阶段**。先从父 Issue 重新拉取 notes（有受影响 MR 时也逐个拉取 MR notes）。再检查 `writebackAudit`：metadata（标签 + Assignee）、state-comment（合并评论）、readback 三个阶段中，哪个是**首个未完成阶段**。任一阶段曾失败或状态不明，先回读 GitLab，只重试这个首个未完成阶段；已回读成功的评论不得重复发送。readback 成功后先用 `pnpm cli du` 的 `cached-node` 更新 DU 为有效最终目标，再更新 state。三阶段均已回读而 `week-milestone-sync` 未成功时，只重试这一独立同步，绝不重发评论或回滚 DU/state。

5. **从当前节点继续 SKILL.md 编排循环**。节点定了之后，按 `SKILL.md` 的"Leader 每轮编排"走：查 `nodes.md` 契约 → 判断证据是否齐 → `validate` → `plan`/`plan-return` → 门禁预览确认（见 `gate.md`）→ glab 应用。恢复只是把 Leader 重新放到正确的节点上，后续动作与首次进入完全相同。

**GateSet 绑定恢复顺序**：若当前是 Story `已评审→开发中` 或 Bug `已确认缺陷→开发中` 且需要绑定，Leader 先以 `declaredScopes` 运行 `transition` 取得提案，确认后执行 `pnpm cli du` 的 `bind-gateset` 并落盘冻结 DU。绑定首轮不写 Issue 状态；对 Bug，若有 `declaredScopes` 但 DU 尚无 frozen GateSet，首次结果为 `validate.ok=false`、`plan` 未定义且 playbook 不含 `issue_writeback`。DU 写入完成后重新读取最新事实并重新运行 `transition`，待正常 `WritePlan` 生成后再执行 Issue 写回与最终回读；不能用绑定前的旧输出继续流转。Bug 没有非空 `declaredScopes` 且 DU 没有 frozen GateSet 时，恢复同样停止。

恢复 playbook 时，只有启用的 GateSet 环境缺少 AssetAudit/TestRun（或 full 回归证据）才执行 `run_affected_regression` / `run_full_regression`；由 `test-flow-e2e` 执行后记入 DU，再重新运行 `transition`。提测的 local 回归仍须位于 feature commit 之后、merge/deploy 之前。

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
| `writebackAudit[]` | 审计阶段数组 | `code-commit` / `code-merge` / `code-jenkins`（代码侧断点，E4）与 `metadata` / `state-comment` / `readback` 的串行成功/失败记录，以及独立 `week-milestone-sync` 记录，用于恢复定位首个未完成动作或同步重试——代码侧任一失败只重试该动作（Jenkins 已触发看结果不重触），不整链重放 |
| `lessonsCaptured` | number | 已 capture 的 lesson 条数；只作经验统计，不驱动门禁 |
| `progress` | `{ node, done[] }` | 节点内子步骤进度（层 2）：`node` = 这批 done 所属节点；换节点时重置 |
| `updatedAt` | string (ISO) | state 最后写入时间 |

## 持久化时机

state 文件不是每条命令都写，只在以下时机落盘：

- **每个串行写回阶段后**：追加 `writebackAudit`（成功或失败），并更新 `lastActions`/`updatedAt`。阶段顺序固定为：metadata（标签 + Assignee）→ state-comment（合并评论）→ readback（最终回读）→（有 `postWriteback` 时）week-milestone-sync。前三阶段失败立即停止；readback 成功后先更新 DU `cachedNode`（用 `du cached-node`），再更新 state；最后同步失败只重试同步，不撤回前三阶段或 DU/state。
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

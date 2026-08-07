---
name: glab-flow
description: 当用户提供 GitLab Issue URL/编号，需要按 harness 状态机驱动需求从分诊到上线/验收时使用。引擎只做确定性计算（节点/校验/计划/渲染/配置/状态），GitLab 读写由 Leader 直接用 glab CLI 完成，每次写回前预览确认。自有配置与状态缓存，不依赖任何外部 skill。
---

# glab-flow：harness GitLab 状态机驱动引擎

glab-flow 是 GitLab-native、自包含的流程引擎：引擎只做确定性计算（节点推导 / 护栏校验 / 计划构建 / 文本渲染 / 配置解析 / 状态初始化），所有 GitLab 读写由 Leader 直接用 glab CLI 完成，每次写回前预览确认。项目参数走配置文件，不在代码里硬编码；文档落自有工作目录，不进代码仓。

## 权威来源

规则权威来自 `oa-ai-native-harness` 的 `docs/issue-state-machine.md` 与 `AGENTS.md`；glab-flow 的 `state-machine.yaml`、护栏和节点文档只是可执行投影。运行时状态权威是 GitLab Issue 的 labels/comments；本地 state 与 lessons 都是派生缓存或经验材料。

## 输入

`$ARGUMENTS` = GitLab Issue URL 或 iid。

为空（`/glab-flow` 无参）→ 按 `resume.md` 列出未完成 flow：扫描 `<workspace.root>/.glab-flow/*-state.json`，让用户选一个恢复，或开新 flow。

## 配置（启动第一件事）

glab-flow 是配置驱动的——`host`/`project_id`/`workspace.root` 等参数因项目而异，绝不写死。每次启动 flow，**先读 config**（`$ENGINE_ROOT` 见下文「引擎与命令」节，启动时先解析一次、全局复用）：

1. 按 `config.md` 的查找链取**首个存在**的配置文件（项目级 `<workspace.root>/.glab-flow/config.md` → 全局兜底 `~/.claude/skills/glab-flow/config.md`）。
2. 解析：

   ```bash
   cd "$ENGINE_ROOT" && cat <config.md 路径> | pnpm cli config
   ```

   stdout 是 `GlabConfig` JSON，从中派生后续编排所需的全部项目参数：`gitlab.host` / `gitlab.projectId` / `workspace.root` / `runMode`（以及可选项 `harnessClone` / `deployBranch` / `jenkins` / `databases` / `testEnvironments`）。

3. 解析失败 → 把错误贴给用户，引导重跑 `/init-glab-flow`。配置文件不存在（查找链都没命中）→ 用 `AskUserQuestion` 引导运行 `/init-glab-flow <workspace.root>` 生成项目级配置后再继续——**不让 flow 在无配置下裸跑**。

配置格式、字段语义、查找链细节见 `config.md`。

## 引擎与命令（纯计算，无 I/O）

glab-flow 引擎仓库就是本 skill 所属的仓库（不依赖任何外部 skill）。引擎只做确定性计算，不做任何 GitLab 调用、不读文件系统之外的 I/O；所有副作用由 Leader 跑 glab 产生。

**引擎根解析（每次启动 flow 先做一次，后续复用）**：`install.sh` 把 `skills/glab-flow` 符号链接到 `~/.claude/skills/glab-flow`，故引擎仓库根 = 该符号链接实际目标的"上两级"。启动时解析一次 `$ENGINE_ROOT`，此后所有 `pnpm cli …` 都在它下面跑（形如 `cd "$ENGINE_ROOT" && pnpm cli …`，下文「配置」「Leader 编排」「证据抽取」等各处出现的 `pnpm cli …` 均在此前缀下执行）：

```bash
# 引擎仓库根 = glab-flow skill 的实际仓库根（install.sh 符号链接 ~/.claude/skills/glab-flow → <repo>/skills/glab-flow）
ENGINE_ROOT="$(dirname "$(dirname "$(readlink -f "$HOME/.claude/skills/glab-flow")")")"
cd "$ENGINE_ROOT" && pnpm cli <cmd>
```

若 `readlink -f` 不可用或开发态直接在仓库内运行，`ENGINE_ROOT` 即当前 glab-flow 仓库根（开发者自行 `cd` 到仓库根即可）。

命令列表：

| 命令 | 作用 |
|---|---|
| `node` | 推导当前节点：`pnpm cli node <type> <labels...>` |
| `transition` | **一键流转（首选）**：stdin `{type,iid,labels,body,notes,state,to?,fields?,…,runMode?,config?}` → 一次产出 `{node,next,dirty,prefilled,missing[],validate,plan,preview,shouldConfirm}`。把下面 8 步里的 6 步确定性计算（推导/抽证据/查契约/预填/校验/建计划/预览）全收拢 |
| `validate` | 护栏校验（`transition` 内部已含；单独用便于排障）：stdin `{type,labels,payload}` → `{ok,missing,reasons}` |
| `render` | 渲染评论正文 |
| `plan` | 正向建写回计划：`pnpm cli plan <iid>`，stdin `{payload}` |
| `plan-return` | 退回建写回计划：stdin `{type,from,target,issues,confirmer,date,assigneeUser?}` |
| `evidence` | 从 GitLab notes 抽证据（确认人/日期/结论/阻塞验证） |
| `config` | 解析配置 markdown → `GlabConfig` JSON |
| `state-init` | 生成 state 文件：stdin `{iid,type,host,projectId,workspaceRoot,runMode?,now?}` → `RunState` |
| `progress` | 节点内进度跟踪：stdin `{state, step?, resetToNode?, now}` → 更新后的 `RunState`（标记子步骤 done / 换节点重置；引擎纯计算，Leader 落盘） |

## GitLab 读写（Leader 直接 glab CLI）

Leader 直接用 glab CLI 操作 GitLab（glab 已认证，**无需 token**，不在环境里配 token）。三条路径，由配置决定走哪条：

- **有 `gitlab.harnessClone`**：在配置提供的 harness 克隆目录跑 `glab issue …`，glab 自动从 remote 推断 host/project。

  ```bash
  glab issue view <iid> --output json        # 从克隆目录跑
  glab issue update <iid> --label ... --unlabel ... --assignee <@user>
  glab issue note <iid> -m "<正文>"
  glab issue close <iid>
  ```

- **无 `harnessClone`、又想用子命令（不用 `glab api`）**：给子命令带 `-R <host>/<group>/<project>` 限定项目（最轻量）。`<project>` 取 config 的 `project_path`；若只配了数字 `project_id` 则不适用此路，走下面的 `glab api`。

  ```bash
  glab issue view <iid> -R <host>/<group>/<project> --output json
  glab issue update <iid> -R <host>/<group>/<project> --label ... --unlabel ... --assignee <@user>
  ```

- **无 `harnessClone` 或需显式调用**：用 `glab api`，host 与 path 来自配置（`gitlab.host` / `gitlab.projectId`）：

  ```bash
  glab api --hostname <host> "projects/<id>/issues/<iid>"
  glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100"
  ```

`<host>` 与 `<id>` 一律从 `GlabConfig` 取，不在命令里硬编码域名或项目号。

## Leader 每轮编排（一键流转）

每个节点用 `transition` 一次算完确定性部分，Leader 只做「读 → 确认 → 写」三件事（门禁细节见 `gate.md`）：

1. **读状态（2 次只读 glab）**：`glab issue view <iid> --output json` 取 labels/description/state；`glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100"` 取评论。读哪条路径见上文「GitLab 读写」。
2. **一键 transition（1 次引擎调用）**：把 labels/body/notes/state + 已知 fields 喂给 `cd "$ENGINE_ROOT" && pnpm cli transition`（stdin JSON）。引擎一次产出：
   - `node` / `next` / `dirty`（脏：0/≥2 状态标签，或已 closed 但非终态 → 停，见 `resume.md`）
   - `prefilled`（Assignee 按「交付协同表 → config.roles → 输入」解析并补 `@`；必填字段扫评论「- 字段：值」按精确 key 预填，标「来自评论，请核实」，user 输入优先）
   - `missing[]`（每个缺字段带 hint：来源 / 格式 / 期望值）
   - `validate`（G1–G14，`reasons` 自带补救动作）
   - `plan`（WritePlan：标签 / Assignee / 评论 / 是否 close）+ `playbook`（本转换副作用动作包，见下）+ `nodeProgress`（当前节点子步骤 checklist，进度可见）+ `preview`（散文 diff）+ `shouldConfirm`
3. **执行 playbook + 确认（Leader）**：`playbook` 是本转换的**完整动作包**，代码侧步骤在前、Issue 写回（`isWriteback`）恒为末步。Leader 按序：
   - 代码侧步骤（`subskill` 字段指向 `git-ops` / `jenkins-deploy` / `release-check`）：委派对应 sub-skill 执行（commit/push、merge→deploy_branch、Jenkins 构建部署等），每步按 sub-skill 自身规则确认。没配 `deploy_branch` / `jenkins` 的步骤引擎已自动滤除。
   - 末步 `issue_writeback`：把 `plan` 翻译成 glab 命令序列（标签 add/unlabel、`--assignee <@user>`、评论长则 `-F <file>`、终态 `close`，见 `gate.md`）。
   - `shouldConfirm=false`（full-auto 且 `validate.ok` 且非 hard_gate）→ 直接执行；`shouldConfirm=true`（semi-auto / hard_gate / 有缺口）→ `AskUserQuestion` 确认后再执行；有缺口按 `missing` 的 hint 委派 sub-skill 补齐，回第 1 步重取。
   - Issue 写回成功后更新 state 缓存（见下文），循环到「已完成」或用户停。
   - **节点内进度跟踪（层 2）**：每跑完一个 `nodeProgress` 子步骤，`pnpm cli progress`（stdin `{state, step, now}`）标记 done、写回 state；节点写回成功（换节点）后 `progress`（stdin `{state, resetToNode: <新节点>, now}`）重置进度。这样跨会话 resume 时能看到「开发中：技术方案 ✓ / 编码 ✓ / 自测 ☐」。

`transition` = `node` + `evidence` + `validate` + `plan` + `render` 的确定性编排 + Assignee 智能预填；门禁退回（G2 二值）仍走 `plan-return`。引擎纯计算、永不写回——输出 `applied` 恒为 false。

### 批量推进（可选）

full-auto 下可连续推进多个节点：Leader 端循环 `transition →（shouldConfirm? 确认 : 直放）→ 执行 plan → 重新拉取 → 再 transition`，遇 `!validate.ok`（缺口）/ hard_gate / 终态即停。引擎只提供 `transition` 原语，循环在 Leader（保纯计算）。

### 状态缓存

首轮进入 flow 时，Leader 用 `state-init` 生成 state 文件，把"上次到哪一步"缓存到本地：

```bash
cd "$ENGINE_ROOT" && echo '{...}' | pnpm cli state-init
# → 写到 <workspace.root>/.glab-flow/<iid>-state.json
```

之后每轮门禁写回 GitLab 成功后，更新 `cachedNode`/`cachedNodeAt`/`lastActions`/`updatedAt` 写回该文件；门禁走 `gate.md`；恢复（无参 `/glab-flow`）走 `resume.md`。**GitLab Issue 标签是唯一真理**，state 仅是派生缓存——两者不一致时以 GitLab 为准（对账逻辑见 `resume.md`）。

### 学习闭环（learn）

自我迭代闭环由 Leader + markdown 承载（引擎不参与），铁律是「**前面只记录，最后升级**」——run 内只采集、不干预；升级只在终态、且需人工审批。完整设计见 `learn.md`：

- **每节点**：capture lesson（见 `learn.md`），把节点卡顿 / 护栏触发 / 证据缺失 / sub-skill 表现 / 用户修正写入 `<workspace.root>/.glab-flow/<iid>/lessons-<HHmm>.jsonl`，`state.lessonsCaptured++`。只记录、不 distill、不改 skill 文件。
- **终态（已完成/close 后）**：upgrade ritual（distill + 人工审批的 skill 编辑，见 `learn.md`）——distill 本 run lessons 进 `knowledge.md`；视情况 spawn 临时 curator 提议 skill 文件 diff，**经用户审批后才应用**，绝不自动改。
- **flow 启动**：apply（只读 `knowledge.md`，见 `learn.md`）——挑与当前节点/类型相关的条目注入执行上下文；首次无 knowledge → 零开销。

### Assignee 解析与证据抽取

- **Assignee 解析**：从 Issue 正文「交付协同」表取角色对应的 `@用户`（Leader 解析 description）；缺则反问用户，不接受角色名占位（G6）。
- **证据抽取**：

  ```bash
  cd "$ENGINE_ROOT" && glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100" | pnpm cli evidence
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
- feature MR 评审前置（G14）：测试中→待发布 必填 `feature分支MR评审结论`（用 `code-review` sub-skill 跑 feature→master 全 MR diff，无 CRITICAL/HIGH 残留）。

## 内容生成

节点内容生成由 `sub-skills/` 内置子 skill 提供——Leader 对每个节点 Read 对应子 skill 后内联执行，或 spawn `general-purpose` 以其为 prompt：

- 需求/方案 → `sub-skills/spec-author.md`
- 开发 → `sub-skills/git-ops.md` / `sub-skills/tdd-guide.md` / `sub-skills/code-review.md`
- 测试 → `sub-skills/test-design.md` / `sub-skills/test-flow-apifox.md`
- 发布 → `sub-skills/jenkins-deploy.md`（Jenkins 触发前必须单独确认 job/分支/部署参数；发布流转确认不等于构建参数确认）
- 运行时工具（非 vendor）见 `tools.md`（codegraph / *-reviewer / apifox-* / glab / MySQL MCP）

自带 agent（随 skill 一起定义，直接 spawn）：

- `intake` —— 分诊/澄清，读 triage Issue 产出澄清问题 + 建议分类 + 建议 Assignee。
- `review-preview` —— 需求评审预审，对照门槛产出评审意见 + 问题清单。
- `release-check` —— 发布前检查，产出风险等级 + 必补事项 + 发布后检查清单 + 回滚方案。

证据不足时（`validate` 返回 `ok:false`），委派对应子 skill/agent 生成缺失内容，落回 Issue 评论或 spec 文档后重走门禁——**门禁不通过 → 回去干活，而不是改门禁**。

## 记忆升级边界

外部 memory / lessons 只能在**泛化、去标识化、加测试并验证通过**后进入本仓。一次性 Issue ID、MR/build 编号、个人映射、临时分支、单个业务需求细节不得写入可复用 skill/docs/agent；这些信息留在 run-local lessons 或外部 memory，升级完成并确认已有版本化承载后再清理。

## 文档落点

所有 issue 文档（需求草稿 / 技术方案 `design.md` / 测试计划 / 回滚等）统一落到：

```
<workspace.root>/.glab-flow/<iid>/spec/
```

路径来自配置（`workspace.root`，见 `config.md`）；`<iid>` 为 GitLab Issue iid。**禁止**写进代码仓（oa-service / oa-platform 等）的 `docs/`——文档归 Docs-as-Code 工作目录，代码仓只放代码。统一存储树见 `nodes.md`。

## 相关文件

glab-flow 的同伴文件（与 SKILL.md 同目录 `skills/glab-flow/`，自包含、无外部 skill 依赖）：

- `config.md` —— 配置格式、字段语义、查找链。
- `nodes.md` —— 节点契约（下一节点 / 必填项 / 门禁 / Assignee 角色 / 文档存储树）。
- `guards.md` —— 护栏 G1–G13 完整判定。
- `gate.md` —— 门禁仪式（6 步）+ run 模式 + hard_gate 红线。
- `resume.md` —— 恢复 / 脏状态处理 / GitLab 对账。
- `learn.md` —— 自我迭代闭环（capture / apply / upgrade ritual）。
- `tools.md` —— 运行时工具依赖清单（glab / codegraph / *-reviewer / apifox-* / MySQL MCP，非 vendor）。
- `sub-skills/*.md` —— 7 个内置子 skill（spec-author / git-ops / tdd-guide / code-review / test-design / test-flow-apifox / jenkins-deploy）。

---
name: glab-flow-gate
description: 每节点门禁仪式（取证→校验→计划→预览→确认→应用）+ 半自动/自动模式与暂停协议。
---

# glab-flow 节点门禁仪式

门禁是 glab-flow 流转的安全阀：在每个节点，Leader 必须按固定的 6 步仪式走完，才能把 Issue 推到下一节点。仪式把"取证 → 校验 → 计划 → 预览 → 确认 → 应用"串成一条不可跳序的管线，再叠加 run 模式（semi/full-auto）与 hard_gate 红线，确保每一次状态变更都可审计、可回溯、可中止。本文件规定仪式每一步的命令与判定，以及 run 模式如何影响"预览→应用"那一跳。

## 节点门禁仪式（transition 一键，每节点固定）

仪式仍是「取证 → 校验 → 计划 → 预览 → 确认 → 应用」不可跳序的管线；前 4 步（取证/校验/计划/预览）由 `transition` **一次调用**完成，Leader 只在「确认 → 应用」那一跳介入。

1. **一键 transition（取证+校验+计划+预览）**。Leader 先只读 glab：`glab issue view <iid> --output json` 取 labels/body/state；`glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100"` 取父 Issue 评论；再读取 `<iid>-state.json` 的 `evidence`；有受影响 MR 时逐个取该 MR 的 notes。把刚回读的结果和内部证据账本喂给：

   ```bash
   pnpm cli transition
   ```

   stdin JSON 含普通 Issue 字段（`type`/`iid`/`labels`/`body`/`notes`/`state`）+ 当前 `testPlan` 文本 + 已知 `fields` + 可选 `to`/`runMode`/`config`。stdout 一次给出：
   - `dirty` / `dirtyReason`（脏则停，见下文「脏状态」）；
   - `prefilled`（Assignee 按「交付协同表 → config.roles → 输入」解析并补 `@`；必填字段扫评论「- 字段：值」按精确 key 预填，标「来自评论，请核实」）；
   - `missing[]`（每个缺字段带 hint：来源 / 格式 / 期望值）；
   - `validate`（G1–G16，`reasons` 自带补救动作；`ok:false` 则 `plan` 为空、不推进）；
   - `plan`（`WritePlan`：标签 / Assignee / 评论 / 是否 close）+ `comment`（合并评论正文 = 状态变更头 + 内容体，`renderNodeComment` 生成）+ `playbook`（本转换副作用动作包，见下）+ `nodeProgress`（当前节点子步骤 checklist）+ `preview`（散文 diff）+ `shouldConfirm`。

   `transition` 内部即「评论字段扫描（取证 + 预填）→ 内部 receipt 校验 → `validate`（校验）→ `plan`（计划）→ `render`（预览）」的顺序编排；`evidence` 命令是独立的结构化取证工具（不参与内部预填）；退回（G2 二值）仍走 `plan-return`。

2. **执行 playbook + 确认/应用**。`playbook` 的相位固定为代码侧 `pre-writeback` → Issue 写回/回读 `issue-writeback` → 条件同步 `post-readback`。按 run 模式（见下节）决定 `AskUserQuestion` 后执行还是自动执行：
   - **代码侧步骤**（`subskill` 指向 `git-ops` / `jenkins-deploy` / `release-check` / `mr-review`）：委派对应 sub-skill 跑（commit/push、merge→deploy_branch、Jenkins 构建、MR 评审等），**每步按 sub-skill 自身规则确认——与 run_mode 无关**：full-auto 也必须对 Jenkins 参数（job/分支/`test_version`/`DEPLOY_ENV`/`force_package` 等）逐个 AskUserQuestion 交互问 + 展示部署清单确认（粗粒度流转确认 ≠ 参数确认，见 `sub-skills/jenkins-deploy.md`）；没配 `deploy_branch` / `jenkins` 的步骤引擎已滤除。提测 = commit+push → merge→test → 触发 Jenkins；发布 = 生产部署（hard_gate，手动触发）。
   - **mr-review**：测试中→待发布 时，对每个受影响 feature→master MR 跑评审（G14，无 CRITICAL/HIGH 残留才放行），评审结论作为评论发到该 MR；父 Issue 汇总不能替代 MR-local 评审。
   - **内部执行证据**：测试资产审计和 TestRun 生成后，Leader 以 `evidence-record` 将 receipt 更新到 state；这是 local/test 门禁的唯一新证据来源，不能通过 `glab issue note` 写回父 Issue。
   - **issue_writeback（合并评论 + 三阶段串行，每阶段记 `writebackAudit`）**：Leader 直接跑 glab（不在引擎里做 I/O），把 `plan` 翻译成命令。按严格串行：**metadata**（标签 add/unlabel + Assignee）→ **state-comment**（状态交接单 = 状态头 + 当前阶段正式交付物 + 下一步，由 `renderNodeComment` 生成）→（终态时 close）→ **readback**（最终 Issue 回读）。禁止把测试平台、本地环境、机器 marker 或原始执行记录写入此评论；内容体按节点类型见 `nodes.md`「节点内容评论」。
   - **post-readback `sync_week_milestone`**：仅当 `plan.postWriteback.action === 'sync_week_milestone'` 执行。回读最新有效且启用的周排期，按 Asia/Shanghai 日期选目标周（未开始=计划开始周，执行中=当天周，已结束=跳过），幂等创建/关联 Week Milestone。标题必须是 Harness 同一格式 `Week YYYY-Www`，创建时 `start_date`/`due_date` 为该 ISO 周的周一/周日；不能自行发明标题或日期。用项目数字 ID 的 GitLab API：先列出 active milestones 并精确匹配标题；缺失时 `POST projects/:project_id/milestones`，并发冲突则重新读取；最后仅 `PUT projects/:project_id/issues/:iid` 的 `milestone_id`。它只能调整 Milestone；绝不改 Issue 状态、负责人、正文或评论。失败记录 `week-milestone-sync` 后重试，不撤回已成功的 Issue 写回。
     - **标签 + Assignee**：`glab issue update <iid> [--label <add1,add2>] [--unlabel <rm1,rm2>] --assignee <@user>`；无 `harnessClone` 时加 `-R <host>/<group>/<project>` 限定项目（见 `SKILL.md`「GitLab 读写」，数字 project_id 不适用 `-R`、改用 `glab api`）。
     - **评论**：短正文 `glab issue note <iid> -m "<正文>"`；长正文（含 backtick/表格）写临时文件后 `glab issue note <iid> -F <file>`，避开 shell 转义。
     - **终态（已完成）**：`glab issue close <iid>` 只在合并评论成功后执行，并由最终回读确认；不能先关 Issue 再补评论。

   Assignee 用 `prefilled.assigneeUser`（已解析+补@）；`missing` 非空（有缺口）不推进，按 hint 委派对应 sub-skill 补齐后回第 1 步重取。**顺序铁律：代码侧步骤全部成功后，才执行 issue_writeback**（代码到位 → 才标记节点）。任何标签/Assignee、合并评论或回读失败都必须**停止**，不执行后续阶段、不假设缓存成功；恢复时先回读 GitLab，再重试**首个未完成阶段**（见 `resume.md`）。

3. **冻结**。两条不可逾越的冻结线（详见 `guards.md`）：
   - **G7 不改原文**：永不 `glab issue update <iid> --description ...`，Issue 正文一旦创建即冻结。
   - **G8 不编评论**：永不 edit/delete 已发评论；评论只新增，不改写历史。

   门禁**二值**（G2）——通过走 `transition`/`plan`，退回走 `plan-return`，没有"附带条件通过"；`hard_gate`（待发布 / 生产验收中 / 已完成）必须 `humanConfirmed`（G3），无论 run 模式如何都要人工拍板，这是不可关闭的红线。

4. **变更闭环**（G16）。实施中发现需求、技术方案或既有实现错误，先将 `material_change` 交给 `automation-decision`，得到 `pause` 后 Leader 回读 Issue notes 和当前 `test-plan.md`，以 `change-impact` 预览并确认新增 open 影响单。按其 `requiredArtifacts` 同步 proposal/design/test-plan、Apifox 资产、代码、排期或发布材料；测试计划受影响必须递增 `plan-version` 并重测受影响环境；需要返回评审/开发节点时用 `plan-return`，排期变化另走 `week-plan-change`。全部完成后，用刚回读的 notes 调 `change-close` 写 closed 回执，才可恢复普通 `transition`。open 单存在时不允许正向推进。

### 脏状态（`transition.dirty=true` 直接识别）

Leader 停，不做推测性流转，把 `preview`（脏因）列给人工：

- **0/≥2 状态标签**：状态标签被清掉或冲突（`pnpm cli node` 推不出唯一节点）。
- **closed 但非终态**：Issue 已关闭但节点 ≠ 已完成（疑似被提前关闭）——reopen 或人工对账标签后重跑（详见 `resume.md`）。

两种都不写回 GitLab、不更新 `cachedNode`。用户在 GitLab UI 修好后重跑 `transition` 会重新识别。

## run 模式（开发入口一次选择、全程锁定）

模式不是项目级开关。**仅在「已评审 → 开发中」且 state 缺少 `runModeSelection` 时**，Leader 才问一次用户选半自动（`semi-auto`）或自动（`full-auto`）。调用 `pnpm cli run-mode-select` 落盘后，必须立刻重读 state，并把 `{ mode, selectedBy, selectedAt }` 连同下一次 `transition` 输入传入。`runModeSelection` 是本 Issue 的不可变审计记录；第二次选择或变更模式必须拒绝。只有不经过开发入口的旧 state 才可由 `RunState.runMode` 或 config 的 `run_mode` 取兼容默认值。

前 1–4 步（取证/校验/计划/预览）完全一致；有持久化选择后，两模式只影响第 5 步“确认/应用”。开发入口缺少选择时，`transition.modeSelectionRequired=true`：不得建写回计划，裸 `runMode=full-auto` 不构成自动写回授权。

| run 模式 | 门禁预览 | 自动应用范围 | hard_gate（待发布/验收/关闭） |
|---|---|---|---|
| `semi-auto`（默认） | 展示 diff + `AskUserQuestion` 确认后再应用 | 不自动应用——每个节点都要用户点头 | **强制人工**（G3，不可关） |
| `full-auto` | 仍展示 diff（可审计），但不阻塞 | 护栏 `ok:true` 即自动应用 glab 命令 | **强制人工**（G3，不可关） |

**hard_gate 是红线**：待发布、生产验收中、已完成这三个节点带 `hard_gate` 标记（见 `nodes.md`），无论 semi 还是 full-auto，都必须 `humanConfirmed`（G3）才能流转——full-auto 在这里也要停下问人。原因：发布与验收的代价不可逆（生产流量、用户可见、关闭即归档），不能由护栏单独放行。这一条不接受配置覆盖。

### 自动模式执行序列、progress 与 audit

持久化 `full-auto` 的连续路径固定为：技术方案/评审 → 测试计划 → 编码 → local API + E2E → commit/push + feature MR → 测试分支合并 → 参数唯一的 Jenkins 测试构建 → test API + E2E → GitLab 写回并回读。每一步成功都调用 `progress` 标记节点子步骤，并在 state 追加动作审计；Issue 写回继续逐阶段调用 `state-writeback`。Jenkins 的 job、分支、`test_version`、`DEPLOY_ENV`、`force_package` 等参数若不能唯一推导，立即暂停，不能使用猜测、历史值或“自动模式”作为授权。

### 自动化异常与统一暂停回执

每个异常先输入 `pnpm cli automation-decision`。`transient_failure` 只允许 `attempt=0` 时一次重试；`missing_evidence` 且 `autoRecoverable=true` 返回 `repair`，Leader 修复后必须重验原证据。测试失败、Git/语义冲突、需要人工的证据、`material_change`、权限拒绝和 `hard_gate` 返回 `pause`，不做自动绕过。

Leader 对每一个 `pause` 产出同一格式的暂停回执并落盘：

```text
action: pause
code: <automation-decision.code>
reason: <automation-decision.reason>
requiredInput: <automation-decision.requiredInput>
currentStep: <节点/子步骤>
evidence: <已回读证据或失败日志链接>
attemptedRecovery: <none | retry once | repair + re-verify>
resumeCommand: <重试或继续所需的精确命令>
```

暂停回执写入 state 审计后才等待输入；恢复前重读相关 GitLab/外部系统事实。生产部署、生产验收与关闭始终是人工确认，即使模式为 `full-auto` 也不例外。

## 证据不足时

若第 1 步取证或第 2 步校验发现证据不够（`missing` 非空、或 `validate` 返回 `ok:false`），Leader **不推进状态**——不改标签、不发流转评论。而是按当前节点的契约（`nodes.md` 的"工作 agent / 产出"列）委派对应的节点工作 agent 去生成缺失内容：

- 草稿中缺需求草稿 → 委派 `spec-author` 产出六清楚草稿。
- 待评审缺评审意见 → 委派 `review-preview` 预审产出问题清单。
- 开发中缺代码、local AssetAudit 或 local TestRun → 委派 `git-ops` + `codegraph` 实现，再按 test-plan 盘点/回读 Apifox 资产并完成 local 完整业务闭环；实现后做定向测试、全量回归、类型检查和代码走查。
- 测试中缺 test AssetAudit 或 test TestRun → 按同一份 test-plan 委派 `test-flow-apifox` / `test-flow-e2e` 在 test 环境执行；不得把 local 回执或自由文本报告作为替代。
- 测试中→待发布 缺 `feature分支MR评审结论`（G14）→ playbook 的 `create_mr_to_master`（git-ops 提 PR feature→master，标题=Issue 地址）+ `mr_review`（`mr-review` sub-skill，优先 mr-review-lite、降级 code-review）跑全 MR diff，无 CRITICAL/HIGH 残留才填「通过」放行；有残留则留在测试中修复重评，不进 待发布。

agent 产出落到 Issue 评论或 `<specDir>` 文档后，Leader 回到第 1 步重新取证、第 2 步重新校验，直到 `ok:true` 再建计划。换句话说：**门禁不通过 → 回去干活，而不是改门禁**。

## 周排期门禁与独立变更

Story `待评审→已评审` 的一键 `transition` 必须带有效 `weekPlan`；通过后，引擎把完整的 `## 周排期` 区块附加到这一次合并状态评论。Story `已评审→开发中` 必须以本轮刚读取的 Issue notes 检查**最新**区块：有效的「启用」和「暂停」都可通过，缺失则停。

若最新 `## 周排期` 区块无效，Leader **停止**，不建状态流转计划、不写标签或状态评论，并把解析错误列为待补排期缺口。即使更早评论里有有效排期，也不得回退（fallback）使用旧区块；Harness 同样只读取最新区块。

日期、原因或负责人变化时，走 `pnpm cli week-plan-change`，而非 `transition`。这是**仅评论（comment-only）**路径：先按普通预览与确认，再新增恰好一条含 `## 排期变更` 和完整 replacement `## 周排期` 的评论，随后 readback。它没有标签、Assignee、关闭或 Milestone `WriteOp`，且不得编辑旧排期评论；但启用排期会在 readback 后按 `postWriteback` 触发独立的 Milestone 同步。

Harness 的周一任务是**后续 rollover writer**，不是周内初始挂载入口。glab-flow 引擎没有 GitLab Milestone API/`WriteOp`；Leader 仅按引擎的 `postWriteback` 意图，在 Issue 回读完成后执行初始或排期变更同步。

## 需求/方案变更闭环

`change-impact` 与 `change-close` 均是仅评论路径，和 `week-plan-change` 一样不修改标签、Assignee、正文或历史评论。区别是它们成对工作：open 记录冻结推进，closed 记录逐项完成证据。引擎只校验结构、清单和测试计划版本；Leader 负责实际修改产物、运行 local/test，以及每次评论写入后的回读。

## 引用

- 护栏 G1–G16 的完整判定与触发条件见 `guards.md`。
- 各节点的下一节点、必填项、门禁类型、Assignee 角色见 `nodes.md`。
- run 模式在恢复场景下的取值（state vs config）见 `resume.md`。
# Apifox v2 资产审计补充

当 `test-plan.md` 声明 `presentation: <case> | <asset-type>` 或 `auth-profile: <case> | <profile>` 时，local/test 的最新审计必须是 `glab-flow:apifox-asset-audit:v2`。v2 逐项记录预期页面环境、实际页面环境、报告环境，以及 profile 与临时 token 变量名；三种环境不一致、缺认证回执、未知声明或任何凭据/token 值均阻断对应的 AssetAudit 与 TestRun。

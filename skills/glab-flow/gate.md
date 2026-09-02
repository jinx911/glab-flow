---
name: glab-flow-gate
description: 每节点门禁仪式（取证→校验→计划→预览→确认→应用）+ 动作分层 L1/L2/L3。
---

# glab-flow 节点门禁仪式

门禁是 glab-flow 流转的安全阀：在每个节点，Leader 必须按固定的 6 步仪式走完，才能把 Issue 推到下一节点。仪式把"取证 → 校验 → 计划 → 预览 → 确认 → 应用"串成一条不可跳序的管线，再叠加动作分层（L1/L2/L3，决定"预览→应用"那一跳是否需要人）与 hard_gate 红线，确保每一次状态变更都可审计、可回溯、可中止。本文件规定仪式每一步的命令与判定，以及动作分层如何决定确认行为。

## 节点门禁仪式（transition 一键，每节点固定）

仪式仍是「取证 → 校验 → 计划 → 预览 → 确认 → 应用」不可跳序的管线；前 4 步（取证/校验/计划/预览）由 `transition` **一次调用**完成，Leader 只在「确认 → 应用」那一跳介入。

1. **一键 transition（取证+校验+计划+预览）**。Leader 先只读 glab：`glab issue view <iid> --output json` 取 labels/body/state；`glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100&page=1"` 取父 Issue 评论（**逐页翻到取空**——G16/G11b 依赖旧评论，单页截断=门禁失明，见 SKILL.md「notes 必须翻页取全」）；有受影响 MR 时逐个取该 MR 的 notes（同样翻页）。把刚回读的结果喂给：

   ```bash
   pnpm cli transition
   ```

   stdin JSON 含普通 Issue 字段（`type`/`iid`/`labels`/`body`/`notes`/`state`）+ 当前 `testPlan` 文本 + 已知 `fields` + 可选 `to`/`runMode`/`config`。stdout 一次给出：
   - `dirty` / `dirtyReason`（脏则停，见下文「脏状态」）；
   - `prefilled`（Assignee 按「交付协同表 → config.roles → 输入」解析并补 `@`；必填字段扫评论「- 字段：值」按精确 key 预填，标「来自评论，请核实」）；
   - `missing[]`（每个缺字段带 hint：来源 / 格式 / 期望值）；
   - `validate`（G1–G16，`reasons` 自带补救动作；`ok:false` 则 `plan` 为空、不推进）；
   - `plan`（`WritePlan`：标签 / Assignee / 评论 / 是否 close）+ `comment`（合并评论正文 = 状态变更头 + 内容体，`renderNodeComment` 生成）+ `playbook`（本转换副作用动作包，见下）+ `nodeProgress`（当前节点子步骤 checklist）+ `preview`（散文 diff）+ `shouldConfirm`。

   `transition` 内部即「评论字段扫描（取证 + 预填）→ `validate`（校验）→ `plan`（计划）→ `render`（预览）」的顺序编排；`evidence` 命令是独立的结构化取证工具（不参与内部预填）；退回（G2 二值）仍走 `plan-return`。

2. **执行 playbook + 确认/应用**。`playbook` 的相位固定为代码侧 `pre-writeback` → Issue 写回/回读 `issue-writeback` → 条件同步 `post-readback`。按动作分层（见下节）决定 `AskUserQuestion` 后执行还是自动执行：
   - **代码侧步骤**（`subskill` 指向 `git-ops` / `jenkins-deploy` / `release-check` / `mr-review`）：委派对应 sub-skill 跑（commit/push、merge→deploy_branch、Jenkins 构建、MR 评审等）。**每步完成即记 `state-writeback` 审计**（stage=`code-commit`/`code-merge`/`code-jenkins`，detail 含构建号/commit SHA）——E4 断点审计：任一步失败，恢复时只重试首个未完成的代码侧动作（Jenkins 已触发的看构建结果而不是重新触发），**不整链重放、已成功动作不再确认**。**test/非生产构建参数默认值直用**（测试数据与凭据同理，不逐参数确认；缺定义无默认值才一次问全）；**生产部署参数逐项确认**（L3 红线，见 `sub-skills/jenkins-deploy.md`）；没配 `deploy_branch` / `jenkins` 的步骤引擎已滤除。提测 = commit+push → merge→test → 触发 Jenkins；发布 = 生产部署（hard_gate，手动触发）。
   - **mr-review**：测试中→待发布 时，对每个受影响 feature→master MR 跑评审（G14，无 CRITICAL/HIGH 残留才放行），评审结论作为评论发到该 MR；父 Issue 汇总不能替代 MR-local 评审。
   - **issue_writeback（合并评论 + 三阶段串行，每阶段记 `writebackAudit`）**：Leader 直接跑 glab（不在引擎里做 I/O），把 `plan` 翻译成命令。按严格串行：**metadata**（标签 add/unlabel + Assignee）→ **state-comment**（合并评论 = 状态变更头 + 内容体，由 `renderNodeComment` 生成）→（终态时 close）→ **readback**（最终 Issue 回读）。内容体按节点类型见 `nodes.md`「节点内容评论」。
   - **post-readback `sync_week_milestone`**：仅当 `plan.postWriteback.action === 'sync_week_milestone'` 执行。回读最新有效且启用的周排期，按 Asia/Shanghai 日期选目标周（未开始=计划开始周，执行中=当天周，已结束=跳过），幂等创建/关联 Week Milestone。标题必须是 Harness 同一格式 `Week YYYY-Www`，创建时 `start_date`/`due_date` 为该 ISO 周的周一/周日；不能自行发明标题或日期。用项目数字 ID 的 GitLab API：先列出 active milestones 并精确匹配标题；缺失时 `POST projects/:project_id/milestones`，并发冲突则重新读取；最后仅 `PUT projects/:project_id/issues/:iid` 的 `milestone_id`。它只能调整 Milestone；绝不改 Issue 状态、负责人、正文或评论。失败记录 `week-milestone-sync` 后重试，不撤回已成功的 Issue 写回。
     - **标签 + Assignee**：`glab issue update <iid> [--label <add1,add2>] [--unlabel <rm1,rm2>] --assignee <@user>`；无 `harnessClone` 时加 `-R <host>/<group>/<project>` 限定项目（见 `SKILL.md`「GitLab 读写」，数字 project_id 不适用 `-R`、改用 `glab api`）。
     - **评论**：短正文 `glab issue note <iid> -m "<正文>"`；长正文（含 backtick/表格）写临时文件后 `glab issue note <iid> -F <file>`，避开 shell 转义。
     - **终态（已完成）**：`glab issue close <iid>` 只在合并评论成功后执行，并由最终回读确认；不能先关 Issue 再补评论。

   Assignee 用 `prefilled.assigneeUser`（已解析+补@）；`missing` 非空（有缺口）不推进，按 hint 委派对应 sub-skill 补齐后回第 1 步重取。**顺序铁律：代码侧步骤全部成功后，才执行 issue_writeback**（代码到位 → 才标记节点）。任何标签/Assignee、合并评论或回读失败都必须**停止**，不执行后续阶段、不假设缓存成功；恢复时先回读 GitLab，再重试**首个未完成阶段**（见 `resume.md`）。

3. **冻结**。两条不可逾越的冻结线（详见 `guards.md`）：
   - **G7 不改原文**：永不 `glab issue update <iid> --description ...`，Issue 正文一旦创建即冻结。
   - **G8 不编评论**：永不 edit/delete 已发评论；评论只新增，不改写历史。

   门禁**二值**（G2）——通过走 `transition`/`plan`，退回走 `plan-return`，没有"附带条件通过"；`hard_gate`（待发布 / 生产验收中 / 已完成）必须 `humanConfirmed`（G3，恒 L3），无论何种动作分层都要人工拍板，这是不可关闭的红线。

4. **变更闭环**（G16）。**先过「三类改」判据：改完后，proposal / design / test-plan 里有没有任何一句话变成假的？** 没有一句话变假 → 这不是变更，是**实施调整**，不开影响单——开发中=自测迭代重跑 local（节点内循环）；测试中=测试问题评论（renderTestIssue）+ 阻塞修复 + 复测，G11 收口。**有话变假**（偏差在产物层）才走本闭环：Leader 回读 Issue notes 和当前 `test-plan.md`，以 `change`（含 T1–T4 自动定级与 GateSet 棘轮扩容）预览并确认新增 open 影响单——`source` 表达「谁发现的偏差」（requirement=需求口径假 / technical-design=方案契约假 / implementation·test=实现或测试时才发现方案不可行，分别建议回退 待评审/已评审/开发中）。按其 `requiredArtifacts` 更新所有关联产物；需要返回评审/开发节点时用 `plan-return`，排期变化另走 `week-plan-change`。全部完成、按定级满足关闭要求（T3+ 须测试计划版本递增）及受影响环境重测后，使用刚回读的 notes 调 `change-close` 写 closed 回执。open 单存在时不允许调用普通 `transition` 继续推进。

### 脏状态（`transition.dirty=true` 直接识别）

Leader 停，不做推测性流转，把 `preview`（脏因）列给人工：

- **0/≥2 状态标签**：状态标签被清掉或冲突（`pnpm cli node` 推不出唯一节点）。
- **closed 但非终态**：Issue 已关闭但节点 ≠ 已完成（疑似被提前关闭）——先 `reconcile` 对账（`external-close` verdict 给出处理方向），或 reopen 后重跑（详见 `resume.md`）。

两种都不写回 GitLab、不更新 `cachedNode`。用户在 GitLab UI 修好后重跑 `transition` 会重新识别。

## 动作分层（表）

`shouldConfirm` 由**动作分层**决定（`transition` 输出 `actionTier` + `confirmBatchTitle`）：转换带不带业务 gate、带不带回不可逆动作，决定这一跳是自动执行还是人工批量确认。`run_mode`（config `run_mode` 键 / `RunState.runMode`）退化为**审计字段**，仅随 state 记录运行模式偏好，不参与确认判定。

| 分层 | 定义 | 例子 | 确认行为 |
|---|---|---|---|
| `L1`（gate===null） | 无业务判断的机械流转 | 草稿中→待评审、bug 已确认缺陷→开发中 | `validate.ok` 即自动执行，不打断 |
| `L2`（gate!==null） | 带业务评审/放行判断的流转 | 待评审→已评审、已评审→开发中、开发中→测试中、测试中→待发布 | 以 `confirmBatchTitle` 为题做**一次** `AskUserQuestion` 批量确认 |
| `L3`（hardGate） | 不可逆动作，恒人工 | 待发布→生产验收中、生产验收中→已完成 | 必须 `humanConfirmed`（G3），任何配置不可豁免 |

**Jenkins 参数（test 环境）不再独立确认**：默认值直用直接触发，参数清单进执行记录事后审计（已裁定打通，见 `sub-skills/jenkins-deploy.md`）；提测的 L2 批量确认只覆盖流转放行判断。缺参数定义且无默认值时才一次问全。生产部署参数确认不在此列（L3）。

**hard_gate 是红线**：待发布、生产验收中、已完成这三个节点带 `hard_gate` 标记（见 `nodes.md`），L3 语义不变——无论 L1/L2 如何自动化，都必须 `humanConfirmed`（G3）才能流转。原因：发布与验收的代价不可逆（生产流量、用户可见、关闭即归档），不能由护栏单独放行。这一条不接受配置覆盖。

## 证据不足时

若第 1 步取证或第 2 步校验发现证据不够（`missing` 非空、或 `validate` 返回 `ok:false`），Leader **不推进状态**——不改标签、不发流转评论。而是按当前节点的契约（`nodes.md` 的"工作 agent / 产出"列）委派对应的节点工作 agent 去生成缺失内容：

- 草稿中缺需求草稿 → 委派 `spec-author` 产出六清楚草稿。
- 待评审缺评审意见 → 委派 `review-preview` 预审产出问题清单。
- 开发中缺代码、local AssetAudit 或 local TestRun → 委派 `git-ops` + `codegraph` 实现，再按 test-plan 盘点/回读 Apifox 资产并完成 local 完整业务闭环；实现后做定向测试、全量回归、类型检查和代码走查。
- 测试中缺 test AssetAudit 或 test TestRun → 按同一份 test-plan 委派 `test-flow-apifox` / `test-flow-e2e` 在 test 环境执行；不得把 local 回执或自由文本报告作为替代。
- 测试中→待发布 缺 `feature分支MR评审结论`（G14）→ playbook 的 `create_mr_to_master`（git-ops 提 PR feature→master，标题=Issue 地址）+ `mr_review`（`mr-review` sub-skill，优先 mr-review-lite、降级 code-review）跑全 MR diff，无 CRITICAL/HIGH 残留才填「通过」放行；有残留则留在测试中修复重评，不进 待发布。

agent 产出落到 Issue 评论或 `<specDir>` 文档后，Leader 回到第 1 步重新取证、第 2 步重新校验，直到 `ok:true` 再建计划。换句话说：**门禁不通过 → 回去干活，而不是改门禁**。

**证据源（DU 优先）**：local/test 的 AssetAudit 与 TestRun 优先从 DU 读取（`transition`/`validate` 的 stdin 传 `du`，引擎取该环境最新执行事实）；无 DU 的存量 Issue 自动回落 Issue 评论 marker 解析，不迁移。执行明细不再要求发 Issue 评论——Issue 只保留状态流转评论。

## 周排期门禁与独立变更

Story `待评审→已评审` 的一键 `transition` 必须带有效 `weekPlan`；通过后，引擎把完整的 `## 周排期` 区块附加到这一次合并状态评论。Story `已评审→开发中` 必须以本轮刚读取的 Issue notes 检查**最新**区块：有效的「启用」和「暂停」都可通过，缺失则停。

若最新 `## 周排期` 区块无效，Leader **停止**，不建状态流转计划、不写标签或状态评论，并把解析错误列为待补排期缺口。即使更早评论里有有效排期，也不得回退（fallback）使用旧区块；Harness 同样只读取最新区块。

日期、原因或负责人变化时，走 `pnpm cli week-plan-change`，而非 `transition`。这是**仅评论（comment-only）**路径：先按普通预览与确认，再新增恰好一条含 `## 排期变更` 和完整 replacement `## 周排期` 的评论，随后 readback。它没有标签、Assignee、关闭或 Milestone `WriteOp`，且不得编辑旧排期评论；但启用排期会在 readback 后按 `postWriteback` 触发独立的 Milestone 同步。

Harness 的周一任务是**后续 rollover writer**，不是周内初始挂载入口。glab-flow 引擎没有 GitLab Milestone API/`WriteOp`；Leader 仅按引擎的 `postWriteback` 意图，在 Issue 回读完成后执行初始或排期变更同步。

## 需求/方案变更闭环

`change`（首选分级入口）与兼容保留的 `change-impact`/`change-close` 均是仅评论路径，和 `week-plan-change` 一样不修改标签、Assignee、正文或历史评论。区别是它们成对工作：open 记录冻结推进，closed 记录逐项完成证据。`change` 在此之上输出 T1–T4 定级（tier 从 open 单 scopes 重推导、禁自报）、GateSet 棘轮扩容提案（`expandedGateSet`，Leader 确认后写回 DU）与 `closeRequiresPlanVersionBump`（T3+ 才要求测试计划版本递增）。引擎只校验结构、清单和测试计划版本；Leader 负责实际修改产物、运行 local/test，以及每次评论写入后的回读。

## 引用

- 护栏 G1–G16 的完整判定与触发条件见 `guards.md`。
- 各节点的下一节点、必填项、门禁类型、Assignee 角色见 `nodes.md`。
- `run_mode` 作为审计字段的取值（state vs config）见 `resume.md`；对账（`reconcile`）见 `resume.md`「脏状态」。
# Apifox v2 资产审计补充

当 `test-plan.md` 声明 `presentation: <case> | <asset-type>` 或 `auth-profile: <case> | <profile>` 时，local/test 的最新审计必须是 `glab-flow:apifox-asset-audit:v2`。v2 逐项记录预期页面环境、实际页面环境、报告环境，以及 profile 与临时 token 变量名；三种环境不一致、缺认证回执、未知声明或任何凭据/token 值均阻断对应的 AssetAudit 与 TestRun。

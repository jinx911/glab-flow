---
name: glab-flow-gate
description: 每节点门禁仪式（取证→校验→计划→预览→确认→应用）+ 动作分层 L1/L2/L3。
---

# glab-flow 节点门禁仪式

**Last Updated:** 2026-09-02

门禁是 glab-flow 流转的安全阀：在每个节点，Leader 必须先回读 GitLab 与 DU、完成 `reconcile`，再按固定的 6 步仪式走完，才能把 Issue 推到下一节点。仪式把"取证 → 校验 → 计划 → 预览 → 确认 → 应用"串成一条不可跳序的管线；DU 是执行事实和 GateSet 的主档，state 只是缓存，门禁证据 DU 优先（无 DU 的存量 Issue 才回退评论）。再叠加动作分层（L1/L2/L3，决定"预览→应用"那一跳是否需要人）与 hard_gate 红线，确保每一次状态变更都可审计、可回溯、可中止。本文件规定仪式每一步的命令与判定，以及动作分层如何决定确认行为。

测试门禁的共同输入是 `testPlan`：开发中→测试中读取同一计划版本的 local TestRun，测试中→待发布读取同一计划版本的 test TestRun。缺任一环境的最新通过记录、计划版本不一致、或用自由文本替代执行事实，均不得推进。

## 节点门禁仪式（transition 一键，每节点固定）

仪式仍是「取证 → 校验 → 计划 → 预览 → 确认 → 应用」不可跳序的管线；在前 4 步之前必须先完成一次最新事实回读和 `reconcile`。前 4 步（取证/校验/计划/预览）由 `transition` **一次调用**完成，Leader 只在「确认 → 应用」那一跳介入。

### 0. 写回前对账（不可跳过）

Leader 读取 GitLab labels/body/state、全量父 Issue/MR notes，以及本地 DU；先运行 `pnpm cli reconcile`。`in-sync` 才进入 transition；`label-ahead` 需一次 L2 选择接受标签或回改标签；`du-ahead` 按 `writebackAudit` 只补首个未完成阶段；`dirty-labels`、`unknown-node`、非终态 external-close 停止并人工处理。对账只给方向，不自动写 GitLab，也不以 state 的 `cachedNode` 覆盖 GitLab。

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

   **GateSet 绑定点**：Story `已评审→开发中` 与 Bug `已确认缺陷→开发中` 都是绑定边界。传入技术方案/根因声明的 `declaredScopes` 后，`transition` 返回 `proposedGateSet`；Bug 若没有非空 `declaredScopes`，必须提供已有 frozen GateSet，否则 fail-closed。Leader 将 GateSet 提案与计划提测/上线日期放入同一次 L2 批量确认；绑定首轮由 Leader 调用 `pnpm cli du` 的 `bind-gateset`，只写入并冻结 DU，不写 Issue 状态。对 Bug，若 `declaredScopes` 已提供但 DU 未冻结，此轮 `validate.ok=false`、`plan` 未定义，playbook 只含 `bind_gateset`、不含 `issue_writeback`。DU 落盘后重新运行 `transition`，GateSet 已冻结时才生成正常 `WritePlan` 与 Issue 写回/最终回读；不能在绑定后直接沿用旧输出。`bindGateSet` 会冻结 GateSet，已冻结的 DU 拒绝静默重绑；后续新增维度只能走 `change` 棘轮扩容或显式、可审计的 L2 override。

2. **执行 playbook + 确认/应用**。`playbook` 的相位固定为代码侧 `pre-writeback` → Issue 写回/回读 `issue-writeback`。按动作分层（见下节）决定 `AskUserQuestion` 后执行还是自动执行：
   - **代码侧步骤**（`subskill` 指向 `git-ops` / `jenkins-deploy` / `release-check` / `mr-review`）：委派对应 sub-skill 跑（commit/push、merge→deploy_branch、Jenkins 构建、MR 评审等）。**每步完成即记 `state-writeback` 审计**（stage=`code-commit`/`code-merge`/`code-jenkins`，detail 含构建号/commit SHA）——E4 断点审计：任一步失败，恢复时只重试首个未完成的代码侧动作（Jenkins 已触发的看构建结果而不是重新触发），**不整链重放、已成功动作不再确认**。**test/非生产构建参数默认值直用**（测试数据与凭据同理，不逐参数确认；缺定义无默认值才一次问全）；**生产部署参数逐项确认**（L3 红线，见 `sub-skills/jenkins-deploy.md`）；没配 `deploy_branch` / `jenkins` 的步骤引擎已滤除。提测 = commit+push → merge→test → 触发 Jenkins；发布 = 生产部署（hard_gate，手动触发）。
   - **mr-review**：测试中→待发布 时，对每个受影响 feature→master MR 跑评审（G14，无 CRITICAL/HIGH 残留才放行），评审结论作为评论发到该 MR；父 Issue 汇总不能替代 MR-local 评审。
   - **issue_writeback（合并评论 + 三阶段串行，每阶段记 `writebackAudit`）**（仅在本轮已有正常 `WritePlan` 时）：Leader 直接跑 glab（不在引擎里做 I/O），把 `plan` 翻译成命令。按严格串行：**metadata**（标签 add/unlabel + Assignee）→ **state-comment**（合并评论 = 状态变更头 + 内容体，由 `renderNodeComment` 生成）→（终态时 close）→ **readback**（最终 Issue 回读）。绑定首轮不含此步骤，不写 Issue 状态。内容体按节点类型见 `nodes.md`「节点内容评论」。最终回读确认成功后，Leader 才调用 `pnpm cli du` 的 `cached-node`，将 DU 对账基准更新为本次的有效最终目标；随后再更新 state 缓存。
     - **标签 + Assignee**：`glab issue update <iid> [--label <add1,add2>] [--unlabel <rm1,rm2>] --assignee <@user>`；无 `harnessClone` 时加 `-R <host>/<group>/<project>` 限定项目（见 `SKILL.md`「GitLab 读写」，数字 project_id 不适用 `-R`、改用 `glab api`）。
     - **评论**：短正文 `glab issue note <iid> -m "<正文>"`；长正文（含 backtick/表格）写临时文件后 `glab issue note <iid> -F <file>`，避开 shell 转义。
     - **终态（已完成）**：`glab issue close <iid>` 只在合并评论成功后执行，并由最终回读确认；不能先关 Issue 再补评论。

   Assignee 用 `prefilled.assigneeUser`（已解析+补@）；`missing` 非空（有缺口）不推进，按 hint 委派对应 sub-skill 补齐后回第 1 步重取。**顺序铁律：代码侧步骤全部成功后，才执行 issue_writeback**（代码到位 → 才标记节点）。任何标签/Assignee、合并评论或回读失败都必须**停止**，不执行后续阶段、不假设缓存成功；恢复时先回读 GitLab，再重试**首个未完成阶段**（见 `resume.md`）。

### GateSet 生成的环境动作


GateSet `rollbackPlan=true` 时，生产发布前的动作是 `verify_rollback_ready`，只核对 `release-check` 在测试验收阶段生成且已回读的 `release-plan`；发布阶段不重新生成发布计划。

3. **冻结**。两条不可逾越的冻结线（详见 `guards.md`）：
   - **G7 不改原文**：永不 `glab issue update <iid> --description ...`，Issue 正文一旦创建即冻结。
   - **G8 不编评论**：永不 edit/delete 已发评论；评论只新增，不改写历史。

   门禁**二值**（G2）——通过走 `transition`/`plan`，退回走 `plan-return`，没有"附带条件通过"；生产部署转换（待发布→生产验收中/生产验证中）和终态验收/关闭转换（生产验收中/生产验证中→已完成）是 `hard_gate`，必须 `humanConfirmed`（G3，恒 L3），无论 GateSet、`skipStates`、`run_mode` 或其它配置都不能豁免。这是不可关闭的红线。

4. **变更闭环**（G16）。**先过「三类改」判据：改完后，proposal / design / test-plan 里有没有任何一句话变成假的？** 没有一句话变假 → 这不是变更，是**实施调整**，不开影响单——开发中=自测迭代重跑 local（节点内循环）；测试中=测试问题评论（renderTestIssue）+ 阻塞修复 + 复测，G11 收口。**有话变假**（偏差在产物层）才走本闭环：Leader 回读 Issue notes 和当前 `test-plan.md`，以 `change`（含 T1–T4 自动定级与 GateSet 棘轮扩容）预览并确认新增 open 影响单——`source` 表达「谁发现的偏差」（requirement=需求口径假 / technical-design=方案契约假 / implementation·test=实现或测试时才发现方案不可行，分别建议回退 待评审/已评审/开发中）。按其 `requiredArtifacts` 更新所有关联产物；需要返回评审/开发节点时用 `plan-return`。全部完成、按定级满足关闭要求（T3+ 须测试计划版本递增）及受影响环境重测后，使用刚回读的 notes 调 `change-close` 写 closed 回执。open 单存在时不允许调用普通 `transition` 继续推进。

### 脏状态（`transition.dirty=true` 直接识别）

Leader 停，不做推测性流转，把 `preview`（脏因）列给人工：

- **0/≥2 状态标签**：状态标签被清掉或冲突（`pnpm cli node` 推不出唯一节点）。
- **closed 但非终态**：Issue 已关闭但节点 ≠ 已完成（疑似被提前关闭）——先 `reconcile` 对账（`external-close` verdict 给出处理方向），或 reopen 后重跑（详见 `resume.md`）。

两种都不写回 GitLab、不更新 `cachedNode`。用户在 GitLab UI 修好后重跑 `transition` 会重新识别。

## 动作分层（表）

`shouldConfirm` 由**动作分层**决定（`transition` 输出 `actionTier` + `confirmBatchTitle`）：转换带不带业务 gate、带不带回不可逆动作，决定这一跳是自动执行还是人工批量确认。`run_mode`（config `run_mode` 键 / `RunState.runMode`）退化为**审计字段**，仅随 state 记录运行模式偏好，不参与确认判定。

| 分层 | 定义 | 例子 | 确认行为 |
|---|---|---|---|
| `L1`（gate===null） | 无业务判断的机械流转 | 草稿中→待评审、Bug 已冻结 GateSet 后的已确认缺陷→开发中 | `validate.ok` 即自动执行，不打断 |
| `L2`（gate!==null） | 带业务评审/放行判断的流转 | 待评审→已评审、已评审→开发中、开发中→测试中、测试中→待发布 | 以 `confirmBatchTitle` 为题做**一次** `AskUserQuestion` 批量确认 |
| `L3`（hardGate） | 不可逆动作，恒人工 | 待发布→生产验收中、生产验收中→已完成 | 必须 `humanConfirmed`（G3），任何配置不可豁免 |

**Jenkins 参数（test 环境）不再独立确认**：默认值直用直接触发，参数清单进执行记录事后审计（已裁定打通，见 `sub-skills/jenkins-deploy.md`）；提测的 L2 批量确认只覆盖流转放行判断。缺参数定义且无默认值时才一次问全。生产部署参数确认不在此列（L3）。

**hard_gate 是红线**：待发布、生产验收中、已完成这三个节点带 `hard_gate` 标记（见 `nodes.md`），L3 语义不变——无论 L1/L2 如何自动化，都必须 `humanConfirmed`（G3）才能流转。原因：发布与验收的代价不可逆（生产流量、用户可见、关闭即归档），不能由护栏单独放行。这一条不接受配置覆盖。

## 证据不足时

若第 1 步取证或第 2 步校验发现证据不够（`missing` 非空、或 `validate` 返回 `ok:false`），Leader **不推进状态**——不改标签、不发流转评论。而是按当前节点的契约（`nodes.md` 的"工作 agent / 产出"列）委派对应的节点工作 agent 去生成缺失内容：

- 草稿中缺需求草稿 → 委派 `spec-author` 产出六清楚草稿。
- 待评审缺评审意见 → 委派 `review-preview` 预审产出问题清单。
- 测试中→待发布 缺 `feature分支MR评审结论`（G14）→ playbook 的 `open_release_mr_to_master`（git-ops 只打开/确认 feature→master 发布 MR，标题=Issue 地址；**不得合并 master**）+ `mr_review`（`mr-review` sub-skill，优先 mr-review-lite、降级 code-review）跑全 MR diff，无 CRITICAL/HIGH 残留才填「通过」放行；有残留则留在测试中修复重评，不进 待发布。真正合并/部署只属于发布 hard_gate（待发布→生产验收中/生产验证中）。

agent 产出落到 Issue 评论或 `<specDir>` 文档后，Leader 回到第 1 步重新取证、第 2 步重新校验，直到 `ok:true` 再建计划。换句话说：**门禁不通过 → 回去干活，而不是改门禁**。


**跳状态投影**：GateSet `skipStates` 仅把命中的中间节点投影为其下一节点（只一层）；`next`、标签和状态评论头使用最终目标，但 `validate` 仍按原始转换执行，所需字段与 guards 不减少。它不能绕过生产部署或终态验收等 `hard_gate`。

## 需求/方案变更闭环

`change`（首选分级入口）与兼容保留的 `change-impact`/`change-close` 均是仅评论路径，不修改标签、Assignee、正文或历史评论。它们成对工作：open 记录冻结推进，closed 记录逐项完成证据。`change` 在此之上输出 T1–T4 定级（tier 从 open 单 scopes 重推导、禁自报）、GateSet 棘轮扩容提案（`expandedGateSet`，Leader 确认后写回 DU）与 `closeRequiresPlanVersionBump`（T3+ 才要求测试计划版本递增）。引擎只校验结构、清单和测试计划版本；Leader 负责实际修改产物、运行 local/test，以及每次评论写入后的回读。

## 引用

- 护栏 G1–G16 的完整判定与触发条件见 `guards.md`。
- 各节点的下一节点、必填项、门禁类型、Assignee 角色见 `nodes.md`。
- `run_mode` 作为审计字段的取值（state vs config）见 `resume.md`；对账（`reconcile`）见 `resume.md`「脏状态」。

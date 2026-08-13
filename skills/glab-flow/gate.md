---
name: glab-flow-gate
description: 每节点门禁仪式（取证→校验→计划→预览→确认→应用）+ semi/full-auto。
---

# glab-flow 节点门禁仪式

门禁是 glab-flow 流转的安全阀：在每个节点，Leader 必须按固定的 6 步仪式走完，才能把 Issue 推到下一节点。仪式把"取证 → 校验 → 计划 → 预览 → 确认 → 应用"串成一条不可跳序的管线，再叠加 run 模式（semi/full-auto）与 hard_gate 红线，确保每一次状态变更都可审计、可回溯、可中止。本文件规定仪式每一步的命令与判定，以及 run 模式如何影响"预览→应用"那一跳。

## 节点门禁仪式（transition 一键，每节点固定）

仪式仍是「取证 → 校验 → 计划 → 预览 → 确认 → 应用」不可跳序的管线；前 4 步（取证/校验/计划/预览）由 `transition` **一次调用**完成，Leader 只在「确认 → 应用」那一跳介入。

1. **一键 transition（取证+校验+计划+预览）**。Leader 先只读 glab：`glab issue view <iid> --output json` 取 labels/body/state；`glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100"` 取父 Issue 评论；有受影响 MR 时逐个取该 MR 的 notes。把刚回读的结果喂给：

   ```bash
   pnpm cli transition
   ```

   stdin JSON 含普通 Issue 字段（`type`/`iid`/`labels`/`body`/`notes`/`state`）+ 已知 `fields` + 可选 `to`/`runMode`/`config`。stdout 一次给出：
   - `dirty` / `dirtyReason`（脏则停，见下文「脏状态」）；
   - `prefilled`（Assignee 按「交付协同表 → config.roles → 输入」解析并补 `@`；必填字段扫评论「- 字段：值」按精确 key 预填，标「来自评论，请核实」）；
   - `missing[]`（每个缺字段带 hint：来源 / 格式 / 期望值）；
   - `validate`（G1–G14，`reasons` 自带补救动作；`ok:false` 则 `plan` 为空、不推进）；
   - `plan`（`WritePlan`：标签 / Assignee / 评论 / 是否 close）+ `comment`（合并评论正文 = 状态变更头 + 内容体，`renderNodeComment` 生成）+ `playbook`（本转换副作用动作包，见下）+ `nodeProgress`（当前节点子步骤 checklist）+ `preview`（散文 diff）+ `shouldConfirm`。

   `transition` 内部即「评论字段扫描（取证 + 预填）→ `validate`（校验）→ `plan`（计划）→ `render`（预览）」的顺序编排；`evidence` 命令是独立的结构化取证工具（不参与内部预填）；退回（G2 二值）仍走 `plan-return`。

2. **执行 playbook + 确认/应用**。`playbook` 是本转换的完整动作包，代码侧步骤在前、Issue 写回（`isWriteback:true`）恒为末步。按 run 模式（见下节）决定 `AskUserQuestion` 后执行还是自动执行：
   - **代码侧步骤**（`subskill` 指向 `git-ops` / `jenkins-deploy` / `release-check` / `mr-review`）：委派对应 sub-skill 跑（commit/push、merge→deploy_branch、Jenkins 构建、MR 评审等），**每步按 sub-skill 自身规则确认——与 run_mode 无关**：full-auto 也必须对 Jenkins 参数（job/分支/`test_version`/`DEPLOY_ENV`/`force_package` 等）逐个 AskUserQuestion 交互问 + 展示部署清单确认（粗粒度流转确认 ≠ 参数确认，见 `sub-skills/jenkins-deploy.md`）；没配 `deploy_branch` / `jenkins` 的步骤引擎已滤除。提测 = commit+push → merge→test → 触发 Jenkins；发布 = 生产部署（hard_gate，手动触发）。
   - **mr-review**：测试中→待发布 时，对每个受影响 feature→master MR 跑评审（G14，无 CRITICAL/HIGH 残留才放行），评审结论作为评论发到该 MR；父 Issue 汇总不能替代 MR-local 评审。
   - **末步 issue_writeback（合并评论 + 三阶段串行，每阶段记 `writebackAudit`）**：Leader 直接跑 glab（不在引擎里做 I/O），把 `plan` 翻译成命令。按严格串行：**metadata**（标签 add/unlabel + Assignee）→ **state-comment**（合并评论 = 状态变更头 + 内容体，由 `renderNodeComment` 生成）→（终态时 close）→ **readback**（最终 Issue 回读）。内容体按节点类型见 `nodes.md`「节点内容评论」。
     - **标签 + Assignee**：`glab issue update <iid> [--label <add1,add2>] [--unlabel <rm1,rm2>] --assignee <@user>`；无 `harnessClone` 时加 `-R <host>/<group>/<project>` 限定项目（见 `SKILL.md`「GitLab 读写」，数字 project_id 不适用 `-R`、改用 `glab api`）。
     - **评论**：短正文 `glab issue note <iid> -m "<正文>"`；长正文（含 backtick/表格）写临时文件后 `glab issue note <iid> -F <file>`，避开 shell 转义。
     - **终态（已完成）**：`glab issue close <iid>` 只在合并评论成功后执行，并由最终回读确认；不能先关 Issue 再补评论。

   Assignee 用 `prefilled.assigneeUser`（已解析+补@）；`missing` 非空（有缺口）不推进，按 hint 委派对应 sub-skill 补齐后回第 1 步重取。**顺序铁律：代码侧步骤全部成功后，才执行 issue_writeback**（代码到位 → 才标记节点）。任何标签/Assignee、合并评论或回读失败都必须**停止**，不执行后续阶段、不假设缓存成功；恢复时先回读 GitLab，再重试**首个未完成阶段**（见 `resume.md`）。

3. **冻结**。两条不可逾越的冻结线（详见 `guards.md`）：
   - **G7 不改原文**：永不 `glab issue update <iid> --description ...`，Issue 正文一旦创建即冻结。
   - **G8 不编评论**：永不 edit/delete 已发评论；评论只新增，不改写历史。

   门禁**二值**（G2）——通过走 `transition`/`plan`，退回走 `plan-return`，没有"附带条件通过"；`hard_gate`（待发布 / 生产验收中 / 已完成）必须 `humanConfirmed`（G3），无论 run 模式如何都要人工拍板，这是不可关闭的红线。

### 脏状态（`transition.dirty=true` 直接识别）

Leader 停，不做推测性流转，把 `preview`（脏因）列给人工：

- **0/≥2 状态标签**：状态标签被清掉或冲突（`pnpm cli node` 推不出唯一节点）。
- **closed 但非终态**：Issue 已关闭但节点 ≠ 已完成（疑似被提前关闭）——reopen 或人工对账标签后重跑（详见 `resume.md`）。

两种都不写回 GitLab、不更新 `cachedNode`。用户在 GitLab UI 修好后重跑 `transition` 会重新识别。

## run 模式（表）

`run_mode` 来自配置（`config.md` 的 `run_mode` 键）或 state 文件（`RunState.runMode`）。两模式只影响第 5 步"确认/应用"那一跳，前面 1–4 步（取证/校验/计划/预览）完全一致。

| run 模式 | 门禁预览 | 自动应用范围 | hard_gate（待发布/验收/关闭） |
|---|---|---|---|
| `semi-auto`（默认） | 展示 diff + `AskUserQuestion` 确认后再应用 | 不自动应用——每个节点都要用户点头 | **强制人工**（G3，不可关） |
| `full-auto` | 仍展示 diff（可审计），但不阻塞 | 护栏 `ok:true` 即自动应用 glab 命令 | **强制人工**（G3，不可关） |

**hard_gate 是红线**：待发布、生产验收中、已完成这三个节点带 `hard_gate` 标记（见 `nodes.md`），无论 semi 还是 full-auto，都必须 `humanConfirmed`（G3）才能流转——full-auto 在这里也要停下问人。原因：发布与验收的代价不可逆（生产流量、用户可见、关闭即归档），不能由护栏单独放行。这一条不接受配置覆盖。

## 证据不足时

若第 1 步取证或第 2 步校验发现证据不够（`missing` 非空、或 `validate` 返回 `ok:false`），Leader **不推进状态**——不改标签、不发流转评论。而是按当前节点的契约（`nodes.md` 的"工作 agent / 产出"列）委派对应的节点工作 agent 去生成缺失内容：

- 草稿中缺需求草稿 → 委派 `spec-author` 产出六清楚草稿。
- 待评审缺评审意见 → 委派 `review-preview` 预审产出问题清单。
- 开发中缺代码/自测 → 委派 `git-ops` + `tdd-guide` + `codegraph` 做开发。
- 测试中缺测试计划 → 委派 `test-design` / `test-flow`/`apifox` 相关 agent。
- 测试中→待发布 缺 `feature分支MR评审结论`（G14）→ playbook 的 `create_mr_to_master`（git-ops 提 PR feature→master，标题=Issue 地址）+ `mr_review`（`mr-review` sub-skill，优先 mr-review-lite、降级 code-review）跑全 MR diff，无 CRITICAL/HIGH 残留才填「通过」放行；有残留则留在测试中修复重评，不进 待发布。

agent 产出落到 Issue 评论或 `<specDir>` 文档后，Leader 回到第 1 步重新取证、第 2 步重新校验，直到 `ok:true` 再建计划。换句话说：**门禁不通过 → 回去干活，而不是改门禁**。

## 引用

- 护栏 G1–G14 的完整判定与触发条件见 `guards.md`。
- 各节点的下一节点、必填项、门禁类型、Assignee 角色见 `nodes.md`。
- run 模式在恢复场景下的取值（state vs config）见 `resume.md`。

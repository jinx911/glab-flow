---
name: glab-flow-gate
description: 每节点门禁仪式（取证→校验→计划→预览→确认→应用）+ semi/full-auto。
---

# glab-flow 节点门禁仪式

门禁是 glab-flow 流转的安全阀：在每个节点，Leader 必须按固定的 6 步仪式走完，才能把 Issue 推到下一节点。仪式把"取证 → 校验 → 计划 → 预览 → 确认 → 应用"串成一条不可跳序的管线，再叠加 run 模式（semi/full-auto）与 hard_gate 红线，确保每一次状态变更都可审计、可回溯、可中止。本文件规定仪式每一步的命令与判定，以及 run 模式如何影响"预览→应用"那一跳。

## 节点门禁仪式（6 步，每节点固定）

每个节点、每次流转都按这 6 步走，不省略、不换序。

1. **取证**。Leader 从 GitLab 拉评论，交给引擎抽证据：

   ```bash
   glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100" | pnpm cli evidence
   ```

   stdin 是 GitLab notes 数组（`[{body}, ...]`），stdout 是引擎从 `## 状态变更` 评论块里抽出的结构化证据（确认人/日期/结论/阻塞问题验证等）。这些证据是后续护栏判定（G1 必填、G3 hard_gate 人工确认、G11 阻塞全验证）的输入。`<host>`/`<id>` 从配置（`config.md`）取，不硬编码。

2. **校验**。Leader 把 `{type, labels, payload}` 喂给护栏：

   ```bash
   pnpm cli validate
   ```

   stdin 是 JSON `{type: 'story'|'bug', labels: string[], payload: Payload}`，stdout 是 `{ok: boolean, missing: string[], reasons: string[], ...}`，对应 G1–G13（见 `guards.md`）。`ok:false` → **停**，把 `missing` 与 `reasons` 列给用户，问需要补什么（证据、确认人、日期确认等）。补齐后重跑 `validate`，直到 `ok:true` 才进下一步。绝不在 `ok:false` 下推进状态。

3. **建计划**。校验通过后，按流转方向建写回计划：
   - **正向**（进下一节点）：`pnpm cli plan <iid>`，stdin JSON `{payload}`，stdout 是 `WritePlan`（标签 add/remove、Assignee、评论、是否 close）。
   - **退回**（门禁退回，G2 二值）：`pnpm cli plan-return <iid>`，stdin JSON `{type, from, target, issues, confirmer, date, assigneeUser?}`，stdout 是退回专用 `WritePlan`。

   走哪条由门禁结论决定——通过走 `plan`，退回走 `plan-return`，不存在"半退半进"。

4. **预览**。Leader 把 `WritePlan` 翻译成具体的 glab 命令序列，以 diff 形式展示给用户：哪些标签 add、哪些 unlabel、Assignee 改成谁、会发什么评论（正文由 `pnpm cli render` 或 plan 自带 body 生成）、是否 close Issue。预览的目的是让用户在不可逆的 glab 调用之前看到确切后果。

5. **确认/应用**。按 run 模式（见下节）决定是 AskUserQuestion 后应用还是自动应用。应用阶段 Leader 直接跑 glab（不在引擎里做 I/O）：
   - **标签 + Assignee**：`glab issue update <iid> --label <add1,add2> --unlabel <rm1,rm2> --assignee <@user>`
   - **评论**：`glab issue note <iid> -m "<由 render/plan 生成的正文>"`
   - **终态（已完成）**：`glab issue close <iid>`。G12 要求终态原子——标签替换 + Assignee + 评论 + 关闭必须**同一次**完成（`closeIssue: true` 的 plan 一次跑完），不能先关 Issue 再补评论。

   Assignee 必须是具体 `@用户`（G6），从 Issue 正文「交付协同」表解析角色对应的 @用户；缺则反问用户，不接受角色名占位。

6. **冻结**。两条不可逾越的冻结线（详见 `guards.md`）：
   - **G7 不改原文**：永不 `glab issue update <iid> --description ...`，Issue 正文一旦创建即冻结。
   - **G8 不编评论**：永不 edit/delete 已发评论；评论只新增，不改写历史。

   此外：门禁是**二值**的（G2）——通过走 `plan`，退回走 `plan-return`，没有"附带条件通过"；`hard_gate`（待发布 / 生产验收中 / 已完成）必须 `humanConfirmed`（G3），无论 run 模式如何都要人工拍板，这是不可关闭的红线。

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

agent 产出落到 Issue 评论或 `<specDir>` 文档后，Leader 回到第 1 步重新取证、第 2 步重新校验，直到 `ok:true` 再建计划。换句话说：**门禁不通过 → 回去干活，而不是改门禁**。

## 引用

- 护栏 G1–G13 的完整判定与触发条件见 `guards.md`。
- 各节点的下一节点、必填项、门禁类型、Assignee 角色见 `nodes.md`。
- run 模式在恢复场景下的取值（state vs config）见 `resume.md`。

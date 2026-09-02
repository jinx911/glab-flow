# 护栏 G1–G16（确定性，由 engine/src/guard.ts 强制；本表给 Leader 参考）

护栏触发时，`reasons` 文本本身即携带**补救动作**（期望值 / 怎么补 / 去哪取）；优先用 `transition` 命令一次性拿到 `missing`（带 hint）+ `reasons`，而非手工拼 payload 试错。

- **G1** 流转前置必填：目标节点的日期/确认人/结论/证据任一空 → block（hint 标注每个字段的来源/格式）
- **G2** 门禁二值(通过/退回)：退回 → 走 return 路径，不进下一节点
- **G3** hard_gate 需 humanConfirmed（待发布/验收/关闭）—— reason 直说「在 payload 加 humanConfirmed: true」
- **G4** 三类评审分离：reviewType 必须等于门禁（防技评/代码评审替代需求评审）
- **G5** 标签唯一：0 或 ≥2 个 story-status::*/status::* → 脏状态，拒绝驱动
- **G6** Assignee 必须是具体 @用户，不能是角色名——`transition` 自动按「交付协同表 → config.roles → 输入」解析并补 `@`；仍无则 reason 提示来源
- **G7** 不改原文（永不 update issue body）
- **G8** 不编评论（永不 edit/delete comment）
- **G9** 不臆造人/结论（禁"待确认"占位）
- **G10** 日期需用户确认（datesConfirmed）
- **G11** 阻塞发布问题全部验证通过才放行 待发布（需求与 Bug 均适用；仅进入过测试环境的路线触发——GateSet 跳过「测试中」的投影路线不经过该转换）—— 肯定同义集合：`是` / `已验证` / `已通过` / `无阻塞` / `通过` / `true` / `yes`，或以「是」开头的附注（如 `是(无阻塞)`、`是。详细…`）；`否` / `未` / `false` / 空 / `待确认` 拒
- **G12** 终态有序且可回读：标签替换+Assignee → 状态变更评论 → close Issue → 最终回读必须属于同一已批准 WritePlan，按序执行；任何阶段失败立即停止，不能先关 Issue 再补评论。
- **G13** 不建 Jira
- **G14** feature→master MR 评审前置（**仅在 DU GateSet `mrReview=true` 时生效**；frontend-copy 等轻量维度推导为 false 时豁免该必填字段，GateSet 缺省按 true）：测试中→待发布 必填 `feature分支MR评审结论`（由 G1 强制非空）——用 `code-review` sub-skill 跑全 MR diff，确认无 CRITICAL/HIGH 残留再放行。避免阻塞 bug 漏到「待发布」才被 mr-review 发现、已过测试验收还得回头重提测
- **G15** 需求评审取证：Story 待评审→已评审必须有 `reviewEvidence`。Issue 正文/评论中每张图都要有 OCR 与视觉摘要；无法识别必须提问、不得跳过。涉及前端页面/菜单/路由时必须有“用户位置→实际 URL→路由文件→组件→分流”的代码证据，无法确认地址时不得猜测。Grilling 决策账本必须覆盖目标与范围、角色与权限、业务规则与边界、数据与兼容、验收与多环境验证；未决项不允许通过。
- **G16** 变更闭环：检测到 `glab-flow:change-impact:v1 status: open` 时，任何正向状态流转均阻断。必须按影响单同步全部产物并写入 `change-close` 的 closed 回执。变化分级 T1–T4（`change` 命令自动定级，tier 从 open 单 scopes 重推导、禁自报）：轻量级的关闭证据要求随级别降低——T1/T2 豁免测试计划版本严格递增检查，T3+ 若影响测试计划则 `plan-version` 必须递增，旧环境执行证据不可复用。

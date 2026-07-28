# 护栏 G1–G13（确定性，由 engine/src/guard.ts 强制；本表给 Leader 参考）

- **G1** 流转前置必填：目标节点的日期/确认人/结论/证据任一空 → block
- **G2** 门禁二值(通过/退回)：退回 → 走 return 路径，不进下一节点
- **G3** hard_gate 需 humanConfirmed（待发布/验收/关闭）
- **G4** 三类评审分离：reviewType 必须等于门禁（防技评/代码评审替代需求评审）
- **G5** 标签唯一：0 或 ≥2 个 story-status::*/status::* → 脏状态，拒绝驱动
- **G6** Assignee 必须是具体 @用户，不能是角色名（从「交付协同」表解析）
- **G7** 不改原文（永不 update issue body）
- **G8** 不编评论（永不 edit/delete comment）
- **G9** 不臆造人/结论（禁"待确认"占位）
- **G10** 日期需用户确认（datesConfirmed）
- **G11** 阻塞发布问题全部验证通过才放行 待发布（需求与 Bug 均适用）
- **G12** 终态原子：标签替换+Assignee+评论+关闭 Issue 必须同一次操作（closeIssue）
- **G13** 不建 Jira

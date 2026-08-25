# Week Milestone 初始挂载设计

## 背景

Harness 的周一 `week_rollover` 只处理已完成初始挂载的 Issue 的后续跨周切换。需求在周内评审通过或排期变更后，必须由 glab-flow Leader 在状态/排期评论回读成功后立即完成首次关联；不能等下一次周一任务。

## 边界

- 引擎仍是纯计算：只输出 `postWriteback.sync_week_milestone` 意图，不调用 GitLab。
- Story `待评审 → 已评审` 携带有效且启用的周排期时输出意图。
- 已有有效启用周排期的 Bug `已确认缺陷 → 开发中` 也输出意图。
- `week-plan-change` 写入并回读 replacement 周排期后输出同一意图；暂停排期不输出。
- Leader 顺序固定为：前置业务动作 → Issue metadata/comment 写回 → Issue 回读 → Milestone 幂等同步。同步失败记录独立审计并重试，不撤回已确认状态或排期评论。

## Leader 同步规则

Leader 以 Asia/Shanghai 的业务日期和最新有效 `## 周排期` 决定目标：未开始取计划开始日期所在周；执行中取当天所在周；已结束跳过。目标 Week Milestone 不存在则创建，存在则关联 Issue；不得修改 Issue 状态、负责人、正文或评论。周一任务只负责此后的跨周 rollover。

# Week Plan Contract Design（已由 2026-08-25 初始挂载设计修订）

> 本文的「Harness 是唯一 Milestone writer」结论已失效。现行职责为：glab-flow Leader 在状态/排期评论回读后完成初始挂载；Harness 周一任务仅做后续 rollover。详见 `2026-08-25-week-milestone-initial-sync-design.md`。

## Goal

Make glab-flow emit and validate the exact machine-readable `## 周排期` comment consumed by OA AI Native Harness, then emit a pure post-readback intent for the Leader to perform the initial Week Milestone association.

## Context

Harness treats a Week Milestone as a weekly coordination view, separate from the delivery state machine. Its protected-master rollover job reads only the latest `## 周排期` block on an open, confirmed Story or Bug. It changes only Milestone associations.

glab-flow currently records only planned test and release times before development. It has no structured week-plan input, renderer, validation, readback diagnosis, or schedule-change path. A requirement completed through the current flow is therefore skipped by the Harness rollover job.

## Boundaries

### In scope

- Record a valid Week Plan when a Story transitions from `待评审` to `已评审`.
- Validate Week Plan dates, ISO-week coverage, and `自动 rollover` before state writeback.
- Render the exact Harness-compatible Markdown block in the same immutable state-comment that records the review decision.
- Provide a standalone schedule-change operation that appends an `排期变更` explanation and a replacement Week Plan block without changing status, Assignee, Issue body, or existing comments.
- Read and diagnose the latest Week Plan during normal transition and resume preparation.

### Out of scope

- 引擎直接创建、关闭或关联 GitLab Milestone（引擎仍无 I/O；Leader 在回读后按意图执行初始同步）。
- Running a Monday scheduler, an event hook, or any other rollover worker.
- Inferring dates, owners, or whether rollover should be enabled.
- Retroactively rewriting historic Issue comments or schedule data.

Leader 与 Harness 的职责按触发时机分离：Leader 负责周内初始挂载与排期变更同步；Harness 受保护 master 的周一任务负责后续 rollover。两者只调整 Milestone 关联，且都不得修改 Issue 其他字段。

## Contract

The renderer produces this block exactly once in an `待评审 → 已评审` state comment when the supplied plan is valid:

```markdown
## 周排期

- 计划开始：2026-08-17
- 计划完成：2026-09-06
- 计划覆盖周：W34 ～ W36
- 自动 rollover：启用
```

The only accepted input is a structured `weekPlan` value:

```ts
type WeekPlanInput = {
  startDate: string;        // YYYY-MM-DD, real calendar date
  endDate: string;          // YYYY-MM-DD, on or after startDate
  autoRollover: boolean;    // never inferred
};
```

`计划覆盖周` is derived, never supplied independently. It uses ISO week years and numbers, including year boundaries: a plan within one ISO year renders `W34 ～ W36`, while a cross-year plan renders `2026-W52 ～ 2027-W01`.

The `autoRollover` renderer uses only `启用` and `暂停`. The block uses the exact headings and field names expected by Harness. An incomplete or invalid plan must not render a `## 周排期` heading at all.

## State-machine integration

For Stories, `待评审 → 已评审` requires a valid `weekPlan` in addition to the existing review evidence. The emitted combined state comment preserves the existing status-change fields and appends the Week Plan block.

`已评审 → 开发中` keeps its existing planned test and release requirements. It additionally requires a valid, latest readback Week Plan. This prevents development from proceeding after a malformed later schedule record has made Harness rollover skip the Issue.

Bug scheduling remains optional: a standalone Week Plan may be appended for a confirmed Bug, and Harness can consume it, but no Bug state transition becomes blocked by it.

## Schedule changes

Add a pure engine command, `week-plan-change`, that accepts the Issue identity, a complete `WeekPlanInput`, and the required change facts:

- change date;
- original plan;
- reason;
- impact;
- next step and concrete owner.

It returns a preview and a `WritePlan` containing one `add_comment` operation. The comment contains `## 排期变更` followed by the complete replacement `## 周排期` block. It has no label, Assignee, close, or Milestone `WriteOp`; an enabled plan additionally carries a post-readback sync intent for the Leader.

The Leader uses the ordinary preview/confirmation/readback protocol. It never edits the earlier schedule block. Harness intentionally reads the newest block; if that newest block is malformed, the Leader reports it as a blocking schedule defect rather than falling back to an older plan.

## Readback and recovery

Introduce a pure parser for note bodies that finds the latest `## 周排期` block in chronological note order. Its result distinguishes:

- no plan;
- valid enabled plan;
- valid paused plan;
- invalid latest plan.

Transition preview and resume output show this diagnosis. A valid older plan followed by a malformed latest block is `invalid latest plan`, not a valid fallback. This matches Harness behaviour exactly.

The engine emits a typed post-readback sync intent, not a Milestone `WriteOp`. The Leader reads GitLab before deciding whether the target needs creation or association, then records the result independently for recovery.

## Error handling

- Reject malformed dates, impossible calendar dates, and `endDate < startDate`.
- Reject missing Week Plan input for the Story review transition and for Story development entry.
- Reject a manual schedule-change request missing any required explanation field.
- Do not render a partial schedule block.
- Do not infer `autoRollover`, a date, or a schedule owner.

## Test strategy

1. Unit-test ISO-week calculation for one week, multi-week, and ISO year boundary schedules.
2. Unit-test parser outcomes for absent, enabled, paused, incomplete, invalid-date, and later-invalid Week Plan comments.
3. Add transition tests proving Story review needs a valid plan, development entry rejects an invalid latest readback, and Bug transitions remain compatible.
4. Add renderer tests for exact Harness Markdown fields and derived coverage text.
5. Add CLI/plan tests proving `week-plan-change` emits one comment-only operation plus an enabled-plan post-readback sync intent, without metadata or close operations.
6. Add process-contract tests that preserve the boundary: engine never invokes GitLab APIs; Leader initial sync and Harness rollover are documented separately.

## Compatibility

Existing persisted run state gains only optional schedule diagnostics. Existing Issues are never migrated or edited. An older Issue without a Week Plan remains readable; it needs a new explicit schedule comment only when the team wants it eligible for Harness weekly rollover or when a Story next enters development under the new rule.

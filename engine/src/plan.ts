import type { WritePlan, IssueType, Payload, WeekMilestoneSyncIntent, WeekPlanChangeInput } from './types.js';
import { STATUS_NAMESPACE } from './constants.js';
import { renderNodeComment, renderReturn } from './render.js';
import { renderWeekPlan, validateWeekPlan } from './week-plan.js';

export interface ReturnInput {
  type: IssueType;
  from: string;
  target: string;
  issues: string[];
  confirmer: string;
  date: string;
  assigneeUser?: string;
  issueIid: number;
}

/**
 * The engine only emits this intent. The Leader applies it after the Issue
 * comment/state readback so a failed Milestone operation can be retried
 * without repeating or rolling back the confirmed state change.
 */
export function buildWeekMilestoneSyncIntent(
  payload: Pick<Payload, 'type' | 'from' | 'to' | 'weekPlan'>,
): WeekMilestoneSyncIntent | undefined {
  const trigger = payload.type === 'story' && payload.from === '待评审' && payload.to === '已评审'
    ? 'review-approved'
    : payload.type === 'bug' && payload.from === '已确认缺陷' && payload.to === '开发中'
      ? 'bug-development-start'
      : undefined;
  if (!trigger || !payload.weekPlan) return undefined;

  const validation = validateWeekPlan(payload.weekPlan);
  if (!validation.ok || !validation.plan.autoRollover) return undefined;
  return { action: 'sync_week_milestone', trigger, plan: validation.plan };
}

/** 正向流转建写回计划：标签替换 + Assignee + 状态变更评论 +（终态）关闭。 */
export function buildForwardPlan(payload: Payload, issueIid: number): WritePlan {
  const prefix = STATUS_NAMESPACE[payload.type];
  const postWriteback = buildWeekMilestoneSyncIntent(payload);
  return {
    issueIid,
    ops: [
      { kind: 'remove_label', value: `${prefix}::${payload.from}` },
      { kind: 'add_label', value: `${prefix}::${payload.to}` },
      { kind: 'set_assignee', username: payload.assigneeUser ?? '' },
      { kind: 'add_comment', body: renderNodeComment(payload) },
      ...(payload.closeIssue ? [{ kind: 'close_issue' as const }] : []),
    ],
    ...(postWriteback ? { postWriteback } : {}),
  };
}

export function buildReturnPlan(input: ReturnInput): WritePlan {
  const prefix = STATUS_NAMESPACE[input.type];
  return {
    issueIid: input.issueIid,
    ops: [
      { kind: 'remove_label', value: `${prefix}::${input.from}` },
      { kind: 'add_label', value: `${prefix}::${input.target}` },
      ...(input.assigneeUser ? [{ kind: 'set_assignee' as const, username: input.assigneeUser }] : []),
      { kind: 'add_comment' as const, body: renderReturn(input.target, input.issues, input.confirmer, input.date) },
    ],
  };
}

/** Builds the single immutable comment used to record a Week Plan replacement. */
export function buildWeekPlanChangePlan(input: WeekPlanChangeInput): WritePlan {
  const validation = validateWeekPlan(input.weekPlan);
  if (!validation.ok) throw new Error(`week-plan-change: invalid weekPlan: ${validation.errors.join('；')}`);
  const weekPlan = renderWeekPlan(validation.plan);
  if (!weekPlan) throw new Error('week-plan-change: could not render validated weekPlan');

  const comment = [
    '## 排期变更',
    '',
    `- 变更日期：${input.changeDate}`,
    `- 原排期：${input.originalPlan}`,
    `- 变更原因：${input.reason}`,
    `- 影响：${input.impact}`,
    `- 后续动作：${input.nextStep}`,
    `- 负责人：${input.owner}`,
    '',
    weekPlan,
  ].join('\n');

  return {
    issueIid: input.iid,
    ops: [{ kind: 'add_comment', body: comment }],
    ...(validation.plan.autoRollover ? {
      postWriteback: { action: 'sync_week_milestone' as const, trigger: 'week-plan-change' as const, plan: validation.plan },
    } : {}),
  };
}

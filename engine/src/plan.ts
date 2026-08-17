import type { WritePlan, IssueType, Payload, WeekPlanChangeInput } from './types.js';
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

/** 正向流转建写回计划：标签替换 + Assignee + 状态变更评论 +（终态）关闭。 */
export function buildForwardPlan(payload: Payload, issueIid: number): WritePlan {
  const prefix = STATUS_NAMESPACE[payload.type];
  return {
    issueIid,
    ops: [
      { kind: 'remove_label', value: `${prefix}::${payload.from}` },
      { kind: 'add_label', value: `${prefix}::${payload.to}` },
      { kind: 'set_assignee', username: payload.assigneeUser ?? '' },
      { kind: 'add_comment', body: renderNodeComment(payload) },
      ...(payload.closeIssue ? [{ kind: 'close_issue' as const }] : []),
    ],
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

  return { issueIid: input.iid, ops: [{ kind: 'add_comment', body: comment }] };
}

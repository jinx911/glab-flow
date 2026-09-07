import type { WritePlan, IssueType, Payload } from './types.js';
import { STATUS_NAMESPACE } from './constants.js';
import { renderNodeComment, renderReturn, validatePublicComment, validatePublicText } from './render.js';

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
  const publicValidation = validatePublicComment(payload);
  if (!publicValidation.ok) {
    throw new Error(publicValidation.reasons.join('；'));
  }
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
  const comment = renderReturn(input.target, input.issues, input.confirmer, input.date);
  const publicValidation = validatePublicText(comment);
  if (!publicValidation.ok) throw new Error(publicValidation.reasons.join('；'));
  return {
    issueIid: input.issueIid,
    ops: [
      { kind: 'remove_label', value: `${prefix}::${input.from}` },
      { kind: 'add_label', value: `${prefix}::${input.target}` },
      ...(input.assigneeUser ? [{ kind: 'set_assignee' as const, username: input.assigneeUser }] : []),
      { kind: 'add_comment' as const, body: comment },
    ],
  };
}

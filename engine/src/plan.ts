import type { WritePlan, IssueType } from './types.js';
import { renderReturn } from './render.js';

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

export function buildReturnPlan(input: ReturnInput): WritePlan {
  const prefix = input.type === 'story' ? 'story-status' : 'status';
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

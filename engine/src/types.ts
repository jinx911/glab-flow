export type IssueType = 'story' | 'bug';
export type Role = '产品' | '研发' | '测试';

export interface Transition {
  from: string;
  to: string;
  gate: string | null;
  gateOutcome?: string[];
  requiredFields: string[];
  assigneeRole: Role;
  hardGate?: boolean;
  terminal?: boolean;
  return?: { target: string; assigneeRole: Role; onlyWhen?: string; note?: string };
}

export interface StateMachine {
  story: { states: string[]; transitions: Transition[] };
  bug: { states: string[]; transitions: Transition[] };
  reviews: Record<string, string>;
  roleFields: Record<Role, string[]>;
}

export interface Payload {
  type: IssueType;
  from: string;
  to: string;
  fields: Record<string, string>;
  gateOutcome?: '通过' | '退回';
  reviewType?: string;
  assigneeUser?: string;
  datesConfirmed?: boolean;
  humanConfirmed?: boolean;
  closeIssue?: boolean;
}

export interface IssueFacts {
  labels: string[];
  body: string;
  state: 'opened' | 'closed';
  hasJiraSourceLabel: boolean;
}

export type WriteOp =
  | { kind: 'add_label'; value: string }
  | { kind: 'remove_label'; value: string }
  | { kind: 'set_assignee'; username: string }
  | { kind: 'add_comment'; body: string }
  | { kind: 'close_issue' };

export interface WritePlan {
  issueIid: number;
  ops: WriteOp[];
}

export interface GuardResult {
  ok: boolean;
  missing: string[];
  reasons: string[];
}

export type RunMode = 'semi-auto' | 'full-auto';

export interface MissingItem {
  field: string;
  hint: string;
}

/** `transition` 命令输入：Leader 两次只读 glab 拿到的原料 + 已知字段。 */
export interface TransitionInput {
  type: IssueType;
  iid: number;
  labels: string[];
  body: string;
  notes: { body: string }[];
  state: 'opened' | 'closed';
  to?: string;
  fields?: Record<string, string>;
  gateOutcome?: '通过' | '退回';
  reviewType?: string;
  assigneeUser?: string;
  datesConfirmed?: boolean;
  humanConfirmed?: boolean;
  closeIssue?: boolean;
  runMode?: RunMode;
  config?: { roles?: Record<string, string> };
}

/** `transition` 命令输出：一次调用产出节点/证据/预填/校验/计划/预览/是否需确认。引擎永不应用（applied:false）。 */
export interface TransitionOutput {
  node: string | null;
  next: string | null;
  dirty: boolean;
  dirtyReason?: string;
  transition?: Transition;
  prefilled: Record<string, string>;
  missing: MissingItem[];
  payload?: Payload;
  validate: GuardResult;
  plan?: WritePlan;
  preview: string;
  shouldConfirm: boolean;
  applied: false;
}

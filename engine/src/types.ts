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
  /** 跨节点副作用步骤（仅声明，Leader 执行）：commit/merge/deploy 等；Issue 写回由引擎自动追加为末步。 */
  playbook?: { action: string; when?: string }[];
}

export interface StateMachine {
  story: { states: string[]; transitions: Transition[] };
  bug: { states: string[]; transitions: Transition[] };
  reviews: Record<string, string>;
  roleFields: Record<Role, string[]>;
  progressSteps?: Record<string, string[]>;
}

export interface Payload {
  type: IssueType;
  from: string;
  to: string;
  fields: Record<string, string>;
  /** Structured schedule input; rendering derives coverage only after validation. */
  weekPlan?: WeekPlanInput;
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

/** Harness-compatible Week Plan creation input. Coverage is always derived. */
export interface WeekPlanInput {
  startDate: string;
  endDate: string;
  autoRollover: boolean;
}

/** Facts required when appending a replacement Week Plan after a schedule change. */
export interface WeekPlanChangeInput {
  iid: number;
  weekPlan: WeekPlanInput;
  changeDate: string;
  originalPlan: string;
  reason: string;
  impact: string;
  nextStep: string;
  owner: string;
}

/** A validated plan, including engine-derived ISO-week coverage. */
export interface WeekPlan extends WeekPlanInput {
  coverage: string;
}

export type WeekPlanValidation =
  | { ok: true; errors: []; plan: WeekPlan }
  | { ok: false; errors: string[]; plan?: undefined };

/** The newest `## 周排期` block controls the outcome, even when malformed. */
export type LatestWeekPlan =
  | { kind: 'absent' }
  | { kind: 'valid-enabled'; plan: WeekPlan }
  | { kind: 'valid-paused'; plan: WeekPlan }
  | { kind: 'invalid-latest'; errors: string[]; input: Partial<WeekPlanInput> & { coverage?: string } };

export type RunMode = 'semi-auto' | 'full-auto';

export interface MissingItem {
  field: string;
  hint: string;
}

/** 一条副作用步骤：引擎声明，Leader 执行（代码侧调 sub-skill，Issue 写回调 glab）。 */
export interface PlaybookStep {
  action: string;
  subskill?: string;
  when?: string;
  desc: string;
  /** 是否 Issue 写回（官方状态变更，恒为末步）。 */
  isWriteback: boolean;
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
  /** Structured schedule supplied when approving a Story. */
  weekPlan?: WeekPlanInput;
  gateOutcome?: '通过' | '退回';
  reviewType?: string;
  assigneeUser?: string;
  datesConfirmed?: boolean;
  humanConfirmed?: boolean;
  closeIssue?: boolean;
  runMode?: RunMode;
  config?: { roles?: Record<string, string>; deployBranch?: string; jenkins?: boolean };
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
  /** 合并评论正文(状态变更头 + 内容体, renderNodeComment 生成); dirty/无转换时为 undefined。 */
  comment?: string;
  plan?: WritePlan;
  playbook: PlaybookStep[];
  /** 当前节点的内部子步骤 checklist（进度可见，层 2）。 */
  nodeProgress: string[];
  preview: string;
  shouldConfirm: boolean;
  applied: false;
}

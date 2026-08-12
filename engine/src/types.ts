export type IssueType = 'story' | 'bug';
export type Role = '产品' | '研发' | '测试';

export type ArtifactKind = 'proposal' | 'design' | 'data-evidence' | 'deployment-evidence' | 'test-plan' | 'mr-review' | 'release-plan';
export type DataEvidenceProfile = 'standard' | 'data-backed';
export type ArtifactTarget = { kind: 'issue'; projectId: string; iid: number } | { kind: 'mr'; projectPath: string; iid: number };
export type ArtifactRequirement = { kind: ArtifactKind; target: 'issue' | 'each-mr'; when?: 'data-backed' | 'jenkins' };
/** Leader-calculated source and SHA-256 of each current local artifact. */
export type ArtifactManifest = Partial<Record<ArtifactKind, { source: string; sha256: string }>>;

export interface ReceiptNote {
  id: string;
  body: string;
  observedAt: string;
  url?: string;
}

export interface AutomationDeploymentEvidenceMetadata {
  mode: 'automation';
  capability: string;
  job: string;
  branch: string;
  environment: string;
  build: string;
  version: string;
  verification: string;
}

export interface ManualDeploymentEvidenceMetadata {
  mode: 'manual';
  unavailableReason: string;
  operator: string;
  deployedVersion: string;
  environment: string;
  verification: string;
  performedAt: string;
}

export interface MrReviewEvidenceMetadata {
  outcome: 'passed';
  method: 'mr-review-lite' | 'code-review';
  highFindings: 'none';
}

export type ArtifactReceiptMetadata = AutomationDeploymentEvidenceMetadata | ManualDeploymentEvidenceMetadata | MrReviewEvidenceMetadata;

export interface ArtifactReceipt {
  kind: ArtifactKind;
  target: ArtifactTarget;
  source: string;
  sha256: string;
  noteId: string;
  noteUrl?: string;
  observedAt: string;
  metadata?: ArtifactReceiptMetadata;
}

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
  requiredArtifacts?: ArtifactRequirement[];
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
  gateOutcome?: '通过' | '退回';
  reviewType?: string;
  assigneeUser?: string;
  datesConfirmed?: boolean;
  humanConfirmed?: boolean;
  closeIssue?: boolean;
  runMode?: RunMode;
  config?: { roles?: Record<string, string>; deployBranch?: string; jenkins?: boolean };
  artifactContext?: {
    /** Parent Issue 的项目身份；缺失时 Issue 回执不可作为可验证证据。 */
    projectId?: string;
    dataEvidenceProfile?: DataEvidenceProfile;
    /** Expected current local artifacts; every active requirement needs an entry. */
    artifactManifest?: ArtifactManifest;
    issueNotes?: ReceiptNote[];
    mergeRequests?: Array<{ projectPath: string; iid: number; notes: ReceiptNote[] }>;
  };
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
  verifiedReceipts: ArtifactReceipt[];
  plan?: WritePlan;
  playbook: PlaybookStep[];
  /** 当前节点的内部子步骤 checklist（进度可见，层 2）。 */
  nodeProgress: string[];
  preview: string;
  shouldConfirm: boolean;
  applied: false;
}

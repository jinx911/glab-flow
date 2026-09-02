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
  /** 跨节点副作用步骤（仅声明，Leader 执行）：commit/merge/deploy 等；Issue 写回后可追加 post-readback 同步。 */
  playbook?: { action: string; when?: string }[];
}

export interface StateMachine {
  story: { states: string[]; transitions: Transition[] };
  bug: { states: string[]; transitions: Transition[] };
  reviews: Record<string, string>;
  roleFields: Record<Role, string[]>;
  progressSteps?: Record<string, string[]>;
  /** 维度 → 门禁推导矩阵（spec §3.2，P3）；GateSet 由声明的受影响维度确定性推导。 */
  gateMatrix?: GateMatrix;
}

export interface Payload {
  type: IssueType;
  from: string;
  to: string;
  fields: Record<string, string>;
  /** Current contents of the Issue-scoped, versioned test-plan.md. */
  testPlan?: string;
  /** DU 本地事实（P2 起：TestRun/AssetAudit 证据优先取本地，不再要求 Issue 评论）。 */
  du?: DuState;
  /** Structured schedule input; rendering derives coverage only after validation. */
  weekPlan?: WeekPlanInput;
  /** Evidence completed before a Story requirement review can be approved. */
  reviewEvidence?: RequirementsReviewEvidence;
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

/**
 * A GitLab Issue note read back by the Leader.  `created_at` and `id` are
 * optional for backwards-compatible CLI fixtures, but real API responses
 * should preserve them so the engine can select the newest receipt safely.
 */
export interface IssueNote {
  body: string;
  created_at?: string;
  id?: number | string;
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
  /**
   * A Leader-owned action that can run only after every Issue write has been
   * read back. It deliberately is not a WriteOp: the engine never performs
   * GitLab I/O and Milestone association must not be interleaved with state
   * metadata/comment writes.
   */
  postWriteback?: WeekMilestoneSyncIntent;
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

/** 变更闭环的来源；它决定建议回退节点，不会直接修改 Issue 状态。 */
export type ChangeSource = 'requirement' | 'technical-design' | 'implementation' | 'test';

/** 变化级别（spec §4.3）：由 scopes 推导，决定关闭证据深度——T3+ 才要求测试计划版本递增。 */
export type ChangeTier = 'T1' | 'T2' | 'T3' | 'T4';
/** 变更影响的业务维度；由引擎推导需要同步的产物与重测范围。frontend-copy（纯文案/展示微调）是最低风险档。 */
export type ChangeScope = 'frontend-copy' | 'functional' | 'api-contract' | 'data-model' | 'permission' | 'frontend-route' | 'schedule' | 'release';
export type ChangeArtifact =
  | 'proposal'
  | 'design'
  | 'test-plan'
  | 'apifox-assets'
  | 'implementation'
  | 'local-rerun'
  | 'test-rerun'
  | 'week-plan'
  | 'release-check';

/** 输入事实全部来自 Leader 回读/工作产物；引擎只据此推导闭环清单。 */
export interface ChangeImpactInput {
  iid: number;
  type: IssueType;
  currentNode: string;
  changeId: string;
  proposer: string;
  changeDate: string;
  source: ChangeSource;
  reason: string;
  scopes: ChangeScope[];
  /** 变更提出时的唯一测试计划；用于在 close 时校验版本递增。 */
  testPlan?: string;
}

export interface ChangeImpact {
  iid: number;
  changeId: string;
  source: ChangeSource;
  currentNode: string;
  scopes: ChangeScope[];
  requiredArtifacts: ChangeArtifact[];
  returnTarget?: string;
  previousPlanVersion?: string;
}

/** 关闭回执仅接受已回读的 open 影响单，不允许客户端自报 requiredArtifacts。 */
export interface ChangeCloseInput {
  iid: number;
  changeId: string;
  closer: string;
  closeDate: string;
  notes: IssueNote[];
  completed: Partial<Record<ChangeArtifact, string>>;
  /** 更新后的 test-plan.md；当 open 单要求 test-plan 时必填且版本必须前进。 */
  testPlan?: string;
  /**
   * 变化级别（spec §4.3 轻量关闭）的交叉核对字段：引擎以 open 回执里的 scopes
   * 重推导 tier 为准，传入值与推导不符时拒绝；未传则直接用推导值。
   */
  tier?: ChangeTier;
}

/** A validated plan, including engine-derived ISO-week coverage. */
export interface WeekPlan extends WeekPlanInput {
  coverage: string;
}

export type OcrStatus = 'verified' | 'no-text' | 'unreadable';

/** One image found in the Issue body or comments and inspected before review. */
export interface IssueImageReviewEvidence {
  source: string;
  ocrStatus: OcrStatus;
  /** OCR transcript; required when text was identified, never a credential store. */
  ocrText?: string;
  /** Visual meaning needed when OCR has no text or cannot capture layout. */
  visualSummary: string;
}

/** Code evidence that a user-facing location resolves to the intended implementation. */
export interface FrontendRouteReviewEvidence {
  requestedLocation: string;
  resolvedPath: string;
  routeFile: string;
  componentFiles: string[];
  /** Explicitly record device / tenant / feature-flag branches; `无额外分流` is valid. */
  branches: string[];
}

export interface GrillingDecision {
  question: string;
  recommendation: string;
  resolution: 'confirmed' | 'conditional-default';
}

/** Machine-checkable summary of image, route and requirement-decision review evidence. */
export interface RequirementsReviewEvidence {
  images: IssueImageReviewEvidence[];
  frontend: {
    applicable: boolean;
    routes: FrontendRouteReviewEvidence[];
  };
  grilling: {
    coverage: string[];
    decisions: GrillingDecision[];
    unresolved: string[];
  };
}

/** Deterministic instruction for the Leader to reconcile one Issue to its active Week Milestone. */
export interface WeekMilestoneSyncIntent {
  action: 'sync_week_milestone';
  trigger: 'review-approved' | 'bug-development-start' | 'week-plan-change';
  plan: WeekPlan;
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

/** 动作分层（spec §3.3）：L1 可逆/非生产自动执行；L2 业务判断批量确认；L3 不可逆恒人工。 */
export type ActionTier = 'L1' | 'L2' | 'L3';

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
  /** 执行时序：代码动作 → Issue 写回并回读 → 后置同步。 */
  phase: 'pre-writeback' | 'issue-writeback' | 'post-readback';
  /** 是否 Issue 写回（官方状态变更阶段）。 */
  isWriteback: boolean;
}

/** `transition` 命令输入：Leader 两次只读 glab 拿到的原料 + 已知字段。 */
export interface TransitionInput {
  type: IssueType;
  iid: number;
  labels: string[];
  body: string;
  notes: IssueNote[];
  state: 'opened' | 'closed';
  to?: string;
  fields?: Record<string, string>;
  /** Current contents of .glab-flow/<iid>/spec/test-plan.md, read by Leader. */
  testPlan?: string;
  /** DU 本地事实（P2 起：TestRun/AssetAudit 证据优先取本地，Issue 评论仅兜底）。 */
  du?: DuState;
  /** 技术方案声明的受影响维度；已评审→开发中 时用于推导 proposedGateSet（引擎不写 DU）。 */
  declaredScopes?: ChangeScope[];
  /** Structured schedule supplied when approving a Story. */
  weekPlan?: WeekPlanInput;
  /** Completed image/OCR, frontend-route and grilling evidence for Story review approval. */
  reviewEvidence?: RequirementsReviewEvidence;
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
  /** 动作分层（spec §3.3）：L1 自动 / L2 批量确认 / L3 硬门；dirty/无转换时为 undefined（无动作）。 */
  actionTier?: ActionTier;
  /** L2/L3 的批量确认标题；L1 为空串；dirty/无转换时为 undefined。 */
  confirmBatchTitle?: string;
  /** 已评审→开发中 且提供 declaredScopes 时推导的门禁单提案（供 Leader 批量确认过目，写入 du 由 Leader 落盘——引擎不写）。 */
  proposedGateSet?: GateSet;
  applied: false;
}

/** Environment names are configuration-owned; local/test are the current default gates. */
export type TestEnvironment = string;
export type TestMethod = 'api' | 'e2e' | 'data' | 'manual' | 'unit';
export type ApifoxAssetType = 'scenario' | 'suite-or-group' | 'test-data' | 'scenario-instance';
export type ApifoxAssetAction = 'reuse' | 'create' | 'update' | 'retire' | 'cleanup';

export interface TestPlanCase {
  id: string;
  environments: TestEnvironment[];
  methods: TestMethod[];
  assets: ApifoxAssetType[];
  /** Assets whose Apifox list/detail projection must be audited by a v2 receipt. */
  presentations: ApifoxAssetType[];
  /** Named, non-secret authentication profiles required by this test case. */
  authProfiles: string[];
}

/** Parsed machine manifest embedded in the human-readable test-plan.md. */
export interface TestPlan {
  version: string;
  cases: TestPlanCase[];
}

/** Parsed machine receipt embedded in an immutable Issue comment. */
export interface TestRun {
  environment: TestEnvironment;
  planVersion: string;
  version: string;
  outcome: 'passed' | 'failed';
  /** Must equal `${planVersion}/${environment}` for the matching latest asset audit. */
  assetAudit: string;
  cases: Record<string, 'passed'>;
  evidence: Partial<Record<TestMethod, string>>;
}

export type LatestTestRun =
  | { kind: 'absent' }
  | { kind: 'valid'; run: TestRun }
  | { kind: 'invalid-latest'; errors: string[] };

export type TestRunValidation =
  | { ok: true; errors: [] }
  | { ok: false; errors: string[] };

/** A resource inspected through Apifox CLI and tied to one planned test case. */
export interface ApifoxAssetRecord {
  caseId: string;
  type: ApifoxAssetType;
  id: string;
  action: ApifoxAssetAction;
}

/** One user-visible Apifox projection and its corresponding report environment. */
export interface ApifoxAssetPresentation {
  caseId: string;
  type: ApifoxAssetType;
  expectedEnvironment: string;
  displayedEnvironment: string;
  reportEnvironment: string;
}

/** Non-secret receipt that a case used the declared login contract and temporary token variable. */
export interface ApifoxAuthProfileReceipt {
  caseId: string;
  profile: string;
  tokenVariable: string;
}

/** Parsed immutable Issue comment proving that planned Apifox resources were audited. */
export interface ApifoxAssetAudit {
  /** v1 is accepted for historical plans; v2 carries presentation/authentication evidence. */
  markerVersion?: 'v1' | 'v2';
  environment: TestEnvironment;
  planVersion: string;
  project: string;
  branch: string;
  unresolvedFindings: number;
  evidence: string;
  assets: ApifoxAssetRecord[];
  presentations?: ApifoxAssetPresentation[];
  authProfiles?: ApifoxAuthProfileReceipt[];
}

export type LatestApifoxAssetAudit =
  | { kind: 'absent' }
  | { kind: 'valid'; audit: ApifoxAssetAudit }
  | { kind: 'invalid-latest'; errors: string[] };

export type ApifoxAssetAuditValidation =
  | { ok: true; errors: [] }
  | { ok: false; errors: string[] };

/** DU 本地执行事实（spec §3.1）：Issue 只留流转评论，明细归 DU。 */
export interface DuEvidenceEntry {
  kind: 'test-run' | 'asset-audit';
  environment: TestEnvironment;
  planVersion: string;
  outcome: string;
  recordedAt: string;
  /** 被测版本（test-run 必填；报告回读的运行版本或部署构建号）——环境混淆防线：local/test 各自记录真实版本。 */
  version?: string;
  /** 本地明细文件/报告指针（报告 ID、链接）。含环境注记时与 environment 双写核对。 */
  detailRef?: string;
}

/** DU 资源登记项（spec §3.4，P4 使用）：创建即登记，终态出清理清单。 */
export interface DuResourceEntry {
  id: string;
  kind: 'branch' | 'worktree' | 'apifox-scenario' | 'apifox-suite' | 'apifox-test-data' | 'apifox-scenario-instance' | 'auth-profile-ref' | 'test-data' | 'report' | 'deploy-version';
  scope: 'non-prod' | 'prod';
  lifecycle: 'temporary' | 'shared-candidate' | 'permanent';
  createdAt: string;
  detail?: string;
  disposedAt?: string;
  disposal?: 'deleted' | 'promoted-shared' | 'kept';
}

/** 资源登记校验问题（spec §3.4）：命名前缀/生产生命周期约束违例。 */
export interface ResourceCheckIssue {
  resourceId: string;
  issue: string;
}

/** DU 指标事件（spec §7，P6 使用）：Leader 记事件，引擎终态算汇总。 */
export interface DuMetricEvent {
  at: string;
  kind: 'confirm' | 'transition' | 'rerun' | 'env-block' | 'rework' | 'manual-intervention';
  detail?: string;
}

/** 交付工作包本地主档（spec §3.1）。 */
export interface DuState {
  iid: number;
  type: IssueType;
  /** DU 记录的最近节点（对账用，P5 reconcile）；Leader 每次流转成功后写回。 */
  cachedNode: string;
  /** 技术方案声明的受影响维度（GateSet 输入）。 */
  affectedScopes: ChangeScope[];
  /** 执行事实流水（append-only，引擎只算不写盘）。 */
  evidence: DuEvidenceEntry[];
  /** 资源登记表（P4 使用）。 */
  resources: DuResourceEntry[];
  /** 指标事件（P6 使用）。 */
  metricEvents: DuMetricEvent[];
  /** 维度推导出的门禁单（spec §3.2）；已评审→开发中 绑定并冻结（P3）。 */
  gateSet?: GateSet;
  updatedAt: string;
}

/** 维度推导出的门禁单（spec §3.2）；已评审→开发中 绑定并冻结。 */
export interface GateSet {
  scopes: ChangeScope[];
  skipStates: string[];
  environments: TestEnvironment[];
  mrReview: boolean;
  regression: 'affected-cases' | 'full';
  rollbackPlan: boolean;
  /** 该门禁单下 test-plan 至少须含的 unit 用例数（Q4，0=不要求）。 */
  minUnitCases: number;
  /** 显式改判记录（增/删门禁都留痕）。 */
  overrides: { field: string; from: string; to: string; by: string; at: string }[];
  frozenAt?: string;
}

export interface GateMatrixRule {
  scopes: string[];
  skipStates?: string[];
  environments?: string[];
  mrReview?: boolean;
  regression?: 'affected-cases' | 'full';
  rollbackPlan?: boolean;
  /** 该维度下 test-plan 至少须含的 unit 用例数（Q4：纯逻辑防线，0=不要求）。 */
  minUnitCases?: number;
}

export interface GateMatrix {
  defaults: Required<Pick<GateMatrixRule, 'environments' | 'mrReview' | 'regression' | 'rollbackPlan'>> & GateMatrixRule;
  rules: GateMatrixRule[];
}

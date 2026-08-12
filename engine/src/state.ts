import type { IssueType } from './types.js';
import type { ArtifactKind, ArtifactReceipt } from './types.js';
import type { RunMode } from './config.js';

export type DataEvidenceProfile = 'standard' | 'data-backed';
export type WritebackAuditTarget = 'issue' | `mr:${string}!${number}`;
export type WritebackAuditStage = 'artifact-comment' | 'metadata' | 'state-comment' | 'readback';
export type WritebackAuditStatus = 'succeeded' | 'failed';

export interface WritebackAuditEntry {
  target: WritebackAuditTarget;
  stage: WritebackAuditStage;
  status: WritebackAuditStatus;
  at: string;
  detail: string;
}

export type WritebackAuditInput = Omit<WritebackAuditEntry, 'at'>;

export type ProgressResult =
  | { ok: true; state: RunState }
  | {
    ok: false;
    state: RunState;
    error: { code: 'missing_artifact_receipt'; required: ArtifactKind; step: string };
  };

export interface RunState {
  iid: string;
  type: IssueType;
  project: { host: string; id: string };
  cachedNode: string;
  cachedNodeAt: string;
  docVersion: number;
  specDir: string;
  runMode: RunMode;
  lastActions: string[];
  spawnedAgents: string[];
  lessonsCaptured: number;
  /** 已由 Leader 从 GitLab 回读确认的产物回执缓存；GitLab 才是真理来源。 */
  artifactReceipts: ArtifactReceipt[];
  /** 草稿评审阶段由 Leader 明确选择的数据取证档案。 */
  dataEvidenceProfile?: DataEvidenceProfile;
  /** 串行写回阶段的本地审计尾迹，供 resume 重新对账后恢复。 */
  writebackAudit: WritebackAuditEntry[];
  /** 节点内子步骤进度（层 2）：node = 这批 done 所属节点；换节点时 reset。 */
  progress: { node: string; done: string[] };
  updatedAt: string;
}

export interface InitStateInput {
  iid: string;
  type: IssueType;
  host: string;
  projectId: string;
  workspaceRoot: string;
  runMode?: RunMode;
  now: string;
}

export function initState(input: InitStateInput): RunState {
  const runMode: RunMode = input.runMode ?? 'semi-auto';
  return {
    iid: input.iid,
    type: input.type,
    project: { host: input.host, id: input.projectId },
    cachedNode: '',
    cachedNodeAt: input.now,
    docVersion: 1,
    specDir: `${input.workspaceRoot}/.glab-flow/${input.iid}/spec`,
    runMode,
    lastActions: [],
    spawnedAgents: [],
    lessonsCaptured: 0,
    artifactReceipts: [],
    writebackAudit: [],
    progress: { node: '', done: [] },
    updatedAt: input.now,
  };
}

function targetKey(receipt: ArtifactReceipt): string {
  return receipt.target.kind === 'issue' ? 'issue' : `mr:${receipt.target.projectPath}!${receipt.target.iid}`;
}

function sameReceipt(left: ArtifactReceipt, right: ArtifactReceipt): boolean {
  return left.noteId === right.noteId && targetKey(left) === targetKey(right);
}

/** 仅缓存已由 Leader 回读并验证的回执；同一 GitLab note 重复回读不重复记账。 */
export function recordVerifiedReceipt(state: RunState, receipt: ArtifactReceipt, now: string): RunState {
  if (state.artifactReceipts.some((item) => sameReceipt(item, receipt))) return state;
  return {
    ...state,
    artifactReceipts: [...state.artifactReceipts, receipt],
    lastActions: [...state.lastActions, `verified receipt ${receipt.kind} on ${targetKey(receipt)} note ${receipt.noteId}`],
    updatedAt: now,
  };
}

/** 记录 Leader 对数据型需求做出的显式取证档案选择。 */
export function setDataEvidenceProfile(state: RunState, profile: DataEvidenceProfile, now: string): RunState {
  if (state.dataEvidenceProfile === profile) return state;
  return {
    ...state,
    dataEvidenceProfile: profile,
    lastActions: [...state.lastActions, `data evidence profile ${profile}`],
    updatedAt: now,
  };
}

/** 追加一个串行写回阶段的结果；同一审计事件重复输入时保持幂等。 */
export function recordWritebackAudit(state: RunState, audit: WritebackAuditInput, now: string): RunState {
  const entry: WritebackAuditEntry = { ...audit, at: now };
  if (state.writebackAudit.some((item) =>
    item.target === entry.target
    && item.stage === entry.stage
    && item.status === entry.status
    && item.detail === entry.detail
  )) return state;
  return {
    ...state,
    writebackAudit: [...state.writebackAudit, entry],
    lastActions: [...state.lastActions, `writeback ${entry.status} ${entry.target} ${entry.stage}: ${entry.detail}`],
    updatedAt: now,
  };
}

const PROGRESS_RECEIPTS: Readonly<Record<string, ArtifactKind>> = {
  六清楚草稿: 'proposal',
  '技术方案 design.md': 'design',
  测试计划: 'test-plan',
  发布计划就绪: 'release-plan',
  上线前确认: 'release-plan',
};

function hasIssueReceipt(receipts: ArtifactReceipt[], kind: ArtifactKind): boolean {
  return receipts.some((receipt) => receipt.kind === kind && receipt.target.kind === 'issue');
}

/** 标记当前节点的一个子步骤完成；受产物回执约束的步骤必须已由 GitLab Issue 回读确认。 */
export function markProgressDone(state: RunState, step: string, now: string, verifiedReceipts: ArtifactReceipt[] = []): ProgressResult {
  const requiredReceipt = PROGRESS_RECEIPTS[step];
  const receipts = [...state.artifactReceipts, ...verifiedReceipts];
  if (requiredReceipt && !hasIssueReceipt(receipts, requiredReceipt)) {
    return { ok: false, state, error: { code: 'missing_artifact_receipt', required: requiredReceipt, step } };
  }
  if (state.progress.done.includes(step)) return { ok: true, state };
  return {
    ok: true,
    state: { ...state, progress: { node: state.progress.node, done: [...state.progress.done, step] }, updatedAt: now },
  };
}

/** 切换节点时重置进度：仅当目标 node 与当前不同才清空 done（同节点保留进度）。 */
export function resetProgress(state: RunState, node: string, now: string): RunState {
  if (state.progress.node === node) return state;
  return { ...state, progress: { node, done: [] }, updatedAt: now };
}

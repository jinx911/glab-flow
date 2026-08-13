import type { IssueType } from './types.js';
import type { ArtifactKind, ArtifactReceipt, DataEvidenceProfile } from './types.js';
import type { RunMode } from './config.js';

export type { DataEvidenceProfile } from './types.js';
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

/**
 * Reads persisted state produced before receipt/audit support without mutating it.
 * State files are user-owned caches, so the normalizer deliberately accepts a
 * RunState-shaped value with absent newly-introduced optional fields.
 */
export function normalizeRunState(state: RunState): RunState {
  const artifactReceipts = Array.isArray(state.artifactReceipts) ? state.artifactReceipts : [];
  const writebackAudit = Array.isArray(state.writebackAudit) ? state.writebackAudit : [];
  if (artifactReceipts === state.artifactReceipts && writebackAudit === state.writebackAudit) return state;
  return { ...state, artifactReceipts, writebackAudit };
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
  return receipt.target.kind === 'issue'
    ? `issue:${receipt.target.projectId}#${receipt.target.iid}`
    : `mr:${receipt.target.projectPath}!${receipt.target.iid}`;
}

function sameReceipt(left: ArtifactReceipt, right: ArtifactReceipt): boolean {
  return left.noteId === right.noteId && targetKey(left) === targetKey(right);
}

/** 仅缓存已由 Leader 回读并验证的回执；同一 GitLab note 重复回读不重复记账。 */
export function recordVerifiedReceipt(state: RunState, receipt: ArtifactReceipt, now: string): RunState {
  const normalized = normalizeRunState(state);
  if (!isReceiptForState(normalized, receipt)) return normalized;
  if (normalized.artifactReceipts.some((item) => sameReceipt(item, receipt))) return normalized;
  return {
    ...normalized,
    artifactReceipts: [...normalized.artifactReceipts, receipt],
    lastActions: [...normalized.lastActions, `verified receipt ${receipt.kind} on ${targetKey(receipt)} note ${receipt.noteId}`],
    updatedAt: now,
  };
}

/** 记录 Leader 对数据型需求做出的显式取证档案选择。 */
export function setDataEvidenceProfile(state: RunState, profile: DataEvidenceProfile, now: string): RunState {
  const normalized = normalizeRunState(state);
  if (normalized.dataEvidenceProfile === profile) return normalized;
  return {
    ...normalized,
    dataEvidenceProfile: profile,
    lastActions: [...normalized.lastActions, `data evidence profile ${profile}`],
    updatedAt: now,
  };
}

/** 追加一个串行写回阶段的结果；同一审计事件重复输入时保持幂等。 */
export function recordWritebackAudit(state: RunState, audit: WritebackAuditInput, now: string): RunState {
  const normalized = normalizeRunState(state);
  const entry: WritebackAuditEntry = { ...audit, at: now };
  if (normalized.writebackAudit.some((item) =>
    item.target === entry.target
    && item.stage === entry.stage
    && item.status === entry.status
    && item.detail === entry.detail
  )) return normalized;
  return {
    ...normalized,
    writebackAudit: [...normalized.writebackAudit, entry],
    lastActions: [...normalized.lastActions, `writeback ${entry.status} ${entry.target} ${entry.stage}: ${entry.detail}`],
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

function isReceiptForState(state: RunState, receipt: ArtifactReceipt): boolean {
  return receipt.target.kind !== 'issue'
    || (receipt.target.projectId === state.project.id && receipt.target.iid === Number(state.iid));
}

function hasIssueReceipt(state: RunState, receipts: ArtifactReceipt[], kind: ArtifactKind): boolean {
  return receipts.some((receipt) => receipt.kind === kind && receipt.target.kind === 'issue' && isReceiptForState(state, receipt));
}

/** Legacy direct API: marks a progress item without receipt validation. */
export function markProgressDone(state: RunState, step: string, now: string): RunState {
  const normalized = normalizeRunState(state);
  if (normalized.progress.done.includes(step)) return normalized;
  return {
    ...normalized,
    progress: { node: normalized.progress.node, done: [...normalized.progress.done, step] },
    updatedAt: now,
  };
}

/** Receipt-aware progress API used by the CLI before a governed step is marked complete. */
export function tryMarkProgressDone(state: RunState, step: string, now: string, verifiedReceipts: ArtifactReceipt[] = []): ProgressResult {
  const normalized = normalizeRunState(state);
  const requiredReceipt = PROGRESS_RECEIPTS[step];
  const receipts = [...normalized.artifactReceipts, ...verifiedReceipts];
  if (requiredReceipt && !hasIssueReceipt(normalized, receipts, requiredReceipt)) {
    return { ok: false, state: normalized, error: { code: 'missing_artifact_receipt', required: requiredReceipt, step } };
  }
  return { ok: true, state: markProgressDone(normalized, step, now) };
}

/** 切换节点时重置进度：仅当目标 node 与当前不同才清空 done（同节点保留进度）。 */
export function resetProgress(state: RunState, node: string, now: string): RunState {
  const normalized = normalizeRunState(state);
  if (normalized.progress.node === node) return normalized;
  return { ...normalized, progress: { node, done: [] }, updatedAt: now };
}

/** 动作审计尾迹上限——长 flow 下避免 lastActions 无限膨胀。 */
export const MAX_LAST_ACTIONS = 20;

/** 追加一条动作审计（FIFO 尾迹，限长 MAX_LAST_ACTIONS，近邻去重）。不可变。 */
export function addLastAction(state: RunState, action: string, now: string): RunState {
  const trimmed = action.trim();
  if (!trimmed) return state;
  const prev = state.lastActions;
  const last = prev[prev.length - 1];
  // 近邻去重：与上一条相同则先去掉再追加，保持「最新一次」语义
  const base = last === trimmed ? prev.slice(0, -1) : prev;
  const next = [...base, trimmed];
  if (next.length > MAX_LAST_ACTIONS) next.splice(0, next.length - MAX_LAST_ACTIONS);
  return { ...state, lastActions: next, updatedAt: now };
}

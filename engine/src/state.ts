import type { IssueType, RunMode, RunModeSelection } from './types.js';

export type WritebackAuditTarget = 'issue' | `mr:${string}!${number}`;
export type WritebackAuditStage = 'metadata' | 'state-comment' | 'readback' | 'week-milestone-sync';
export type WritebackAuditStatus = 'succeeded' | 'failed';

export interface WritebackAuditEntry {
  target: WritebackAuditTarget;
  stage: WritebackAuditStage;
  status: WritebackAuditStatus;
  at: string;
  detail: string;
}

export type WritebackAuditInput = Omit<WritebackAuditEntry, 'at'>;

export interface RunState {
  iid: string;
  type: IssueType;
  project: { host: string; id: string };
  cachedNode: string;
  cachedNodeAt: string;
  docVersion: number;
  specDir: string;
  runMode: RunMode;
  runModeSelection?: RunModeSelection;
  lastActions: string[];
  spawnedAgents: string[];
  lessonsCaptured: number;
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
 * Reads persisted state produced before audit support without mutating it. State files are
 * user-owned caches, so the normalizer accepts a RunState-shaped value with absent optional fields.
 */
export function normalizeRunState(state: RunState): RunState {
  const writebackAudit = Array.isArray(state.writebackAudit) ? state.writebackAudit : [];
  if (writebackAudit === state.writebackAudit) return state;
  return { ...state, writebackAudit };
}

/** The Issue-level selection takes precedence over the legacy config/state mode. */
export function effectiveRunMode(state: RunState): RunMode {
  return state.runModeSelection?.mode ?? state.runMode;
}

/** Persist the first Issue-level mode choice and reject any later re-selection. */
export function selectRunMode(state: RunState, selection: RunModeSelection): RunState {
  const normalized = normalizeRunState(state);
  const existing = normalized.runModeSelection;
  if (!existing) return { ...normalized, runModeSelection: selection };
  if (existing.mode === selection.mode && existing.selectedAt === selection.selectedAt && existing.selectedBy === selection.selectedBy) {
    return normalized;
  }
  throw new Error('runModeSelection is immutable');
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
    writebackAudit: [],
    progress: { node: '', done: [] },
    updatedAt: input.now,
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
    lastActions: clampLastActions(normalized.lastActions, `writeback ${entry.status} ${entry.target} ${entry.stage}: ${entry.detail}`),
    updatedAt: now,
  };
}

/** 标记当前节点的一个子步骤完成（幂等，不可变）。 */
export function markProgressDone(state: RunState, step: string, now: string): RunState {
  const normalized = normalizeRunState(state);
  if (normalized.progress.done.includes(step)) return normalized;
  return {
    ...normalized,
    progress: { node: normalized.progress.node, done: [...normalized.progress.done, step] },
    updatedAt: now,
  };
}

/** 切换节点时重置进度：仅当目标 node 与当前不同才清空 done（同节点保留进度）。 */
export function resetProgress(state: RunState, node: string, now: string): RunState {
  const normalized = normalizeRunState(state);
  if (normalized.progress.node === node) return normalized;
  return { ...normalized, progress: { node, done: [] }, updatedAt: now };
}

/** 动作审计尾迹上限——长 flow 下避免 lastActions 无限膨胀。 */
export const MAX_LAST_ACTIONS = 20;

/** FIFO 尾迹限长(MAX_LAST_ACTIONS)+ 近邻去重;纯函数,无追加时返回原数组引用。
 *  addLastAction 与 recordWritebackAudit 写入路径共用,保证 lastActions 限长贯穿。 */
export function clampLastActions(prev: string[], action: string): string[] {
  const trimmed = action.trim();
  if (!trimmed) return prev;
  const last = prev[prev.length - 1];
  // 近邻去重：与上一条相同则先去掉再追加，保持「最新一次」语义
  const base = last === trimmed ? prev.slice(0, -1) : prev;
  const next = [...base, trimmed];
  return next.length > MAX_LAST_ACTIONS ? next.slice(next.length - MAX_LAST_ACTIONS) : next;
}

/** 追加一条动作审计（经 clampLastActions 限长）。不可变。 */
export function addLastAction(state: RunState, action: string, now: string): RunState {
  const next = clampLastActions(state.lastActions, action);
  if (next === state.lastActions) return state;
  return { ...state, lastActions: next, updatedAt: now };
}

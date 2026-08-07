import type { IssueType } from './types.js';
import type { RunMode } from './config.js';

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
    progress: { node: '', done: [] },
    updatedAt: input.now,
  };
}

/** 标记当前节点的一个子步骤完成（幂等，不可变）。 */
export function markProgressDone(state: RunState, step: string, now: string): RunState {
  if (state.progress.done.includes(step)) return state;
  return { ...state, progress: { node: state.progress.node, done: [...state.progress.done, step] }, updatedAt: now };
}

/** 切换节点时重置进度：仅当目标 node 与当前不同才清空 done（同节点保留进度）。 */
export function resetProgress(state: RunState, node: string, now: string): RunState {
  if (state.progress.node === node) return state;
  return { ...state, progress: { node, done: [] }, updatedAt: now };
}

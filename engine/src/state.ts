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
    updatedAt: input.now,
  };
}

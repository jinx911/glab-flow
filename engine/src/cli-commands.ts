import { markProgressDone, normalizeRunState, recordWritebackAudit, resetProgress, selectRunMode } from './state.js';
import type { RunState, WritebackAuditInput } from './state.js';
import type { RunMode, RunModeSelection } from './types.js';

export interface ProgressCommandInput {
  state: RunState;
  step?: string;
  resetToNode?: string;
  now: string;
}

/** progress 命令:resetToNode 重置节点进度,或标记一个子步骤 done(幂等、不可变)。 */
export function progressCommand(input: ProgressCommandInput): RunState {
  let state = normalizeRunState(input.state);
  if (input.resetToNode !== undefined) state = resetProgress(state, input.resetToNode, input.now);
  if (!input.step) return state;
  return markProgressDone(state, input.step, input.now);
}

export function stateWritebackCommand(input: { state: RunState; audit: WritebackAuditInput; now: string }): RunState {
  return recordWritebackAudit(input.state, input.audit, input.now);
}

export interface RunModeSelectCommandInput {
  state: RunState;
  mode: RunMode;
  selectedBy: string;
  now: string;
}

export function runModeSelectCommand(input: RunModeSelectCommandInput): RunState {
  if (input.mode !== 'semi-auto' && input.mode !== 'full-auto') {
    throw new Error('run-mode-select: mode must be semi-auto or full-auto');
  }
  if (typeof input.selectedBy !== 'string' || !input.selectedBy.trim()) {
    throw new Error('run-mode-select: selectedBy must not be empty');
  }
  if (typeof input.now !== 'string' || !input.now.trim()) {
    throw new Error('run-mode-select: now must not be empty');
  }
  const selection: RunModeSelection = {
    mode: input.mode,
    selectedAt: input.now.trim(),
    selectedBy: input.selectedBy.trim(),
  };
  return selectRunMode(input.state, selection);
}

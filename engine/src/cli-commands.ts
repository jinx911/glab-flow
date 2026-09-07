import { markProgressDone, normalizeRunState, recordWritebackAudit, resetProgress } from './state.js';
import type { RunState, WritebackAuditInput } from './state.js';

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

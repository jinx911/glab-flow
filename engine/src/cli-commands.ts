import { markProgressDone, recordVerifiedReceipt, recordWritebackAudit, resetProgress } from './state.js';
import type { ProgressResult, RunState, WritebackAuditInput } from './state.js';
import type { ArtifactReceipt } from './types.js';

export interface ProgressCommandInput {
  state: RunState;
  step?: string;
  resetToNode?: string;
  verifiedReceipts?: ArtifactReceipt[];
  now: string;
}

export type ProgressCommandOutput = RunState | Extract<ProgressResult, { ok: false }>;

/** Keep successful `progress` CLI output backward compatible: only error responses are wrapped. */
export function progressCommand(input: ProgressCommandInput): ProgressCommandOutput {
  let state = input.state;
  if (input.resetToNode !== undefined) state = resetProgress(state, input.resetToNode, input.now);
  if (!input.step) return state;

  const result = markProgressDone(state, input.step, input.now, input.verifiedReceipts);
  return result.ok ? result.state : result;
}

export function stateReceiptCommand(input: { state: RunState; receipt: ArtifactReceipt; now: string }): RunState {
  return recordVerifiedReceipt(input.state, input.receipt, input.now);
}

export function stateWritebackCommand(input: { state: RunState; audit: WritebackAuditInput; now: string }): RunState {
  return recordWritebackAudit(input.state, input.audit, input.now);
}

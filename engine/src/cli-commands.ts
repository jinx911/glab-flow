import { normalizeRunState, recordVerifiedReceipt, recordWritebackAudit, resetProgress, setDataEvidenceProfile, tryMarkProgressDone } from './state.js';
import type { DataEvidenceProfile, ProgressResult, RunState, WritebackAuditInput } from './state.js';
import type { ArtifactKind, ArtifactReceipt } from './types.js';

export interface ProgressCommandInput {
  state: RunState;
  step?: string;
  resetToNode?: string;
  verifiedReceipts?: ArtifactReceipt[];
  /** 子步骤→receipt kind 映射(来自 state-machine.yaml,经 cli 传入);缺失则不校验回执。 */
  progressReceipts?: Record<string, ArtifactKind>;
  now: string;
}

export type ProgressCommandOutput = RunState | Extract<ProgressResult, { ok: false }>;

/** Keep successful `progress` CLI output backward compatible: only error responses are wrapped. */
export function progressCommand(input: ProgressCommandInput): ProgressCommandOutput {
  let state = normalizeRunState(input.state);
  if (input.resetToNode !== undefined) state = resetProgress(state, input.resetToNode, input.now);
  if (!input.step) return state;

  const result = tryMarkProgressDone(state, input.step, input.now, input.verifiedReceipts ?? [], input.progressReceipts ?? {});
  return result.ok ? result.state : result;
}

export function stateReceiptCommand(input: { state: RunState; receipt: ArtifactReceipt; now: string }): RunState {
  return recordVerifiedReceipt(input.state, input.receipt, input.now);
}

/** Persist Leader's explicit selection made before entering review. */
export function stateDataEvidenceProfileCommand(input: { state: RunState; profile: DataEvidenceProfile; now: string }): RunState {
  return setDataEvidenceProfile(input.state, input.profile, input.now);
}

export function stateWritebackCommand(input: { state: RunState; audit: WritebackAuditInput; now: string }): RunState {
  return recordWritebackAudit(input.state, input.audit, input.now);
}

import type { AutomationDecision, AutomationEvent } from './types.js';

function validateAttempt(attempt: number): void {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error(`automation attempt must be a non-negative integer; received ${String(attempt)}`);
  }
}

/** Purely maps an observed automation event to the next deterministic action. */
export function decideAutomation(event: AutomationEvent, attempt: number): AutomationDecision {
  validateAttempt(attempt);

  if (!event || typeof event !== 'object' || typeof (event as { kind?: unknown }).kind !== 'string') {
    throw new Error('automation event must be an object with a known kind');
  }

  switch (event.kind) {
    case 'completed':
      return { action: 'continue', reason: 'Automation completed successfully.' };
    case 'missing_evidence':
      if (event.autoRecoverable) {
        return { action: 'repair', reason: `Repair missing evidence: ${event.detail}` };
      }
      return {
        action: 'pause',
        code: 'missing_human_evidence',
        reason: `Missing human evidence: ${event.detail}`,
        requiredInput: 'Provide or confirm the missing human evidence, then resume.',
      };
    case 'transient_failure':
      if (attempt === 0) {
        return { action: 'retry', remainingRetries: 0, reason: `Transient failure (retrying once): ${event.detail}` };
      }
      return {
        action: 'pause',
        code: 'transient_failure_exhausted',
        reason: `Transient failure retries exhausted: ${event.detail}`,
        requiredInput: 'Investigate the transient failure and provide a recovery instruction before resuming.',
      };
    case 'test_failed':
      return {
        action: 'pause',
        code: 'test_failed',
        reason: `Tests failed: ${event.detail}`,
        requiredInput: 'Provide a fix or an approved test-failure disposition, then rerun the tests.',
      };
    case 'git_conflict':
      return {
        action: 'pause',
        code: 'git_conflict',
        reason: `Git conflict: ${event.detail}`,
        requiredInput: 'Resolve the Git conflict and provide the resulting commit or branch state.',
      };
    case 'material_change':
      return {
        action: 'pause',
        code: 'material_change',
        reason: `Material change detected: ${event.detail}`,
        requiredInput: 'Review and approve the material change, or provide an updated plan.',
      };
    case 'permission_denied':
      return {
        action: 'pause',
        code: 'permission_denied',
        reason: `Permission denied: ${event.detail}`,
        requiredInput: 'Grant the required permission or provide an authorized alternative.',
      };
    case 'hard_gate':
      return {
        action: 'pause',
        code: 'hard_gate',
        reason: `Hard gate blocked progress: ${event.detail}`,
        requiredInput: 'Satisfy the hard gate and provide the required approval or evidence.',
      };
    default:
      throw new Error(`automation event kind is unknown: ${String((event as { kind?: unknown }).kind)}`);
  }
}

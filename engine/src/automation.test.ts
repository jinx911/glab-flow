import { describe, expect, it } from 'vitest';
import { decideAutomation } from './automation.js';

describe('decideAutomation', () => {
  it('continues after completion', () => {
    expect(decideAutomation({ kind: 'completed' }, 0)).toEqual({ action: 'continue', reason: expect.any(String) });
  });

  it('repairs auto-recoverable missing evidence', () => {
    expect(decideAutomation({ kind: 'missing_evidence', detail: 'receipt absent', autoRecoverable: true }, 3))
      .toEqual({ action: 'repair', reason: expect.stringContaining('receipt absent') });
  });

  it('retries a transient failure only at attempt zero with no retries remaining', () => {
    expect(decideAutomation({ kind: 'transient_failure', detail: 'network reset' }, 0)).toEqual({
      action: 'retry', remainingRetries: 0, reason: expect.stringContaining('network reset'),
    });
  });

  it('pauses transient failures after the retry boundary', () => {
    expect(decideAutomation({ kind: 'transient_failure', detail: 'network reset' }, 1)).toMatchObject({
      action: 'pause', code: 'transient_failure_exhausted', reason: expect.stringContaining('network reset'), requiredInput: expect.any(String),
    });
  });

  it.each([
    [{ kind: 'test_failed', detail: 'TP-1 failed' }, 'test_failed'],
    [{ kind: 'git_conflict', detail: 'main diverged' }, 'git_conflict'],
    [{ kind: 'missing_evidence', detail: 'approval absent', autoRecoverable: false }, 'missing_human_evidence'],
    [{ kind: 'material_change', detail: 'API changed' }, 'material_change'],
    [{ kind: 'permission_denied', detail: 'protected branch' }, 'permission_denied'],
    [{ kind: 'hard_gate', detail: 'release approval' }, 'hard_gate'],
  ] as const)('pauses %j with stable code and actionable input', (event, code) => {
    const decision = decideAutomation(event, 0);
    expect(decision).toMatchObject({ action: 'pause', code, reason: expect.stringContaining(event.detail), requiredInput: expect.any(String) });
    expect((decision as { requiredInput: string }).requiredInput.length).toBeGreaterThan(10);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid attempt %s', (attempt) => {
    expect(() => decideAutomation({ kind: 'completed' }, attempt)).toThrow(/non-negative integer/);
  });

  it('rejects unknown runtime event kinds', () => {
    expect(() => decideAutomation({ kind: 'unknown' } as never, 0)).toThrow(/unknown/);
  });
});

import { describe, expect, it } from 'vitest';
import { initDu, recordEvidence, latestEvidence } from './du.js';

const base = { iid: 88, type: 'story' as const, now: '2026-09-01T00:00:00Z' };

describe('du evidence', () => {
  it('appends evidence immutably', () => {
    const du = initDu(base);
    const next = recordEvidence(du, { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: base.now }, base.now);
    expect(du.evidence).toHaveLength(0);
    expect(next.evidence).toHaveLength(1);
  });
  it('is idempotent for identical entry', () => {
    const du = recordEvidence(initDu(base), { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: base.now }, base.now);
    expect(recordEvidence(du, { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: base.now }, base.now).evidence).toHaveLength(1);
  });
  it('latestEvidence returns newest matching entry', () => {
    let du = initDu(base);
    du = recordEvidence(du, { kind: 'asset-audit', environment: 'test', planVersion: 'v1', outcome: 'v2-audit', recordedAt: '2026-09-01T01:00:00Z' }, base.now);
    du = recordEvidence(du, { kind: 'asset-audit', environment: 'test', planVersion: 'v2', outcome: 'v2-audit', recordedAt: '2026-09-01T02:00:00Z' }, base.now);
    expect(latestEvidence(du, 'asset-audit', 'test')?.planVersion).toBe('v2');
    expect(latestEvidence(du, 'asset-audit', 'local')).toBeUndefined();
  });
});

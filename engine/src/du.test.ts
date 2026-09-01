import { describe, expect, it } from 'vitest';
import { initDu, recordEvidence, latestEvidence, bindGateSet, setCachedNode } from './du.js';
import { loadModel } from './model.js';

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
  it('keeps both entries sharing a timestamp with different outcomes, latest by append order', () => {
    // 同刻不同 outcome：幂等键含 outcome，同刻不同结论是两条事实，共存；latest 取追加序最后一条
    // （「按时间序追加」是调用方契约，引擎不读时钟不排序）。
    let du = initDu(base);
    du = recordEvidence(du, { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'failed', recordedAt: base.now }, base.now);
    du = recordEvidence(du, { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: base.now }, base.now);
    expect(du.evidence).toHaveLength(2);
    expect(latestEvidence(du, 'test-run', 'local')?.outcome).toBe('passed');
  });
});

describe('bindGateSet / setCachedNode (du CLI 写入面)', () => {
  const matrix = loadModel().gateMatrix!;
  it('bindGateSet derives+freezes gateSet and seeds affectedScopes', () => {
    const du = initDu(base);
    const next = bindGateSet(du, matrix, ['api-contract', 'api-contract'], '2026-09-01T00:00:00Z');
    expect(next.gateSet?.frozenAt).toBe('2026-09-01T00:00:00Z');
    expect(next.gateSet?.mrReview).toBe(true);
    expect(next.affectedScopes).toEqual(['api-contract']); // 去重
    expect(du.gateSet).toBeUndefined(); // 不可变
  });
  it('bindGateSet refuses to rebind a frozen gateSet (防降级)', () => {
    const bound = bindGateSet(initDu(base), matrix, ['api-contract'], 'T0');
    const again = bindGateSet(bound, matrix, ['frontend-copy'], 'T1');
    expect(again).toBe(bound); // 已冻结返回原引用
    expect(again.gateSet?.scopes).toContain('api-contract');
  });
  it('setCachedNode updates immutably, same-node is identity', () => {
    const du = initDu(base);
    const next = setCachedNode(du, '开发中', 'T1');
    expect(next.cachedNode).toBe('开发中');
    expect(du.cachedNode).toBe('');
    expect(setCachedNode(next, '开发中', 'T2')).toBe(next);
  });
});

import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { deriveGateSet, ratchetGateSet, overrideGateSet, freezeGateSet } from './gate-set.js';

const matrix = loadModel().gateMatrix!;

describe('deriveGateSet', () => {
  it('frontend-copy skips 测试中 and disables MR review', () => {
    const gs = deriveGateSet(matrix, ['frontend-copy']);
    expect(gs.skipStates).toContain('测试中');
    expect(gs.mrReview).toBe(false);
    expect(gs.environments).toEqual(['local']);
    expect(gs.regression).toBe('affected-cases');
    expect(gs.rollbackPlan).toBe(false);
    expect(gs.overrides).toEqual([]);
    expect(gs.frozenAt).toBeUndefined();
  });
  it('data-model wins over frontend-copy (highest rank rule)', () => {
    const gs = deriveGateSet(matrix, ['frontend-copy', 'data-model']);
    expect(gs.skipStates).toEqual([]);
    expect(gs.mrReview).toBe(true);
    expect(gs.rollbackPlan).toBe(true);
    expect(gs.regression).toBe('full');
    expect(gs.environments).toEqual(['local', 'test']);
    // 排序去重：声明集按风险降序保留
    expect(gs.scopes).toEqual(['data-model', 'frontend-copy']);
  });
  it('unknown-only scopes fall back to defaults', () => {
    const gs = deriveGateSet(matrix, ['schedule']);
    expect(gs.environments).toEqual(['local', 'test']);
    expect(gs.mrReview).toBe(true);
    expect(gs.skipStates).toEqual([]);
    expect(gs.regression).toBe('full');
    expect(gs.rollbackPlan).toBe(false);
  });
  it('empty scopes fall back to defaults without throwing', () => {
    const gs = deriveGateSet(matrix, []);
    expect(gs.scopes).toEqual([]);
    expect(gs.mrReview).toBe(matrix.defaults.mrReview);
  });
  it('functional keeps both environments but disables MR review with affected-case regression', () => {
    const gs = deriveGateSet(matrix, ['functional']);
    expect(gs.environments).toEqual(['local', 'test']);
    expect(gs.mrReview).toBe(false);
    expect(gs.regression).toBe('affected-cases');
    expect(gs.skipStates).toEqual([]);
  });
  it('does not mutate the matrix arrays it borrows from (pure derivation)', () => {
    const before = JSON.stringify(matrix);
    deriveGateSet(matrix, ['frontend-copy', 'data-model']);
    expect(JSON.stringify(matrix)).toBe(before);
  });
});

describe('ratchet & override', () => {
  it('never drops requirements when scopes grow', () => {
    const base = freezeGateSet(deriveGateSet(matrix, ['frontend-copy']), 'T0');
    const up = ratchetGateSet(base, matrix, ['api-contract']);
    expect(up.mrReview).toBe(true);
    expect(up.skipStates).toEqual([]);
    expect(up.regression).toBe('full');
    expect(up.frozenAt).toBe('T0');
    expect(up.scopes).toContain('frontend-copy');
    expect(up.scopes).toContain('api-contract');
  });
  it('ratchet keeps override history and freeze stamp intact', () => {
    const frozen = freezeGateSet(overrideGateSet(deriveGateSet(matrix, ['frontend-copy']), 'mrReview', true, '@pm', 'T1'), 'T2');
    const up = ratchetGateSet(frozen, matrix, ['api-contract']);
    expect(up.overrides).toHaveLength(1);
    expect(up.overrides[0]).toMatchObject({ field: 'mrReview', from: 'false', to: 'true', by: '@pm' });
    expect(up.frozenAt).toBe('T2');
  });
  it('override leaves audit trail', () => {
    const gs = overrideGateSet(deriveGateSet(matrix, ['api-contract']), 'mrReview', false, '@pm', 'T1');
    expect(gs.mrReview).toBe(false);
    expect(gs.overrides).toHaveLength(1);
    expect(gs.overrides[0]).toMatchObject({ field: 'mrReview', from: 'true', to: 'false', by: '@pm', at: 'T1' });
  });
  it('override is immutable — the source GateSet is untouched', () => {
    const original = deriveGateSet(matrix, ['api-contract']);
    overrideGateSet(original, 'mrReview', false, '@pm', 'T1');
    expect(original.mrReview).toBe(true);
    expect(original.overrides).toEqual([]);
  });
  it('freezeGateSet is idempotent', () => {
    const once = freezeGateSet(deriveGateSet(matrix, ['frontend-copy']), 'T0');
    expect(freezeGateSet(once, 'T9').frozenAt).toBe('T0');
  });
});

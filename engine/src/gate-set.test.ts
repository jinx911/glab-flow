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
  it('uncovered high-rank scope never downgrades a covered one (I1: data-model + release)', () => {
    // release 不在 rules 里但 RANK=4：不得因参与 top 竞争把 data-model 挤回 defaults
    const gs = deriveGateSet(matrix, ['data-model', 'release']);
    expect(gs.rollbackPlan).toBe(true);
    expect(gs.regression).toBe('full');
    expect(gs.mrReview).toBe(true);
    // 排序里 release 仍在首位（声明集展示），只是不参与规则命中
    expect(gs.scopes[0]).toBe('release');
  });
  it('uncovered-only scope set falls back to defaults (schedule alone)', () => {
    expect(deriveGateSet(matrix, ['schedule', 'release']).skipStates).toEqual([]);
    expect(deriveGateSet(matrix, ['schedule', 'release']).mrReview).toBe(matrix.defaults.mrReview);
  });
  it('derivation is order-independent for tied ranks (I1 determinism)', () => {
    const a = deriveGateSet(matrix, ['frontend-copy', 'schedule']);
    const b = deriveGateSet(matrix, ['schedule', 'frontend-copy']);
    expect(a).toEqual(b);
    expect(a.scopes).toEqual(['frontend-copy', 'schedule']);
  });
  it('same-rank covered scopes resolve to one rule deterministically', () => {
    // data-model 与 permission 同档（3）同规则；frontend-route(2) 不在 rules → 命中 data-model 规则
    const gs = deriveGateSet(matrix, ['frontend-route', 'data-model']);
    expect(gs.rollbackPlan).toBe(true);
    expect(deriveGateSet(matrix, ['data-model', 'frontend-route'])).toEqual(gs);
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
  it('ratchet replays the last override per field so the ledger matches reality (I2)', () => {
    // functional 基线 mrReview:false → 显式升为 true → 棘轮扩维度后仍 true
    const base = deriveGateSet(matrix, ['functional']);
    expect(base.mrReview).toBe(false);
    const escalated = overrideGateSet(base, 'mrReview', true, '@pm', 'T1');
    const up = ratchetGateSet(escalated, matrix, ['functional']);
    expect(up.mrReview).toBe(true);
    expect(up.overrides).toHaveLength(1);
    expect(up.overrides[0]).toMatchObject({ field: 'mrReview', from: 'false', to: 'true', by: '@pm' });
    // 账本与实际值一致：末条 mrReview override 的 to 就是当前值
    expect(up.overrides.filter((o) => o.field === 'mrReview').at(-1)?.to).toBe(String(up.mrReview));
  });
  it('ratchet replays only the LAST override when a field was flipped twice', () => {
    const base = deriveGateSet(matrix, ['frontend-copy']);
    const flips = overrideGateSet(overrideGateSet(base, 'mrReview', true, '@pm', 'T1'), 'mrReview', false, '@dev', 'T2');
    const up = ratchetGateSet(flips, matrix, ['data-model']);
    expect(up.mrReview).toBe(false);
    expect(up.overrides).toHaveLength(2);
  });
  it('ratchet survives dimension growth that would otherwise re-derive a lower bar', () => {
    // 覆盖维度从 frontend-copy（skipStates=[测试中]）扩到 functional：显式 override 的
    // mrReview=true 保留，skipStates 按新推导（无 skip）
    const base = overrideGateSet(deriveGateSet(matrix, ['frontend-copy']), 'mrReview', true, '@pm', 'T1');
    const up = ratchetGateSet(base, matrix, ['functional']);
    expect(up.mrReview).toBe(true);
    expect(up.skipStates).toEqual([]);
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
  it('rejects mismatched override value types at compile time (I4)', () => {
    const gs = deriveGateSet(matrix, ['api-contract']);
    // @ts-expect-error mrReview 只收 boolean——字符串档位值是编译错误；expect-error 反向锚定：
    // 若某天泛型退化成联合宽类型，这行不再报错，unused-expect-error 会让 typecheck 失败。
    overrideGateSet(gs, 'mrReview', 'full', '@pm', 'T1');
    // 合法调用不受影响：boolean/档位各归其位
    expect(overrideGateSet(gs, 'mrReview', false, '@pm', 'T1').mrReview).toBe(false);
    expect(overrideGateSet(gs, 'regression', 'affected-cases', '@pm', 'T1').regression).toBe('affected-cases');
    expect(overrideGateSet(gs, 'rollbackPlan', true, '@pm', 'T1').rollbackPlan).toBe(true);
  });
});

describe('ratchet seed includes declaredScopes (du.affectedScopes)', () => {
  it('hand-built narrow gateSet still ratchets from declared scopes', () => {
    // 旧 DU：gateSet 手工构造缺维度，但 affectedScopes 已声明 data-model
    const narrow = deriveGateSet(matrix, ['frontend-copy']);
    const up = ratchetGateSet(narrow, matrix, ['functional'], ['data-model']);
    expect(up.rollbackPlan).toBe(true); // data-model 种子保住回滚门禁
    expect(up.scopes).toContain('data-model');
  });
});

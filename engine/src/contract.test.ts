import { describe, it, expect } from 'vitest';
import { loadModel } from './model.js';
import { assertModelContract, INVARIANTS } from './contract.js';
import type { StateMachine } from './types.js';

describe('contract', () => {
  it('state-machine.yaml satisfies the checked-in invariants', () => {
    const result = assertModelContract(loadModel(), INVARIANTS);
    expect(result.ok, result.reasons.join('\n')).toBe(true);
  });
});

describe('contract drift detection', () => {
  it('flags reviews drift', () => {
    const m = loadModel();
    const bad: StateMachine = { ...m, reviews: { ...m.reviews, '需求评审': 'WRONG' } };
    const r = assertModelContract(bad, INVARIANTS);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('reviews drift'))).toBe(true);
  });
  it('flags roleFields drift', () => {
    const m = loadModel();
    const bad: StateMachine = { ...m, roleFields: { ...m.roleFields, '研发': ['Wrong'] } };
    const r = assertModelContract(bad, INVARIANTS);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('roleFields drift'))).toBe(true);
  });
  it('flags progressReceipts referencing an undeclared sub-step (②)', () => {
    const m = loadModel();
    const bad: StateMachine = { ...m, progressReceipts: { ...(m.progressReceipts ?? {}), '不存在的子步骤': 'proposal' } };
    const r = assertModelContract(bad, INVARIANTS);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('progressReceipts 引用了未声明的子步骤'))).toBe(true);
  });
  it('accepts the checked-in progressReceipts as a subset of progressSteps', () => {
    const r = assertModelContract(loadModel(), INVARIANTS);
    expect(r.reasons.some((x) => x.includes('progressReceipts'))).toBe(false);
  });
});

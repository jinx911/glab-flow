import { describe, expect, it } from 'vitest';
import { classifyAction, shouldConfirmFor } from './action-policy.js';

describe('classifyAction', () => {
  it('classifies hardGate as L3 regardless of gate', () => {
    expect(classifyAction({ gate: '发布', hardGate: true }).tier).toBe('L3');
    expect(classifyAction({ gate: '产品验收', hardGate: true }).tier).toBe('L3');
  });
  it('classifies gated transition as L2', () => {
    expect(classifyAction({ gate: '需求评审', hardGate: false }).tier).toBe('L2');
  });
  it('classifies gateless transition as L1', () => {
    expect(classifyAction({ gate: null, hardGate: false }).tier).toBe('L1');
  });
});

describe('shouldConfirmFor', () => {
  it('auto-executes L1 when validation passes', () => {
    expect(shouldConfirmFor({ gate: null, hardGate: false }, true)).toBe(false);
  });
  it('confirms L1 when validation fails', () => {
    expect(shouldConfirmFor({ gate: null, hardGate: false }, false)).toBe(true);
  });
  it('always confirms L2 and L3 even when validation passes', () => {
    expect(shouldConfirmFor({ gate: '需求评审', hardGate: false }, true)).toBe(true);
    expect(shouldConfirmFor({ gate: '发布', hardGate: true }, true)).toBe(true);
  });
});

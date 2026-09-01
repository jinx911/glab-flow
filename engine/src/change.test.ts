import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { classifyChangeTier, planChange } from './change.js';
import type { ChangePlanInput } from './change.js';
import { initDu } from './du.js';
import { deriveGateSet, freezeGateSet } from './gate-set.js';
import type { ChangeScope, DuState } from './types.js';

const T = '2026-09-01T00:00:00Z';
const model = loadModel();

const duWithScopes = (scopes: ChangeScope[]): DuState => ({
  ...initDu({ iid: 88, type: 'story', now: T }),
  gateSet: freezeGateSet(deriveGateSet(model.gateMatrix!, scopes), T),
});

const baseInput = (scopes: ChangeScope[], du: DuState): ChangePlanInput => ({
  iid: 88,
  type: 'story',
  currentNode: '开发中',
  changeId: 'C-1',
  proposer: '@dev',
  changeDate: T,
  source: 'implementation',
  reason: 'r',
  scopes,
  du,
});

describe('classifyChangeTier', () => {
  it('takes the highest tier among scopes', () => {
    expect(classifyChangeTier(['frontend-copy', 'api-contract'])).toBe('T3');
    expect(classifyChangeTier(['data-model'])).toBe('T4');
    expect(classifyChangeTier(['frontend-copy'])).toBe('T1');
    expect(classifyChangeTier(['schedule'])).toBe('T1');
    expect(classifyChangeTier(['functional', 'frontend-route'])).toBe('T2');
    expect(classifyChangeTier(['release'])).toBe('T4');
  });
});

describe('planChange', () => {
  it('ratchets GateSet when scopes exceed frozen set', () => {
    const out = planChange(model, baseInput(['api-contract'], duWithScopes(['frontend-copy'])));
    expect(out.ok).toBe(true);
    expect(out.plan!.tier).toBe('T3');
    expect(out.plan!.expandedGateSet?.mrReview).toBe(true);
    expect(out.plan!.expandedGateSet?.regression).toBe('full');
    expect(out.plan!.closeRequiresPlanVersionBump).toBe(true);
  });

  it('no expandedGateSet when ratchet changes nothing', () => {
    const out = planChange(model, baseInput(['api-contract'], duWithScopes(['api-contract'])));
    expect(out.ok).toBe(true);
    expect(out.plan!.expandedGateSet).toBeUndefined();
    expect(out.plan!.impact.requiredArtifacts.length).toBeGreaterThan(0);
  });

  it('T1 copy change does not require plan version bump', () => {
    const out = planChange(model, baseInput(['frontend-copy'], duWithScopes(['frontend-copy'])));
    expect(out.ok).toBe(true);
    expect(out.plan!.tier).toBe('T1');
    expect(out.plan!.closeRequiresPlanVersionBump).toBe(false);
  });

  it('T2 scope does not require plan version bump', () => {
    const out = planChange(model, baseInput(['functional'], duWithScopes(['functional'])));
    expect(out.plan!.closeRequiresPlanVersionBump).toBe(false);
  });

  it('skips ratchet when DU has no frozen GateSet yet', () => {
    const out = planChange(model, baseInput(['api-contract'], initDu({ iid: 88, type: 'story', now: T })));
    expect(out.ok).toBe(true);
    expect(out.plan!.expandedGateSet).toBeUndefined();
  });

  it('rejects invalid input via existing validation', () => {
    const out = planChange(model, baseInput([], initDu({ iid: 88, type: 'story', now: T })));
    expect(out.ok).toBe(false);
    expect(out.missing).toContain('scopes');
  });
});

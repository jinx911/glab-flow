import { describe, it, expect } from 'vitest';
import { loadModel } from './model.js';
import { assertModelContract, INVARIANTS } from './contract.js';

describe('contract', () => {
  it('state-machine.yaml satisfies the checked-in invariants', () => {
    const result = assertModelContract(loadModel(), INVARIANTS);
    expect(result.ok, result.reasons.join('\n')).toBe(true);
  });
});

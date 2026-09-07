import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { buildReviewPack } from './review-pack.js';
import { initDu, recordEvidence, setCachedNode } from './du.js';
import { deriveGateSet, freezeGateSet } from './gate-set.js';

const T = '2026-09-01T00:00:00Z';
const body = '## 交付协同\n\n|角色|用户|\n|--|--|\n|产品|@pm|\n|研发|@dev|\n|测试|@qa|';
const base = { type: 'story' as const, iid: 88, labels: ['type::story', 'story-status::开发中'], state: 'opened' as const, notes: [], body };

describe('buildReviewPack', () => {
  it('assembles spec paths, evidence digest and instructions for a mid-flight story', () => {
    let du = initDu({ iid: 88, type: 'story', now: T });
    du = recordEvidence(du, { kind: 'test-run', environment: 'local', planVersion: 'v3', outcome: 'passed', recordedAt: T, detailRef: 'api=report:101' }, T);
    du = setCachedNode(du, '开发中', T);
    du = { ...du, gateSet: freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['api-contract']), T) };
    const result = buildReviewPack(loadModel(), { ...base, du });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.issue.node).toBe('开发中');
    expect(result.spec.proposal).toBe('.glab-flow/88/spec/proposal.md');
    expect(result.evidenceDigest.some((l) => l.includes('local：v3 / passed / api=report:101'))).toBe(true);
    expect(result.evidenceDigest.some((l) => l.includes('MR 评审要求'))).toBe(true);
    expect(result.instructions.join('\n')).toContain('跨栈激活');
    expect(result.instructions.join('\n')).toContain('CRITICAL');
    expect(result.pendingGates.length).toBeGreaterThan(0);
  });
  it('reports error for dirty labels', () => {
    const result = buildReviewPack(loadModel(), { ...base, labels: ['type::story'] });
    expect('error' in result).toBe(true);
  });
  it('reports error for terminal node', () => {
    const result = buildReviewPack(loadModel(), { ...base, labels: ['type::story', 'story-status::已完成'] });
    expect('error' in result).toBe(true);
  });
  it('works without DU (存量路径)：evidenceDigest 为空但包仍产出', () => {
    const result = buildReviewPack(loadModel(), base);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.evidenceDigest).toHaveLength(0);
    expect(result.spec.testPlan).toContain('test-plan.md');
  });
});

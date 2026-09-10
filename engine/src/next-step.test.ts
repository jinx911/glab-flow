import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { computeNextStep } from './next-step.js';
import { initDu } from './du.js';
import { deriveGateSet, freezeGateSet } from './gate-set.js';
import { disposeResource, registerResource } from './resource.js';

const body = '## 交付协同\n\n|角色|用户|\n|--|--|\n|产品|@pm|\n|研发|@dev|\n|测试|@qa|';
const base = { type: 'story' as const, iid: 88, labels: ['type::story', 'story-status::开发中'], state: 'opened' as const, notes: [], body };

describe('computeNextStep', () => {
  it('reports where/blocked/owed for a mid-flight story', () => {
    const out = computeNextStep(loadModel(), base);
    expect(out.where).toBe('开发中');
    expect(out.isTerminal).toBe(false);
    expect(out.blockedOn.length).toBeGreaterThan(0);
    expect(out.fastestPath[0]).toBe('测试中');
    expect(out.fastestPath).toContain('已完成');
    expect(out.owedBy.length).toBeGreaterThan(0);
    expect(out.summary).toContain('你在：开发中');
  });
  it('surfaces dirty labels as drift', () => {
    const out = computeNextStep(loadModel(), { ...base, labels: ['type::story'] });
    expect(out.drift).toBeDefined();
  });
  it('terminal node without du reports no pending cleanup', () => {
    const out = computeNextStep(loadModel(), { ...base, labels: ['type::story', 'story-status::已完成'] });
    expect(out.isTerminal).toBe(true);
    expect(out.summary).toContain('无待清理资源');
  });
  it('terminal node with du lists undisposed resources as cleanup todos', () => {
    const T = '2026-09-01T00:00:00Z';
    let du = { ...initDu({ iid: 88, type: 'story', now: T }), cachedNode: '已完成' };
    du = registerResource(du, { id: 'TMP-88-members', kind: 'test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    du = registerResource(du, { id: 'branch-f-88', kind: 'branch', scope: 'non-prod', lifecycle: 'permanent', createdAt: T }, T);
    du = disposeResource(du, 'branch-f-88', 'kept', T);
    const out = computeNextStep(loadModel(), { ...base, labels: ['type::story', 'story-status::已完成'], du });
    expect(out.isTerminal).toBe(true);
    expect(out.summary).toContain('资源清理待办 1 项');
    expect(out.summary).toContain('TMP-88-members');
    expect(out.summary).toContain('删除');
  });
  it('passes DU evidence through to the submit gate', () => {
    // DU-first（P2）在 next 命令同样生效：du 证据 + 无评论即可过 local 门禁。
    const du = {
      iid: 88, type: 'story' as const, cachedNode: '开发中', affectedScopes: [], updatedAt: '2026-09-01T00:00:00Z',
      evidence: [
        { kind: 'test-run' as const, environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: '2026-09-01T00:00:00Z' },
      ],
      resources: [], metricEvents: [],
    };
    const out = computeNextStep(loadModel(), {
      ...base,
      fields: { 代码评审结论: '通过', 提测日期: '2026-09-01', 研发Assignee: '@dev', 涉及项目与开发分支: 'oa-platform: feature/leave-settlement', 测试说明: 'A/B 配置已核对' },
      assigneeUser: '@qa', datesConfirmed: true,
      testPlan: '<!-- glab-flow:test-plan:v1\nplan-version: v1\ncase: TP-001 | local | api,e2e\n-->',
      du,
    });
    expect(out.where).toBe('开发中');
    expect(out.blockedOn).toHaveLength(0);
    expect(out.summary).toContain('可推进到「测试中」');
  });
});

describe('fastestPath 感知 GateSet.skipStates（与 transition 投影同口径）', () => {
  it('frontend-copy DU 在开发中：fastestPath 直推待发布，不含测试中', () => {
    const gs = freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['frontend-copy']), 'T0');
    const du = { ...initDu({ iid: 88, type: 'story', now: 'T0' }), cachedNode: '开发中', gateSet: gs };
    const out = computeNextStep(loadModel(), { ...base, du });
    expect(out.fastestPath).not.toContain('测试中');
    expect(out.fastestPath[0]).toBe('待发布');
    expect(out.fastestPath).toContain('已完成');
  });
  it('无 GateSet 的存量路径不变（含测试中）', () => {
    const out = computeNextStep(loadModel(), base);
    expect(out.fastestPath[0]).toBe('测试中');
  });
});

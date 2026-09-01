import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { computeNextStep } from './next-step.js';

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
  it('terminal node reports cleanup hint', () => {
    const out = computeNextStep(loadModel(), { ...base, labels: ['type::story', 'story-status::已完成'] });
    expect(out.isTerminal).toBe(true);
    expect(out.summary).toContain('资源清理');
  });
  it('passes DU evidence through to the submit gate', () => {
    // DU-first（P2）在 next 命令同样生效：du 证据 + 无评论即可过 local 门禁。
    const du = {
      iid: 88, type: 'story' as const, cachedNode: '开发中', affectedScopes: [], updatedAt: '2026-09-01T00:00:00Z',
      evidence: [
        { kind: 'asset-audit' as const, environment: 'local', planVersion: 'v1', outcome: '0', recordedAt: '2026-09-01T00:00:00Z', detailRef: 'list-get:https://apifox.example/local' },
        { kind: 'test-run' as const, environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: '2026-09-01T00:00:00Z' },
      ],
      resources: [], metricEvents: [],
    };
    const out = computeNextStep(loadModel(), {
      ...base,
      fields: { 代码评审结论: '通过', 提测日期: '2026-09-01', 研发Assignee: '@dev', 可测试版本或环境: 'service:abc123', 测试说明: 'A/B 配置已核对' },
      assigneeUser: '@qa', datesConfirmed: true,
      testPlan: '<!-- glab-flow:test-plan:v1\nplan-version: v1\ncase: TP-001 | local | api,e2e\nasset: TP-001 | scenario\n-->',
      du,
    });
    expect(out.where).toBe('开发中');
    expect(out.blockedOn).toHaveLength(0);
    expect(out.summary).toContain('可推进到「测试中」');
  });
});

import { describe, it, expect } from 'vitest';
import { buildForwardPlan, buildReturnPlan, buildWeekPlanChangePlan } from './plan.js';
import type { Payload } from './types.js';

describe('buildForwardPlan public comment boundary', () => {
  it('rejects internal execution material before producing a write plan', () => {
    const payload: Payload = {
      type: 'story', from: '开发中', to: '测试中', assigneeUser: '@qa',
      fields: { 可测试版本或环境: 'local build' },
    };
    expect(() => buildForwardPlan(payload, 123)).toThrow(/内部执行证据/);
  });
});

describe('buildWeekPlanChangePlan public comment boundary', () => {
  const input = {
    iid: 123, weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true },
    changeDate: '2026-08-28', originalPlan: 'W34 ～ W36', reason: '研发排期调整',
    impact: '提测日期顺延', nextStep: '完成开发后重新提测', owner: '@dev',
  };

  it('rejects sensitive free-text before producing a WritePlan', () => {
    expect(() => buildWeekPlanChangePlan({ ...input, reason: '使用 token=secret 调整' })).toThrow(/内部执行证据/);
    expect(() => buildWeekPlanChangePlan({ ...input, originalPlan: '/Users/private/plan.md' })).toThrow(/内部执行证据/);
  });
});

describe('buildReturnPlan', () => {
  it('builds from→target labels + assignee + 退回 comment', () => {
    const plan = buildReturnPlan({ type: 'story', from: '待评审', target: '草稿中', issues: ['验收标准缺失'], confirmer: '@pm', date: '2026-07-28', assigneeUser: '@pm', issueIid: 123 });
    expect(plan.issueIid).toBe(123);
    expect(plan.ops.map((o) => o.kind)).toEqual(['remove_label', 'add_label', 'set_assignee', 'add_comment']);
    expect(plan.ops).toContainEqual({ kind: 'remove_label', value: 'story-status::待评审' });
    expect(plan.ops).toContainEqual({ kind: 'add_label', value: 'story-status::草稿中' });
    const c = plan.ops.find((o) => o.kind === 'add_comment');
    expect(c && c.kind === 'add_comment' && c.body).toContain('退回：`草稿中`');
    expect(c && c.kind === 'add_comment' && c.body).toContain('验收标准缺失');
  });
  it('omits set_assignee when no assigneeUser', () => {
    const plan = buildReturnPlan({ type: 'story', from: '待评审', target: '草稿中', issues: [], confirmer: '@pm', date: '2026-07-28', issueIid: 1 });
    expect(plan.ops.some((o) => o.kind === 'set_assignee')).toBe(false);
  });
  it('uses status:: prefix for bug', () => {
    const plan = buildReturnPlan({ type: 'bug', from: '测试中', target: '开发中', issues: ['x'], confirmer: '@qa', date: '2026-07-28', issueIid: 9 });
    expect(plan.ops.some((o) => o.kind === 'add_label' && o.value === 'status::开发中')).toBe(true);
  });
});

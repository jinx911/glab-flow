import { describe, it, expect } from 'vitest';
import { buildReturnPlan } from './plan.js';

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

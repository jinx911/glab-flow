import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadModel, currentNode } from './model.js';
import { validateTransition, validateWritePlan } from './guard.js';
import { toFacts, parseAssigneeTable, type GitLabIssue } from './gitlab.js';
import { renderReturn } from './render.js';
import { buildForwardPlan } from './plan.js';
import { runTransition } from './transition.js';
import type { TransitionInput, WritePlan } from './types.js';

const model = loadModel();
const issue = JSON.parse(readFileSync(new URL('../fixtures/issue-story-draft.json', import.meta.url), 'utf8')) as GitLabIssue;

describe('e2e: 草稿中 -> 待评审 -> (退回) 草稿中 -> 待评审 -> 已评审', () => {
  it('drives the loop with guards + render + plan validation', () => {
    // step 1: current node
    expect(currentNode(model, 'story', issue.labels)).toBe('草稿中');

    // step 2: forward 草稿中->待评审 needs nothing required → ok
    let facts = toFacts(issue);
    let r = validateTransition(model, facts, { type: 'story', from: '草稿中', to: '待评审', fields: {}, assigneeUser: '@pm' });
    expect(r.ok).toBe(true);

    // step 3: at 待评审, review returns 退回 → must NOT advance to 已评审
    facts = { ...facts, labels: ['type::story', 'story-status::待评审'] };
    r = validateTransition(model, facts, { type: 'story', from: '待评审', to: '已评审', fields: {}, gateOutcome: '退回' });
    expect(r.ok).toBe(false);

    // step 4: render 退回 comment with 问题清单
    const ret = renderReturn('草稿中', ['验收标准缺失'], '@pm', '2026-07-28');
    expect(ret).toContain('验收标准缺失');

    // step 5: legacy direct validation cannot bypass the required Week Plan.
    r = validateTransition(model, facts, {
      type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'doc' },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('weekPlan');

    // step 6: after fix, 需求评审 + structured Week Plan → 已评审 ok
    r = validateTransition(model, facts, {
      type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'doc' },
      weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true,
    });
    expect(r.ok).toBe(true);

    // step 7: the validated payload produces a compatible schedule writeback.
    const plan: WritePlan = buildForwardPlan({
      type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'doc' },
      weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true },
      assigneeUser: '@dev',
    }, 200);
    expect(validateWritePlan(plan).ok).toBe(true);
    expect(plan.ops).toContainEqual(expect.objectContaining({ kind: 'add_comment', body: expect.stringContaining('## 周排期') }));

    // step 8: assignee resolved from 交付协同
    expect(parseAssigneeTable(issue.description).get('研发')).toBe('@dev');
  });
});

describe('e2e: 合并评论(状态变更头 + 内容体, 无 marker)', () => {
  it('草稿中→待评审 输出 comment 含状态头 + 需求提案要点', () => {
    const r = runTransition(model, {
      type: 'story', iid: 42, labels: ['type::story', 'story-status::草稿中'], body: '', notes: [{ body: '' }], state: 'opened',
      fields: { 背景: 'b', 目标: 'g' }, assigneeUser: '@pm', datesConfirmed: true,
    });
    expect(r.validate.ok).toBe(true);
    expect(r.comment).toContain('## 状态变更');
    expect(r.comment).toContain('`草稿中` → `待评审`');
    expect(r.comment).toContain('## 需求提案要点');
    expect(r.comment).toContain('- 背景：b');
    expect(r.comment).not.toContain('artifact-receipt');
  });
});

import { describe, it, expect } from 'vitest';
import { loadModel } from './model.js';
import { validateTransition } from './guard.js';
import type { IssueFacts, Payload } from './types.js';

const model = loadModel();
const facts = (labels: string[]): IssueFacts => ({ labels, body: '', state: 'opened', hasJiraSourceLabel: false });

describe('G1 required fields', () => {
  it('blocks when a required field is missing', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审', fields: { 评审日期: '2026-07-28' }, gateOutcome: '通过', assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, facts(['type::story', 'story-status::待评审']), p);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('产品确认人');
  });
  it('passes when all required fields present', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, facts(['type::story', 'story-status::待评审']), p);
    expect(r.ok).toBe(true);
  });
});

describe('G2 gate outcome binary', () => {
  it('blocks forward transition when gateOutcome is 退回', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审', fields: {}, gateOutcome: '退回' };
    const r = validateTransition(model, facts(['type::story', 'story-status::待评审']), p);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('退回'))).toBe(true);
  });
});

describe('G3 hard gate needs humanConfirmed', () => {
  it('blocks hard-gate transition without humanConfirmed', () => {
    const p: Payload = { type: 'story', from: '待发布', to: '生产验收中',
      fields: { 发布日期: '2026-07-28', 研发Assignee: '@dev', 生产版本: 'v1', 发布记录或回滚信息: 'rec' },
      assigneeUser: '@pm', datesConfirmed: true };
    const r = validateTransition(model, facts(['type::story', 'story-status::待发布']), p);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('hard'))).toBe(true);
  });
});

describe('G4 three-review separation', () => {
  it('blocks 需求评审 transition when reviewType is 技术方案评审', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
      gateOutcome: '通过', reviewType: '技术方案评审', assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, facts(['type::story', 'story-status::待评审']), p);
    expect(r.ok).toBe(false);
  });
});

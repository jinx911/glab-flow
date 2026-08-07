import { describe, it, expect } from 'vitest';
import { loadModel } from './model.js';
import { validateTransition, validateWritePlan } from './guard.js';
import type { IssueFacts, Payload, WritePlan } from './types.js';

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

describe('G5 label uniqueness', () => {
  it('blocks when two story-status labels present (dirty state)', () => {
    const p: Payload = { type: 'story', from: '草稿中', to: '待评审', fields: {} };
    const r = validateTransition(model, facts(['type::story', 'story-status::草稿中', 'story-status::待评审']), p);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('脏状态'))).toBe(true);
  });
});

describe('G6 assignee concrete user', () => {
  it('blocks when assigneeUser is a bare role, not a user', () => {
    const p: Payload = { type: 'story', from: '草稿中', to: '待评审', fields: {}, assigneeUser: '研发' };
    const r = validateTransition(model, facts(['type::story', 'story-status::草稿中']), p);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('Assignee'))).toBe(true);
  });
});

describe('G9 no placeholder people/conclusion', () => {
  it('blocks when a person field is 待确认', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '待确认', 评审结论: '通过', 需求文档或评审记录: 'link' },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, facts(['type::story', 'story-status::待评审']), p);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('产品确认人');
  });
});

describe('G10 date confirmation', () => {
  it('blocks when a date field present but datesConfirmed false', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: false };
    const r = validateTransition(model, facts(['type::story', 'story-status::待评审']), p);
    expect(r.ok).toBe(false);
  });
});

describe('G11 blocking test issues verified', () => {
  it('blocks 测试中->待发布 when blocking issues not verified', () => {
    const p: Payload = { type: 'story', from: '测试中', to: '待发布',
      fields: { 测试完成日期: '2026-07-28', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', 阻塞发布问题均已验证通过: '否' },
      assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, facts(['type::story', 'story-status::测试中']), p);
    expect(r.ok).toBe(false);
  });
});

describe('G12 terminal atomicity', () => {
  it('blocks terminal transition without closeIssue', () => {
    const p: Payload = { type: 'story', from: '生产验收中', to: '已完成',
      fields: { 验收完成日期: '2026-07-28', 具体产品验收人: '@pm', 产品Assignee: '@pm', 验收结论: '通过', 验收依据: 'ok' },
      assigneeUser: '@pm', datesConfirmed: true, humanConfirmed: true, closeIssue: false };
    const r = validateTransition(model, facts(['type::story', 'story-status::生产验收中']), p);
    expect(r.ok).toBe(false);
  });
});

describe('G7/G8/G13 write-plan guards', () => {
  const plan = (ops: WritePlan['ops']): WritePlan => ({ issueIid: 123, ops });

  it('G7 accepts add_label + add_comment (no body edit)', () => {
    const r = validateWritePlan(plan([{ kind: 'add_label', value: 'x' }, { kind: 'add_comment', body: 'hi' }]));
    expect(r.ok).toBe(true);
  });
  it('G8 forbids editing existing comments (edit_comment not allowed)', () => {
    const r = validateWritePlan(plan([{ kind: 'edit_comment', body: 'x' } as any]));
    expect(r.ok).toBe(false);
  });
  it('G13 forbids creating Jira', () => {
    const r = validateWritePlan(plan([{ kind: 'create_jira' } as any]));
    expect(r.ok).toBe(false);
  });
  it('accepts a clean label+assignee+comment+close plan', () => {
    const r = validateWritePlan(plan([
      { kind: 'remove_label', value: 'story-status::生产验收中' },
      { kind: 'add_label', value: 'story-status::已完成' },
      { kind: 'set_assignee', username: '@pm' },
      { kind: 'add_comment', body: '## 状态变更' },
      { kind: 'close_issue' },
    ]));
    expect(r.ok).toBe(true);
  });
});

describe('G3 positive — hard gate with humanConfirmed passes', () => {
  it('passes 待发布->生产验收中 when humanConfirmed true', () => {
    const p: Payload = { type: 'story', from: '待发布', to: '生产验收中',
      fields: { 发布日期: '2026-07-28', 研发Assignee: '@dev', 生产版本: 'v1', 发布记录或回滚信息: 'rec' },
      assigneeUser: '@pm', datesConfirmed: true, humanConfirmed: true };
    const r = validateTransition(model, facts(['type::story', 'story-status::待发布']), p);
    expect(r.ok).toBe(true);
  });
});

describe('G12 positive — terminal with closeIssue passes', () => {
  it('passes 生产验收中->已完成 when closeIssue true', () => {
    const p: Payload = { type: 'story', from: '生产验收中', to: '已完成',
      fields: { 验收完成日期: '2026-07-28', 具体产品验收人: '@pm', 产品Assignee: '@pm', 验收结论: '通过', 验收依据: 'ok' },
      assigneeUser: '@pm', datesConfirmed: true, humanConfirmed: true, closeIssue: true };
    const r = validateTransition(model, facts(['type::story', 'story-status::生产验收中']), p);
    expect(r.ok).toBe(true);
  });
});

describe('G11 bug — blocking issues apply to bug too', () => {
  it('blocks bug 测试中->待发布 when blocking issues not verified', () => {
    const p: Payload = { type: 'bug', from: '测试中', to: '待发布',
      fields: { 测试完成日期: '2026-07-28', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', 阻塞发布问题均已验证通过: '否' },
      assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, facts(['type::bug', 'status::测试中']), p);
    expect(r.ok).toBe(false);
  });
  it('passes bug 测试中->待发布 when blocking issues verified', () => {
    const p: Payload = { type: 'bug', from: '测试中', to: '待发布',
      fields: { 测试完成日期: '2026-07-28', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', 阻塞发布问题均已验证通过: '是', feature分支MR评审结论: '通过' },
      assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, facts(['type::bug', 'status::测试中']), p);
    expect(r.ok).toBe(true);
  });
});

describe('G11 normalization — accepts affirmative synonyms, rejects the rest', () => {
  const baseFields = { 测试完成日期: '2026-07-28', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', feature分支MR评审结论: '通过' };
  const run = (val: string) => validateTransition(model, facts(['type::story', 'story-status::测试中']), {
    type: 'story', from: '测试中', to: '待发布',
    fields: { ...baseFields, 阻塞发布问题均已验证通过: val }, assigneeUser: '@dev', datesConfirmed: true,
  } as Payload);

  it.each(['是', '已验证', '已通过', '无阻塞', '通过', 'true', 'yes', ' 是 ', '是(无阻塞)', '是。详细说明…'])('accepts %s', (val) => {
    expect(run(val).ok).toBe(true);
  });
  it.each(['否', '未', 'false', 'no', '待确认', ''])('rejects %s', (val) => {
    expect(run(val).ok).toBe(false);
  });
});

const TABLE_BODY = `# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n`;
const factsWithTable = (labels: string[]) => ({ labels, body: TABLE_BODY, state: 'opened' as const, hasJiraSourceLabel: false });

describe('G6b role cross-check (when 交付协同 table present)', () => {
  it('passes when assigneeUser matches the table role', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, factsWithTable(['type::story', 'story-status::待评审']), p);
    expect(r.ok).toBe(true);
  });
  it('blocks when assigneeUser does NOT match the table role', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@someone-else', datesConfirmed: true };
    const r = validateTransition(model, factsWithTable(['type::story', 'story-status::待评审']), p);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('与交付协同表'))).toBe(true);
  });
  it('blocks when the role is missing from the table', () => {
    const bodyMissing = TABLE_BODY.replace('| 研发 | @dev |\n', '');
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true };
    const r = validateTransition(model, { labels: ['type::story', 'story-status::待评审'], body: bodyMissing, state: 'opened', hasJiraSourceLabel: false }, p);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('缺少「研发」'))).toBe(true);
  });
  it('does NOT cross-check when no table present (triage intake) — existing behavior preserved', () => {
    // body empty → G6b skipped, only format G6 applies
    const p: Payload = { type: 'story', from: '草稿中', to: '待评审', fields: {}, assigneeUser: '@anyone' };
    const r = validateTransition(model, facts(['type::story', 'story-status::草稿中']), p);
    expect(r.ok).toBe(true);
  });
});

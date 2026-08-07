import { describe, it, expect } from 'vitest';
import { loadModel } from './model.js';
import { runTransition } from './transition.js';
import type { TransitionInput } from './types.js';

const model = loadModel();
const notes = [{ body: '' }];

function baseInput(over: Partial<TransitionInput>): TransitionInput {
  return { type: 'story', iid: 42, labels: [], body: '', notes, state: 'opened', ...over };
}

const TABLE_BODY = `# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n`;

const TEST_DONE_FIELDS = {
  测试完成日期: '2026-08-07',
  测试Assignee: '@qa',
  测试结论: '通过',
  回归范围或证据: 'r',
  阻塞发布问题均已验证通过: '是',
};

describe('transition — dirty detection', () => {
  it('flags 0 status labels', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story'] }));
    expect(r.dirty).toBe(true);
    expect(r.validate.ok).toBe(false);
    expect(r.preview).toContain('脏状态');
  });
  it('flags ≥2 status labels', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中', 'story-status::待发布'] }));
    expect(r.dirty).toBe(true);
  });
  it('flags closed but non-terminal node', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::待发布'], state: 'closed' }));
    expect(r.dirty).toBe(true);
    expect(r.preview).toContain('已关闭');
  });
  it('clean open node is not dirty', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'] }));
    expect(r.dirty).toBe(false);
  });
});

describe('transition — assignee resolution', () => {
  it('resolves assignee from 交付协同 table (测试中→待发布, role=研发)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true }));
    expect(r.dirty).toBe(false);
    expect(r.prefilled.assigneeUser).toContain('@dev');
    expect(r.prefilled.assigneeUser).toContain('交付协同表');
    expect(r.payload?.assigneeUser).toBe('@dev');
  });
  it('falls back to config.roles when no table', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], fields: TEST_DONE_FIELDS, datesConfirmed: true,
      config: { roles: { 研发: '@devrole', 测试: '@qarole' } },
    }));
    expect(r.payload?.assigneeUser).toBe('@devrole');
    expect(r.prefilled.assigneeUser).toContain('config.roles');
  });
  it('auto-prefixes @ when user given without it', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true, assigneeUser: 'dev' }));
    expect(r.payload?.assigneeUser).toBe('@dev');
    expect(r.prefilled.assigneeUser).toContain('输入');
  });
  it('reports missing assignee when none resolvable (bug, no table/roles/input)', () => {
    const r = runTransition(model, baseInput({ type: 'bug', labels: ['type::bug', 'status::测试中'], fields: { ...TEST_DONE_FIELDS }, datesConfirmed: true }));
    expect(r.missing.some((m) => m.field === 'assigneeUser')).toBe(true);
    expect(r.validate.ok).toBe(false);
  });
});

describe('transition — G11 normalization flows through', () => {
  const f = (val: string) => runTransition(model, baseInput({
    labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
    fields: { 测试完成日期: '2026-08-07', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', 阻塞发布问题均已验证通过: val },
    datesConfirmed: true,
  }));
  it('accepts 已验证', () => expect(f('已验证').validate.ok).toBe(true));
  it('accepts 是(无阻塞)', () => expect(f('是(无阻塞)').validate.ok).toBe(true));
  it('rejects 否', () => expect(f('否').validate.ok).toBe(false));
});

describe('transition — missing fields carry hints', () => {
  it('hints each missing required field (测试中→待发布)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: {}, datesConfirmed: true }));
    const fields = r.missing.map((m) => m.field);
    expect(fields).toContain('测试完成日期');
    expect(fields).toContain('阻塞发布问题均已验证通过');
    expect(r.missing.find((m) => m.field === '阻塞发布问题均已验证通过')?.hint).toMatch(/是 \/ 已验证/);
  });
  it('hints 上线清单 on 测试说明 (开发中→测试中)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true }));
    expect(r.next).toBe('测试中');
    expect(r.missing.find((m) => m.field === '测试说明')?.hint).toMatch(/上线步骤与配置清单/);
  });
});

describe('transition — plan + preview + shouldConfirm', () => {
  it('builds forward plan when valid and previews the change', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true }));
    expect(r.validate.ok).toBe(true);
    expect(r.plan?.ops.some((o) => o.kind === 'add_label')).toBe(true);
    expect(r.plan?.ops.some((o) => o.kind === 'remove_label')).toBe(true);
    expect(r.preview).toContain('测试中 → 待发布');
  });
  it('does not build plan when invalid', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: {}, datesConfirmed: true }));
    expect(r.validate.ok).toBe(false);
    expect(r.plan).toBeUndefined();
  });
  it('semi-auto always confirms', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true, runMode: 'semi-auto' }));
    expect(r.shouldConfirm).toBe(true);
  });
  it('full-auto skips confirm when ok and not hardGate', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true, runMode: 'full-auto' }));
    expect(r.validate.ok).toBe(true);
    expect(r.shouldConfirm).toBe(false);
  });
  it('full-auto still confirms hardGate (待发布→生产验收中)', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待发布'], body: TABLE_BODY,
      fields: { 发布日期: '2026-08-07', 研发Assignee: '@dev', 生产版本: 'v1', 发布记录或回滚信息: 'rec' },
      datesConfirmed: true, humanConfirmed: true, runMode: 'full-auto',
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.shouldConfirm).toBe(true);
  });
  it('full-auto confirms when !ok (gap)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: {}, datesConfirmed: true, runMode: 'full-auto' }));
    expect(r.shouldConfirm).toBe(true);
  });
});

describe('transition — default next node when to omitted', () => {
  it('picks the default forward transition', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY, fields: {} }));
    expect(r.next).toBe('待评审');
  });
  it('returns no transition when explicit to has no match', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY, to: '不存在节点' }));
    expect(r.validate.ok).toBe(false);
    expect(r.preview).toContain('无可用转换');
  });
});

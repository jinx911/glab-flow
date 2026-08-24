import { describe, it, expect } from 'vitest';
import { loadModel } from './model.js';
import { runTransition } from './transition.js';
import { renderStatusChange } from './render.js';
import type { TransitionInput } from './types.js';

const model = loadModel();
const TEST_PLAN = `<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api,e2e
asset: TP-001 | scenario
-->`;
const LOCAL_RUN = `<!-- glab-flow:test-run:v1
environment: local
plan-version: v3
version: service:abc123
outcome: passed
asset-audit: v3/local
cases: TP-001=passed
evidence: api=report:101,e2e=note:https://git.example/local
-->`;
const TEST_RUN = `<!-- glab-flow:test-run:v1
environment: test
plan-version: v3
version: service:abc123
outcome: passed
asset-audit: v3/test
cases: TP-001=passed
evidence: api=report:102,e2e=note:https://git.example/test
-->`;
const LOCAL_AUDIT = `<!-- glab-flow:apifox-asset-audit:v1
environment: local
plan-version: v3
project: 8731182
branch: main
unresolved-findings: 0
evidence: list-get:https://apifox.example/local
asset: TP-001 | scenario | scenario-101 | reuse
-->`;
const TEST_AUDIT = `<!-- glab-flow:apifox-asset-audit:v1
environment: test
plan-version: v3
project: 8731182
branch: main
unresolved-findings: 0
evidence: list-get:https://apifox.example/test
asset: TP-001 | scenario | scenario-101 | reuse
-->`;
const notes = [{ body: LOCAL_AUDIT }, { body: LOCAL_RUN }, { body: TEST_AUDIT }, { body: TEST_RUN }];

function baseInput(over: Partial<TransitionInput>): TransitionInput {
  return { type: 'story', iid: 42, labels: [], body: '', notes, testPlan: TEST_PLAN, state: 'opened', ...over };
}

const TABLE_BODY = `# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n`;

const TEST_DONE_FIELDS = {
  测试完成日期: '2026-08-07',
  测试Assignee: '@qa',
  测试结论: '通过',
  回归范围或证据: 'r',
  阻塞发布问题均已验证通过: '是',
  feature分支MR评审结论: '通过，无 HIGH 残留',
};

const DEVELOPMENT_START_FIELDS = {
  技术方案评审通过记录或免评审结论: '通过',
  实际开始日期: '2026-08-07',
  研发Assignee: '@dev',
  计划提测时间: '2026-08-08',
  计划上线时间: '2026-08-09',
};

const REVIEW_FIELDS = {
  评审日期: '2026-08-07',
  产品确认人: '@pm',
  评审结论: '通过',
  需求文档或评审记录: 'review-record',
};

const VALID_WEEK_PLAN = { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true };
const PAUSED_WEEK_PLAN_NOTE = `## 周排期

- 计划开始：2026-08-17
- 计划完成：2026-09-06
- 计划覆盖周：W34 ～ W36
- 自动 rollover：暂停`;

const TEST_SUBMISSION_FIELDS = {
  代码评审结论: '通过',
  提测日期: '2026-08-07',
  研发Assignee: '@dev',
  可测试版本或环境: 'test-v1',
  测试说明: '说明',
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
    fields: { 测试完成日期: '2026-08-07', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', 阻塞发布问题均已验证通过: val, feature分支MR评审结论: '通过，无 HIGH 残留' },
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
  it('requires feature MR review before 待发布 (blocks when missing)', () => {
    const fieldsWithoutMR = { ...TEST_DONE_FIELDS };
    delete (fieldsWithoutMR as Record<string, string>).feature分支MR评审结论;
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: fieldsWithoutMR, datesConfirmed: true }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.find((m) => m.field === 'feature分支MR评审结论')?.hint).toMatch(/MR 代码评审/);
  });
});

describe('transition — versioned environment test runs', () => {
  const localSubmission = (over: Partial<TransitionInput> = {}) => baseInput({
    labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: TEST_SUBMISSION_FIELDS, datesConfirmed: true,
    ...over,
  });
  const testAcceptance = (over: Partial<TransitionInput> = {}) => baseInput({
    labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true,
    ...over,
  });

  it('blocks submission without the current test plan or a local TestRun', () => {
    expect(runTransition(model, localSubmission({ testPlan: undefined })).validate.missing).toContain('testPlan');
    expect(runTransition(model, localSubmission({ notes: [] })).validate.missing).toContain('localAssetAudit');
  });

  it('allows submission after the current local TestRun and blocks release without test TestRun', () => {
    expect(runTransition(model, localSubmission({ notes: [{ body: LOCAL_AUDIT }, { body: LOCAL_RUN }] })).validate.ok).toBe(true);
    expect(runTransition(model, testAcceptance({ notes: [{ body: LOCAL_AUDIT }, { body: LOCAL_RUN }] })).validate.missing).toContain('testAssetAudit');
  });

  it('invalidates both gates when the plan version changes', () => {
    const changed = TEST_PLAN.replace('plan-version: v3', 'plan-version: v4');
    expect(runTransition(model, localSubmission({ testPlan: changed })).validate.reasons.join('\n')).toContain('版本不匹配');
    expect(runTransition(model, testAcceptance({ testPlan: changed })).validate.reasons.join('\n')).toContain('版本不匹配');
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

describe('transition — Story Week Plan gates', () => {
  const reviewInput = (over: Partial<TransitionInput> = {}) => baseInput({
    labels: ['type::story', 'story-status::待评审'], body: TABLE_BODY,
    fields: REVIEW_FIELDS, gateOutcome: '通过', reviewType: '需求评审', datesConfirmed: true,
    ...over,
  });
  const developmentInput = (over: Partial<TransitionInput> = {}) => baseInput({
    labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
    fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
    ...over,
  });

  it('requires an input Week Plan when approving a Story', () => {
    const r = runTransition(model, reviewInput());
    expect(r.validate.ok).toBe(false);
    expect(r.missing.find((m) => m.field === 'weekPlan')?.hint).toContain('startDate');
    expect(r.validate.reasons).toContainEqual(expect.stringContaining('周排期缺失'));
    expect(r.plan).toBeUndefined();
    expect(r.comment).not.toContain('## 周排期');
  });

  it('rejects an invalid input Week Plan without rendering a partial comment', () => {
    const r = runTransition(model, reviewInput({ weekPlan: { ...VALID_WEEK_PLAN, endDate: '2026-08-16' } }));
    expect(r.validate.ok).toBe(false);
    expect(r.validate.reasons).toContainEqual(expect.stringContaining('计划完成不能早于计划开始'));
    expect(r.plan).toBeUndefined();
    expect(r.comment).not.toContain('## 周排期');
  });

  it('writes the exact Week Plan in the combined review comment', () => {
    const r = runTransition(model, reviewInput({ weekPlan: VALID_WEEK_PLAN }));
    const comment = r.plan?.ops.find((op) => op.kind === 'add_comment');
    expect(r.validate.ok).toBe(true);
    expect(r.comment).toContain('## 周排期');
    expect(comment).toMatchObject({ kind: 'add_comment', body: r.comment });
    expect((comment as { body: string }).body).toContain(`## 周排期

- 计划开始：2026-08-17
- 计划完成：2026-09-06
- 计划覆盖周：W34 ～ W36
- 自动 rollover：启用`);
  });

  it('rejects development entry when no latest Week Plan is present while retaining planned dates', () => {
    const r = runTransition(model, developmentInput());
    expect(r.validate.ok).toBe(false);
    expect(r.payload?.fields).toMatchObject(DEVELOPMENT_START_FIELDS);
    expect(r.missing.map((m) => m.field)).toContain('latestWeekPlan');
    expect(r.validate.reasons).toContainEqual(expect.stringContaining('最新周排期缺失'));
    expect(r.plan).toBeUndefined();
  });

  it('rejects development entry when the latest Week Plan is malformed', () => {
    const r = runTransition(model, developmentInput({ notes: [{ body: `${PAUSED_WEEK_PLAN_NOTE}\n\n## 周排期\n\n- 计划开始：bad` }] }));
    expect(r.validate.ok).toBe(false);
    expect(r.validate.reasons).toContainEqual(expect.stringContaining('最新周排期无效'));
    expect(r.plan).toBeUndefined();
  });

  it('accepts a valid paused latest Week Plan for development entry', () => {
    const r = runTransition(model, developmentInput({ notes: [{ body: PAUSED_WEEK_PLAN_NOTE }] }));
    expect(r.validate.ok).toBe(true);
    expect(r.plan).toBeDefined();
  });

  it('keeps Bug transitions compatible without a Week Plan', () => {
    const r = runTransition(model, baseInput({
      type: 'bug', labels: ['type::bug', 'status::已确认缺陷'], body: TABLE_BODY,
    }));
    expect(r.next).toBe('开发中');
    expect(r.validate.ok).toBe(true);
    expect(r.plan).toBeDefined();
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

describe('transition — per-transition side-effect playbook', () => {
  it('提测 bundles commit/merge/jenkins + issue writeback when config present', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true,
      config: { deployBranch: 'test', jenkins: true },
    }));
    expect(r.next).toBe('测试中');
    expect(r.playbook.map((s) => s.action)).toEqual(['commit_push_feature', 'merge_to_deploy_branch', 'trigger_jenkins', 'issue_writeback']);
    expect(r.playbook[r.playbook.length - 1]?.isWriteback).toBe(true);
  });
  it('提测 filters out merge/jenkins when config absent', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true,
    }));
    expect(r.playbook.map((s) => s.action)).toEqual(['commit_push_feature', 'issue_writeback']);
  });
  it('发布 = 执行上线 deploy + issue writeback（生产 deploy 无条件，手动也推进 Issue）', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待发布'], body: TABLE_BODY,
      fields: { 发布日期: '2026-08-07', 研发Assignee: '@dev', 生产版本: 'v1', 发布记录或回滚信息: 'rec' },
      datesConfirmed: true, humanConfirmed: true,
    }));
    expect(r.next).toBe('生产验收中');
    expect(r.playbook.map((s) => s.action)).toEqual(['deploy', 'issue_writeback']);
    expect(r.shouldConfirm).toBe(true);
  });
  it('测试中→待发布 准备发布：create_mr + mr_review + release_check + issue writeback', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: { ...TEST_DONE_FIELDS }, datesConfirmed: true,
    }));
    expect(r.next).toBe('待发布');
    expect(r.playbook.map((s) => s.action)).toEqual(['create_mr_to_master', 'mr_review', 'release_check', 'issue_writeback']);
  });
  it('transitions without declared playbook default to issue_writeback only', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY, fields: {} }));
    expect(r.next).toBe('待评审');
    expect(r.playbook.map((s) => s.action)).toEqual(['issue_writeback']);
  });
  it('preview lists code-side actions when present', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true,
      config: { deployBranch: 'test', jenkins: true },
    }));
    expect(r.preview).toContain('动作包');
    expect(r.preview).toContain('合并 feature → deploy_branch');
  });
});

describe('transition — node progress checklist (layer 2 visibility)', () => {
  it('surfaces 开发中 sub-steps in nodeProgress and preview', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true }));
    expect(r.nodeProgress).toEqual(['技术方案', '编码实现', '自测', '代码评审']);
    expect(r.preview).toContain('当前节点子步骤');
    expect(r.preview).toContain('代码评审');
  });
  it('surfaces 草稿中 sub-steps (entry node)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::草稿中'], body: TABLE_BODY, fields: {} }));
    expect(r.next).toBe('待评审');
    expect(r.nodeProgress).toEqual(['需求澄清', '六清楚草稿']);
  });
});

describe('transition — evidence smart prefill', () => {
  const NOTE = '## 状态变更\n- 测试完成日期：2026-08-05\n- 测试结论：通过\n- 回归范围或证据：回归通过\n';
  const rest = { 测试Assignee: '@qa', 阻塞发布问题均已验证通过: '是', feature分支MR评审结论: '通过' };

  it('prefills required fields from note "- 字段：值" lines', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      notes: [{ body: NOTE }, { body: TEST_AUDIT }, { body: TEST_RUN }], fields: rest, datesConfirmed: true,
    }));
    expect(r.payload?.fields.测试完成日期).toBe('2026-08-05');
    expect(r.prefilled.测试完成日期).toContain('2026-08-05');
    expect(r.prefilled.测试完成日期).toContain('评论');
    expect(r.missing.map((m) => m.field)).not.toContain('测试完成日期');
    expect(r.validate.ok).toBe(true);
  });
  it('user-provided fields take priority over evidence', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      notes: [{ body: NOTE }], fields: { ...rest, 测试完成日期: '2026-08-09' }, datesConfirmed: true,
    }));
    expect(r.payload?.fields.测试完成日期).toBe('2026-08-09');
    expect(r.prefilled.测试完成日期).toBeUndefined();
  });
  it('skips 待确认 placeholder values in notes', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      notes: [{ body: '## 状态变更\n- 测试完成日期：待确认\n' }], fields: rest, datesConfirmed: true,
    }));
    expect(r.payload?.fields.测试完成日期).toBeUndefined();
    expect(r.missing.map((m) => m.field)).toContain('测试完成日期');
  });
});

describe('transition — prefill from render-normalized comments (semantic slot fallback, ⑨)', () => {
  // renderStatusChange 把字段归一化成「实际日期/确认人/结论/依据」槽位写入评论（evidence 契约）。
  // 下次 transition 若只按精确 key 匹配会漏（评论里是槽位名）。用「待评审→已评审」验证回填闭环
  // （该转换无 requiredArtifacts，可专注预填逻辑；测试中→待发布 因要求 test-plan/mr-review 回执不适用）。
  it('prefills 评审日期/产品确认人/评审结论/需求文档或评审记录 from a normalized comment', () => {
    const rendered = renderStatusChange({
      type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-08-01', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'doc-link' },
      assigneeUser: '@dev',
    });
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待评审'], body: TABLE_BODY,
      notes: [{ body: rendered }],
      gateOutcome: '通过', reviewType: '需求评审', datesConfirmed: true,
      weekPlan: VALID_WEEK_PLAN,
    }));
    expect(r.payload?.fields.评审日期).toBe('2026-08-01');
    expect(r.payload?.fields.产品确认人).toBe('@pm');
    expect(r.payload?.fields.评审结论).toBe('通过');
    expect(r.payload?.fields.需求文档或评审记录).toBe('doc-link');
    expect(r.missing.map((m) => m.field)).not.toContain('评审日期');
    expect(r.validate.ok).toBe(true);
  });
  it('user-provided value still wins over semantic-slot fallback', () => {
    const rendered = renderStatusChange({
      type: 'story', from: '待评审', to: '已评审', fields: { 评审日期: '2026-08-01' }, assigneeUser: '@dev',
    });
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待评审'], body: TABLE_BODY,
      notes: [{ body: rendered }],
      fields: { 评审日期: '2026-08-09', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'doc' },
      gateOutcome: '通过', reviewType: '需求评审', datesConfirmed: true,
    }));
    expect(r.payload?.fields.评审日期).toBe('2026-08-09');
  });
});

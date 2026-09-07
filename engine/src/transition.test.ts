import { describe, it, expect } from 'vitest';
import { loadModel } from './model.js';
import { runTransition } from './transition.js';
import { renderStatusChange } from './render.js';
import { deriveGateSet, freezeGateSet } from './gate-set.js';
import { initDu, recordEvidence, setCachedNode } from './du.js';
import type { DuState, RequirementsReviewEvidence, TransitionInput } from './types.js';

const model = loadModel();
const TEST_PLAN = `<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api,e2e
case: TP-U01 | local,test | unit
asset: TP-001 | scenario
-->`;
const LOCAL_RUN = `<!-- glab-flow:test-run:v1
environment: local
plan-version: v3
outcome: passed
asset-audit: v3/local
cases: TP-001=passed,TP-U01=passed
evidence: api=report:101,e2e=note:https://git.example/local,unit=vitest-26-passed
-->`;
const TEST_RUN = `<!-- glab-flow:test-run:v1
environment: test
plan-version: v3
outcome: passed
asset-audit: v3/test
cases: TP-001=passed,TP-U01=passed
evidence: api=report:102,e2e=note:https://git.example/test,unit=vitest-26-passed
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
  涉及项目与开发分支: 'oa-platform: feature/leave-settlement',
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

const VALID_REVIEW_EVIDENCE: RequirementsReviewEvidence = {
  images: [],
  frontend: { applicable: false, routes: [] },
  grilling: { coverage: ['目标与范围', '角色与权限', '业务规则与边界', '数据与兼容', '验收与多环境验证'], decisions: [], unresolved: [] },
};

const TEST_SUBMISSION_FIELDS = {
  代码评审结论: '通过',
  提测日期: '2026-08-07',
  研发Assignee: '@dev',
  涉及项目与开发分支: 'oa-platform: feature/leave-settlement',
  测试说明: '说明',
};


describe('transition — dirty detection', () => {
  it('flags 0 status labels', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story'] }));
    expect(r.dirty).toBe(true);
    expect(r.validate.ok).toBe(false);
    expect(r.preview).toContain('脏状态');
    expect(r.actionTier).toBeUndefined();
    expect(r.confirmBatchTitle).toBeUndefined();
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
    fields: { 测试完成日期: '2026-08-07', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', 阻塞发布问题均已验证通过: val, feature分支MR评审结论: '通过，无 HIGH 残留', 涉及项目与开发分支: 'oa-platform: feature/leave-settlement' },
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
  it('requires projects and development branches at both handoffs', () => {
    const submission = { ...TEST_SUBMISSION_FIELDS } as Record<string, string>;
    delete submission.涉及项目与开发分支;
    const submit = runTransition(model, baseInput({ labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: submission, datesConfirmed: true }));
    expect(submit.missing.find((m) => m.field === '涉及项目与开发分支')?.hint).toMatch(/每个涉及项目/);

    const acceptance = { ...TEST_DONE_FIELDS } as Record<string, string>;
    delete acceptance.涉及项目与开发分支;
    const release = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: acceptance, datesConfirmed: true }));
    expect(release.validate.ok).toBe(false);
    expect(release.missing.some((m) => m.field === '涉及项目与开发分支')).toBe(true);
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
  it('full-auto still confirms gated transition (L2 业务判断与 run 模式无关)', () => {
    const r = runTransition(model, baseInput({ labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true, runMode: 'full-auto' }));
    expect(r.validate.ok).toBe(true);
    expect(r.actionTier).toBe('L2');
    expect(r.shouldConfirm).toBe(true);
  });
  it('full-auto still confirms hardGate (待发布→生产验收中)', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待发布'], body: TABLE_BODY,
      fields: { 发布日期: '2026-08-07', 研发Assignee: '@dev', 发布记录或回滚信息: 'rec' },
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

describe('transition — per-transition side-effect playbook', () => {
  it('提测 bundles commit/merge/jenkins + issue writeback when config present', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true,
      config: { deployBranch: 'test', jenkins: true },
    }));
    expect(r.next).toBe('测试中');
    expect(r.playbook.map((s) => s.action)).toEqual(['commit_push_feature', 'merge_to_deploy_branch', 'trigger_jenkins']);
    expect(r.playbook.some((step) => step.isWriteback)).toBe(false);
  });
  it('提测 filters out merge/jenkins when config absent', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY, fields: {}, datesConfirmed: true,
    }));
    expect(r.playbook.map((s) => s.action)).toEqual(['commit_push_feature']);
    expect(r.playbook.some((step) => step.isWriteback)).toBe(false);
  });
  it('发布 = 执行上线 deploy + issue writeback（生产 deploy 无条件，手动也推进 Issue）', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待发布'], body: TABLE_BODY,
      fields: { 发布日期: '2026-08-07', 研发Assignee: '@dev', 发布记录或回滚信息: 'rec' },
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
    expect(r.nodeProgress).toEqual(['技术方案', '测试计划', '编码实现', '本地自测', '代码评审']);
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
  const rest = { 测试Assignee: '@qa', 阻塞发布问题均已验证通过: '是', feature分支MR评审结论: '通过', 涉及项目与开发分支: 'oa-platform: feature/leave-settlement' };

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
      reviewEvidence: VALID_REVIEW_EVIDENCE,
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

describe('GateSet skip states (P3)', () => {
  const DU_NOW = '2026-09-01T00:00:00Z';
  const frontendCopyDu = (): DuState => {
    const base = initDu({ iid: 42, type: 'story', now: DU_NOW });
    // local TestRun + AssetAudit 证据（frontend-copy environments=[local]，validateTestRunTransition 固定查 local）
    const withAudit = recordEvidence(base, { kind: 'asset-audit', environment: 'local', planVersion: 'v3', outcome: '0', recordedAt: DU_NOW, detailRef: 'list-get:https://apifox.example/local' }, DU_NOW);
    const withRun = recordEvidence(withAudit, { kind: 'test-run', environment: 'local', planVersion: 'v3', outcome: 'passed', recordedAt: DU_NOW }, DU_NOW);
    const withNode = setCachedNode(withRun, '开发中', DU_NOW);
    return { ...withNode, gateSet: freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['frontend-copy']), DU_NOW) };
  };

  it('frontend-copy DU advances 开发中 straight to 待发布 while validating original transition fields', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: { ...TEST_SUBMISSION_FIELDS, ...TEST_DONE_FIELDS }, datesConfirmed: true,
      notes: [], du: frontendCopyDu(),
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.next).toBe('待发布');
    // 校验/必填按原转换（开发中→测试中），payload 不撒谎
    expect(r.payload?.to).toBe('测试中');
    expect(r.transition?.from).toBe('开发中');
    expect(r.transition?.to).toBe('测试中');
    // 标签写回与评论头用 effectiveTarget（跳过 测试中）
    const addLabel = r.plan?.ops.find((o) => o.kind === 'add_label');
    expect(addLabel).toMatchObject({ value: 'story-status::待发布' });
    expect(r.comment).toContain('`开发中` → `待发布`');
    expect(r.comment).not.toContain('`开发中` → `测试中`');
    expect(r.comment).toContain('- 代码评审结论：通过');
    // 投影目标合并发布语义；GateSet mrReview=false 抑制 MR 创建/评审动作。
    expect(r.projectedPayload?.to).toBe('待发布');
    expect(r.projectedPayload?.assigneeUser).toBe('@dev');
    expect(r.playbook.map((s) => s.action)).toEqual(['commit_push_feature', 'release_check', 'issue_writeback']);
    expect(r.playbook.find((s) => s.action === 'run_affected_regression')).toBeUndefined();
  });

  it('skips nothing when GateSet has no skipStates (functional)', () => {
    const du: DuState = { ...frontendCopyDu(), gateSet: freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['functional']), DU_NOW) };
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: TEST_SUBMISSION_FIELDS, datesConfirmed: true,
      notes: [], du,
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.next).toBe('测试中');
    expect(r.payload?.to).toBe('测试中');
    expect(r.plan?.ops).toContainEqual(expect.objectContaining({ kind: 'add_label', value: 'story-status::测试中' }));
  });

  it('skip projection still fails closed on missing original-transition fields', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: {}, datesConfirmed: true,
      notes: [], du: frontendCopyDu(),
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.map((m) => m.field)).toContain('代码评审结论');
    expect(r.plan).toBeUndefined();
    // 校验未过时不落计划；next 仍展示投影目标（写回以 plan 为准，未过则不写）
    expect(r.next).toBe('待发布');
  });

  it('skip projection still fails closed without local test evidence', () => {
    const du: DuState = { ...setCachedNode(initDu({ iid: 42, type: 'story', now: DU_NOW }), '开发中', DU_NOW), gateSet: freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['frontend-copy']), DU_NOW) };
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: TEST_SUBMISSION_FIELDS, datesConfirmed: true,
      notes: [], du,
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.validate.missing).toContain('localAssetAudit');
    expect(r.plan).toBeUndefined();
    expect(r.next).toBe('待发布');
  });

  it('rejects an untrusted skip state before it can bypass a production hard gate', () => {
    const du: DuState = {
      ...setCachedNode(initDu({ iid: 42, type: 'story', now: DU_NOW }), '测试中', DU_NOW),
      gateSet: {
        scopes: ['frontend-copy'], skipStates: ['待发布'], environments: ['local'],
        mrReview: false, regression: 'affected-cases', rollbackPlan: false,
        minUnitCases: 0, overrides: [], frozenAt: DU_NOW,
      },
    };
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: TEST_DONE_FIELDS, datesConfirmed: true,
      notes, du,
    }));
    expect(r.next).toBeNull();
    expect(r.dirty).toBe(true);
    expect(r.validate.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.validate.reasons.join('；')).toContain('未经 gateMatrix 声明');
  });

  it('renders original and projected hard-gate facts for a trusted skip path', () => {
    const projectionModel = {
      ...model,
      gateMatrix: {
        ...model.gateMatrix!,
        rules: model.gateMatrix!.rules.map((rule) => rule.scopes.includes('frontend-copy')
          ? { ...rule, skipStates: ['待发布'] }
          : rule),
      },
    };
    const gateSet = freezeGateSet(deriveGateSet(projectionModel.gateMatrix!, ['frontend-copy']), DU_NOW);
    const du: DuState = {
      ...setCachedNode(initDu({ iid: 42, type: 'story', now: DU_NOW }), '测试中', DU_NOW),
      gateSet,
    };
    const r = runTransition(projectionModel, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: {
        ...TEST_DONE_FIELDS,
        发布日期: '2026-08-29',
        研发Assignee: '@dev',
        发布记录或回滚信息: 'release-check 已完成，回滚方案已核对',
      }, datesConfirmed: true, humanConfirmed: true,
      notes, du,
    }));
    expect(r.validate.ok).toBe(true);
    const body = r.plan?.ops.find((op) => op.kind === 'add_comment')?.body;
    expect(body).toContain('- 测试完成日期：2026-08-07');
    expect(body).toContain('- 发布记录或回滚信息：release-check 已完成，回滚方案已核对');
  });

  it('GateSet environments decide which TestRun evidence gate applies', () => {
    const du = { ...frontendCopyDu(), cachedNode: '测试中' };
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: TEST_DONE_FIELDS, datesConfirmed: true, notes: [], du,
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.validate.missing).not.toContain('testAssetAudit');
  });

  it('emits only the GateSet-enabled environment regression action when evidence is missing', () => {
    const du: DuState = {
      ...setCachedNode(initDu({ iid: 42, type: 'story', now: DU_NOW }), '开发中', DU_NOW),
      gateSet: freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['frontend-copy']), DU_NOW),
    };
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: { ...TEST_SUBMISSION_FIELDS, 回归范围或证据: '全量回归' }, datesConfirmed: true,
      notes: [], du,
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.playbook.map((step) => step.action)).toContain('run_affected_regression');
    expect(r.playbook.find((step) => step.action === 'run_affected_regression')).toMatchObject({ environment: 'local', subskill: 'test-flow-e2e' });
    expect(r.playbook.map((step) => step.action)).not.toContain('run_full_regression');
  });

  it('emits a full regression action for an enabled test environment', () => {
    const du: DuState = {
      ...setCachedNode(initDu({ iid: 42, type: 'story', now: DU_NOW }), '测试中', DU_NOW),
      gateSet: freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['api-contract']), DU_NOW),
    };
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: { ...TEST_DONE_FIELDS, 回归范围或证据: '全量回归' }, datesConfirmed: true, notes: [], du,
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.playbook.find((step) => step.action === 'run_full_regression')).toMatchObject({ environment: 'test', subskill: 'test-flow-e2e' });
  });

  it('verifies rollback readiness before a production deploy when GateSet requires it', () => {
    const du: DuState = {
      ...setCachedNode(initDu({ iid: 42, type: 'story', now: DU_NOW }), '待发布', DU_NOW),
      gateSet: freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['data-model']), DU_NOW),
    };
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待发布'], body: TABLE_BODY,
      fields: { 发布日期: '2026-08-29', 研发Assignee: '@dev', 发布记录或回滚信息: '已准备回滚方案' },
      datesConfirmed: true, humanConfirmed: true, notes: [], du,
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.playbook.map((step) => step.action)).toEqual(['verify_rollback_ready', 'deploy', 'issue_writeback']);
  });

  it('missing hints share the guard exemption — no ghost gap for waived MR review (I3)', () => {
    // functional GateSet（mrReview=false）：测试中→待发布 缺全部字段时，
    // 缺口提示也不得出现 feature分支MR评审结论（与 guard 豁免口径一致）
    const du: DuState = { ...frontendCopyDu(), cachedNode: '测试中', gateSet: freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['functional']), DU_NOW) };
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY,
      fields: {}, datesConfirmed: true,
      notes: [], du,
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.missing.map((m) => m.field)).not.toContain('feature分支MR评审结论');
    expect(r.missing.map((m) => m.field)).toContain('阻塞发布问题均已验证通过');
  });

  it('no GateSet bound → no projection at all (存量行为不变)', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::开发中'], body: TABLE_BODY,
      fields: TEST_SUBMISSION_FIELDS, datesConfirmed: true,
      notes: [{ body: LOCAL_AUDIT }, { body: LOCAL_RUN }],
    }));
    expect(r.next).toBe('测试中');
    expect(r.validate.ok).toBe(true);
  });
});

describe('GateSet proposal on 已评审→开发中 (P3)', () => {
  it('declaredScopes on 已评审→开发中 proposes GateSet', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
      fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
      declaredScopes: ['frontend-copy'],
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.proposedGateSet?.skipStates).toContain('测试中');
    expect(r.proposedGateSet?.mrReview).toBe(false);
    expect(r.proposedGateSet?.environments).toEqual(['local']);
    expect(r.proposedGateSet?.frozenAt).toBeUndefined();
  });
  it('does not propose on other transitions even with declaredScopes', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::待评审'], body: TABLE_BODY,
      fields: REVIEW_FIELDS, gateOutcome: '通过', reviewType: '需求评审', datesConfirmed: true,
      reviewEvidence: VALID_REVIEW_EVIDENCE,
      declaredScopes: ['frontend-copy'],
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.proposedGateSet).toBeUndefined();
  });
  it('does not propose when declaredScopes omitted', () => {
    const r = runTransition(model, baseInput({
      labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
      fields: DEVELOPMENT_START_FIELDS, datesConfirmed: true,
    }));
    expect(r.validate.ok).toBe(true);
    expect(r.proposedGateSet).toBeUndefined();
  });

  it('proposes a GateSet when a Bug first enters development', () => {
    const r = runTransition(model, baseInput({
      type: 'bug', labels: ['type::bug', 'status::已确认缺陷'], body: TABLE_BODY,
      declaredScopes: ['functional'],
    }));
    expect(r.validate.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.missing.map((item) => item.field)).toContain('gateSetBinding');
    expect(r.proposedGateSet).toMatchObject({ scopes: ['functional'], regression: 'affected-cases' });
    expect(r.actionTier).toBe('L2');
    expect(r.playbook[0]).toMatchObject({ action: 'bind_gateset', subskill: 'glab-flow' });
  });
});

describe('action tier (P1)', () => {
  it('blocks gateless bug development entry until GateSet binding is confirmed', () => {
    const out = runTransition(loadModel(), {
      type: 'bug', iid: 1, labels: ['type::bug', 'status::已确认缺陷'],
      body: '# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n', state: 'opened',
      notes: [], fields: {}, datesConfirmed: true,
    });
    expect(out.validate.ok).toBe(false);
    expect(out.missing.map((item) => item.field)).toContain('gateSetBinding');
    expect(out.actionTier).toBe('L2');
    expect(out.shouldConfirm).toBe(true);
  });
  it('marks hard gate L3 and requires confirmation even when validation passes', () => {
    const out = runTransition(loadModel(), {
      type: 'bug', iid: 1, labels: ['type::bug', 'status::待发布'],
      body: '# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n', state: 'opened',
      notes: [], datesConfirmed: true, humanConfirmed: true,
      fields: { 发布日期: '2026-09-01', 研发Assignee: '@dev', 发布记录或回滚信息: '见 release-check' },
    });
    expect(out.validate.ok).toBe(true);
    expect(out.actionTier).toBe('L3');
    expect(out.shouldConfirm).toBe(true);
  });
});

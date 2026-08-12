import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadModel, currentNode } from './model.js';
import { validateTransition, validateWritePlan } from './guard.js';
import { toFacts, parseAssigneeTable, type GitLabIssue } from './gitlab.js';
import { renderStatusChange, renderReturn } from './render.js';
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

    // step 5: after fix, 需求评审 通过 → 已评审 ok
    r = validateTransition(model, facts, {
      type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'doc' },
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true,
    });
    expect(r.ok).toBe(true);

    // step 6: build + validate a write plan for 已评审 transition
    const plan: WritePlan = { issueIid: 200, ops: [
      { kind: 'remove_label', value: 'story-status::待评审' },
      { kind: 'add_label', value: 'story-status::已评审' },
      { kind: 'set_assignee', username: '@dev' },
      { kind: 'add_comment', body: renderStatusChange({ type: 'story', from: '待评审', to: '已评审',
        fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'doc' }, assigneeUser: '@dev' }) },
    ] };
    expect(validateWritePlan(plan).ok).toBe(true);

    // step 7: assignee resolved from 交付协同
    expect(parseAssigneeTable(issue.description).get('研发')).toBe('@dev');
  });
});

const REPLAY_BODY = `# 需求
## 交付协同

| 角色 | GitLab 用户 |
| --- | --- |
| 产品 | @pm |
| 研发 | @dev |
| 测试 | @qa |
`;

const REPLAY_INPUT: Omit<TransitionInput, 'type' | 'iid' | 'labels' | 'fields'> = {
  body: REPLAY_BODY,
  notes: [],
  state: 'opened',
};

const PROJECT_ID = '3915';
const OBSERVED_AT = '2026-08-12T10:00:00Z';
const SHA256 = 'a'.repeat(64);

function receiptNote(sourceIid: number, kind: string, id: string, extra: string[] = []) {
  return {
    id,
    observedAt: OBSERVED_AT,
    body: `<!-- glab-flow:artifact-receipt:v1
kind: ${kind}
source: .glab-flow/${sourceIid}/${kind}.md
sha256: ${SHA256}
${extra.join('\n')}
-->`,
  };
}

function receiptContext(issueNotes: ReturnType<typeof receiptNote>[] = [], mergeRequests: Array<{ projectPath: string; iid: number; notes: ReturnType<typeof receiptNote>[] }> = [], dataEvidenceProfile?: 'standard' | 'data-backed') {
  const allNotes = [...issueNotes, ...mergeRequests.flatMap((mr) => mr.notes)];
  const artifactManifest = allNotes.reduce<Record<string, { source: string; sha256: string }>>((manifest, note) => {
    const kind = note.body.match(/^kind: ([a-z-]+)$/m)?.[1];
    const source = note.body.match(/^source: (.+)$/m)?.[1];
    const sha256 = note.body.match(/^sha256: (.+)$/m)?.[1];
    return kind && source && sha256 ? { ...manifest, [kind]: { source, sha256 } } : manifest;
  }, {});
  return { projectId: PROJECT_ID, issueNotes, mergeRequests, artifactManifest, ...(dataEvidenceProfile ? { dataEvidenceProfile } : {}) };
}

const DEVELOPMENT_START_FIELDS = {
  技术方案评审通过记录或免评审结论: '通过',
  实际开始日期: '2026-08-12',
  研发Assignee: '@dev',
  计划提测时间: '2026-08-13',
  计划上线时间: '2026-08-15',
};

const TEST_SUBMISSION_FIELDS = {
  代码评审与自测结论: '通过',
  提测日期: '2026-08-12',
  研发Assignee: '@dev',
  可测试版本或环境: 'test-v1',
  测试说明: '覆盖主要验收路径',
};

const TEST_COMPLETE_FIELDS = {
  测试完成日期: '2026-08-12',
  测试Assignee: '@qa',
  测试结论: '通过',
  回归范围或证据: '回归报告 #880',
  阻塞发布问题均已验证通过: '是',
  feature分支MR评审结论: '通过，无 HIGH 残留',
};

const RELEASE_FIELDS = {
  发布日期: '2026-08-12',
  研发Assignee: '@dev',
  生产版本: 'v2026.08.12',
  发布记录或回滚信息: '生产发布记录与回滚方案',
};

describe('e2e: artifact receipt replay gates', () => {
  it('only starts story development after a parent Issue design receipt is read back', () => {
    const blocked = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::已评审'],
      fields: DEVELOPMENT_START_FIELDS,
      datesConfirmed: true,
      artifactContext: receiptContext([], [], 'standard'),
    });
    expect(blocked.validate.ok).toBe(false);
    expect(blocked.validate.missing).toContain('design');
    expect(blocked.missing.map((item) => item.field)).toContain('design');
    expect(blocked.plan).toBeUndefined();

    const ready = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::已评审'],
      fields: DEVELOPMENT_START_FIELDS,
      datesConfirmed: true,
      artifactContext: receiptContext([receiptNote(880, 'design', '301')], [], 'standard'),
    });
    expect(ready.validate).toEqual({ ok: true, missing: [], reasons: [] });
    expect(ready.plan).toBeDefined();
    expect(ready.verifiedReceipts).toEqual([{
      kind: 'design',
      target: { kind: 'issue', projectId: PROJECT_ID, iid: 880 },
      source: '.glab-flow/880/design.md',
      sha256: SHA256,
      noteId: '301',
      observedAt: OBSERVED_AT,
    }]);

    const stale = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::已评审'],
      fields: DEVELOPMENT_START_FIELDS,
      datesConfirmed: true,
      artifactContext: {
        ...receiptContext([receiptNote(880, 'design', '301')], [], 'standard'),
        artifactManifest: { design: { source: '.glab-flow/880/spec/design.md', sha256: 'b'.repeat(64) } },
      },
    });
    expect(stale.validate.ok).toBe(false);
    expect(stale.missing).toContainEqual(expect.objectContaining({ field: 'artifactManifest.design' }));
  });

  it('accepts a fully read-back manual deployment receipt before development submits to testing', () => {
    const manualDeployment = receiptNote(880, 'deployment-evidence', '302', [
      'mode: manual',
      'unavailable-reason: Jenkins test deployment capability is unavailable',
      'operator: @dev',
      'deployed-version: test-v1',
      'environment: test',
      'verification: smoke-pass',
      'performed-at: 2026-08-12T10:00:00Z',
    ]);
    const ready = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::开发中'],
      fields: TEST_SUBMISSION_FIELDS,
      datesConfirmed: true,
      config: { jenkins: true },
      artifactContext: receiptContext([manualDeployment]),
    });
    expect(ready.next).toBe('测试中');
    expect(ready.validate).toEqual({ ok: true, missing: [], reasons: [] });
    expect(ready.plan).toBeDefined();
    expect(ready.verifiedReceipts).toEqual([{
      kind: 'deployment-evidence',
      target: { kind: 'issue', projectId: PROJECT_ID, iid: 880 },
      source: '.glab-flow/880/deployment-evidence.md',
      sha256: SHA256,
      noteId: '302',
      observedAt: OBSERVED_AT,
      metadata: {
        mode: 'manual',
        unavailableReason: 'Jenkins test deployment capability is unavailable',
        operator: '@dev',
        deployedVersion: 'test-v1',
        environment: 'test',
        verification: 'smoke-pass',
        performedAt: '2026-08-12T10:00:00Z',
      },
    }]);
  });

  it('blocks development submission when a manual deployment receipt omits performed-at', () => {
    const malformedManualDeployment = receiptNote(880, 'deployment-evidence', '302', [
      'mode: manual',
      'unavailable-reason: Jenkins test deployment capability is unavailable',
      'operator: @dev',
      'deployed-version: test-v1',
      'environment: test',
      'verification: smoke-pass',
    ]);
    const blocked = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::开发中'],
      fields: TEST_SUBMISSION_FIELDS,
      datesConfirmed: true,
      config: { jenkins: true },
      artifactContext: receiptContext([malformedManualDeployment]),
    });
    expect(blocked.validate).toEqual({
      ok: false,
      missing: ['deployment-evidence'],
      reasons: ['缺少回执 deployment-evidence：在 Issue 评论追加 deployment-evidence 回执标记，并回读 Issue 确认回执'],
    });
    expect(blocked.missing).toEqual([{
      field: 'deployment-evidence',
      hint: '在 Issue 评论追加 deployment-evidence 回执标记，并回读 Issue 确认回执',
    }]);
    expect(blocked.verifiedReceipts).toEqual([]);
    expect(blocked.plan).toBeUndefined();
  });

  it('blocks a group/web MR when the only review receipt was read back from group/api', () => {
    const oneMrMissing = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::测试中'],
      fields: TEST_COMPLETE_FIELDS,
      datesConfirmed: true,
      artifactContext: receiptContext(
        [receiptNote(880, 'test-plan', '303')],
        [
          { projectPath: 'group/api', iid: 11, notes: [receiptNote(880, 'mr-review', '304', ['outcome: passed', 'method: code-review', 'high-findings: none'])] },
          { projectPath: 'group/web', iid: 12, notes: [] },
        ],
      ),
    });
    expect(oneMrMissing.validate).toEqual({
      ok: false,
      missing: ['mr-review:group/web!12'],
      reasons: ['缺少回执 mr-review:group/web!12：在 MR group/web!12 评论追加 mr-review 回执标记，并回读该 MR 确认回执'],
    });
    expect(oneMrMissing.missing).toEqual([{
      field: 'mr-review:group/web!12',
      hint: '在 MR group/web!12 评论追加 mr-review 回执标记，并回读该 MR 确认回执',
    }]);
    expect(oneMrMissing.verifiedReceipts).toEqual([
      {
        kind: 'test-plan', target: { kind: 'issue', projectId: PROJECT_ID, iid: 880 },
        source: '.glab-flow/880/test-plan.md', sha256: SHA256, noteId: '303', observedAt: OBSERVED_AT,
      },
      {
        kind: 'mr-review', target: { kind: 'mr', projectPath: 'group/api', iid: 11 },
        source: '.glab-flow/880/mr-review.md', sha256: SHA256, noteId: '304', observedAt: OBSERVED_AT,
        metadata: { outcome: 'passed', method: 'code-review', highFindings: 'none' },
      },
    ]);
    expect(oneMrMissing.plan).toBeUndefined();

    const ready = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::测试中'],
      fields: TEST_COMPLETE_FIELDS,
      datesConfirmed: true,
      artifactContext: receiptContext(
        [receiptNote(880, 'test-plan', '303')],
        [
          { projectPath: 'group/api', iid: 11, notes: [receiptNote(880, 'mr-review', '304', ['outcome: passed', 'method: code-review', 'high-findings: none'])] },
          { projectPath: 'group/web', iid: 12, notes: [receiptNote(880, 'mr-review', '305', ['outcome: passed', 'method: mr-review-lite', 'high-findings: none'])] },
        ],
      ),
    });
    expect(ready.next).toBe('待发布');
    expect(ready.validate).toEqual({ ok: true, missing: [], reasons: [] });
    expect(ready.plan).toBeDefined();
    expect(ready.verifiedReceipts).toEqual([
      {
        kind: 'test-plan', target: { kind: 'issue', projectId: PROJECT_ID, iid: 880 },
        source: '.glab-flow/880/test-plan.md', sha256: SHA256, noteId: '303', observedAt: OBSERVED_AT,
      },
      {
        kind: 'mr-review', target: { kind: 'mr', projectPath: 'group/api', iid: 11 },
        source: '.glab-flow/880/mr-review.md', sha256: SHA256, noteId: '304', observedAt: OBSERVED_AT,
        metadata: { outcome: 'passed', method: 'code-review', highFindings: 'none' },
      },
      {
        kind: 'mr-review', target: { kind: 'mr', projectPath: 'group/web', iid: 12 },
        source: '.glab-flow/880/mr-review.md', sha256: SHA256, noteId: '305', observedAt: OBSERVED_AT,
        metadata: { outcome: 'passed', method: 'mr-review-lite', highFindings: 'none' },
      },
    ]);
  });

  it('blocks bug production validation until the parent Issue release plan is read back', () => {
    const blocked = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'bug', iid: 881,
      labels: ['type::bug', 'status::待发布'],
      fields: RELEASE_FIELDS,
      datesConfirmed: true,
      humanConfirmed: true,
      artifactContext: receiptContext(),
    });
    expect(blocked.validate.ok).toBe(false);
    expect(blocked.validate.missing).toContain('release-plan');
    expect(blocked.missing.map((item) => item.field)).toContain('release-plan');
    expect(blocked.plan).toBeUndefined();

    const ready = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'bug', iid: 881,
      labels: ['type::bug', 'status::待发布'],
      fields: RELEASE_FIELDS,
      datesConfirmed: true,
      humanConfirmed: true,
      artifactContext: receiptContext([receiptNote(881, 'release-plan', '306')]),
    });
    expect(ready.next).toBe('生产验证中');
    expect(ready.validate).toEqual({ ok: true, missing: [], reasons: [] });
    expect(ready.plan).toBeDefined();
    expect(ready.verifiedReceipts).toEqual([{
      kind: 'release-plan',
      target: { kind: 'issue', projectId: PROJECT_ID, iid: 881 },
      source: '.glab-flow/881/release-plan.md',
      sha256: SHA256,
      noteId: '306',
      observedAt: OBSERVED_AT,
    }]);
  });
});

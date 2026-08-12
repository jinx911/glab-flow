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

function receiptNote(kind: string, id: string, extra: string[] = []) {
  return {
    id,
    observedAt: '2026-08-12T10:00:00Z',
    body: `<!-- glab-flow:artifact-receipt:v1
kind: ${kind}
source: .glab-flow/880/${kind}.md
sha256: ${id}-sha
${extra.join('\n')}
-->`,
  };
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
      artifactContext: { projectId: '3915', issueNotes: [] },
    });
    expect(blocked.validate.ok).toBe(false);
    expect(blocked.missing.map((item) => item.field)).toContain('design');
    expect(blocked.plan).toBeUndefined();

    const ready = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::已评审'],
      fields: DEVELOPMENT_START_FIELDS,
      datesConfirmed: true,
      artifactContext: { projectId: '3915', issueNotes: [receiptNote('design', '301')] },
    });
    expect(ready.validate.ok).toBe(true);
    expect(ready.plan).toBeDefined();
    expect(ready.verifiedReceipts).toMatchObject([
      { kind: 'design', target: { kind: 'issue', projectId: '3915', iid: 880 }, noteId: '301' },
    ]);
  });

  it('accepts a fully read-back manual deployment receipt before development submits to testing', () => {
    const manualDeployment = receiptNote('deployment-evidence', '302', [
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
      artifactContext: { projectId: '3915', issueNotes: [manualDeployment] },
    });
    expect(ready.next).toBe('测试中');
    expect(ready.validate.ok).toBe(true);
    expect(ready.plan).toBeDefined();
    expect(ready.verifiedReceipts).toMatchObject([{
      kind: 'deployment-evidence',
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

  it('requires test-plan plus an accepted MR review receipt for every release repository', () => {
    const oneMrMissing = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::测试中'],
      fields: TEST_COMPLETE_FIELDS,
      datesConfirmed: true,
      artifactContext: {
        projectId: '3915',
        issueNotes: [receiptNote('test-plan', '303')],
        mergeRequests: [
          { projectPath: 'group/api', iid: 11, notes: [receiptNote('mr-review', '304', ['outcome: passed', 'method: code-review', 'high-findings: none'])] },
          { projectPath: 'group/web', iid: 12, notes: [] },
        ],
      },
    });
    expect(oneMrMissing.validate.ok).toBe(false);
    expect(oneMrMissing.missing.map((item) => item.field)).toContain('mr-review:group/web!12');
    expect(oneMrMissing.plan).toBeUndefined();

    const ready = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'story', iid: 880,
      labels: ['type::story', 'story-status::测试中'],
      fields: TEST_COMPLETE_FIELDS,
      datesConfirmed: true,
      artifactContext: {
        projectId: '3915',
        issueNotes: [receiptNote('test-plan', '303')],
        mergeRequests: [
          { projectPath: 'group/api', iid: 11, notes: [receiptNote('mr-review', '304', ['outcome: passed', 'method: code-review', 'high-findings: none'])] },
          { projectPath: 'group/web', iid: 12, notes: [receiptNote('mr-review', '305', ['outcome: passed', 'method: mr-review-lite', 'high-findings: none'])] },
        ],
      },
    });
    expect(ready.next).toBe('待发布');
    expect(ready.validate.ok).toBe(true);
    expect(ready.plan).toBeDefined();
    expect(ready.verifiedReceipts.map((receipt) => receipt.noteId)).toEqual(['303', '304', '305']);
  });

  it('blocks bug production validation until the parent Issue release plan is read back', () => {
    const blocked = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'bug', iid: 881,
      labels: ['type::bug', 'status::待发布'],
      fields: RELEASE_FIELDS,
      datesConfirmed: true,
      humanConfirmed: true,
      artifactContext: { projectId: '3915', issueNotes: [] },
    });
    expect(blocked.validate.ok).toBe(false);
    expect(blocked.missing.map((item) => item.field)).toContain('release-plan');
    expect(blocked.plan).toBeUndefined();

    const ready = runTransition(model, {
      ...REPLAY_INPUT,
      type: 'bug', iid: 881,
      labels: ['type::bug', 'status::待发布'],
      fields: RELEASE_FIELDS,
      datesConfirmed: true,
      humanConfirmed: true,
      artifactContext: { projectId: '3915', issueNotes: [receiptNote('release-plan', '306')] },
    });
    expect(ready.next).toBe('生产验证中');
    expect(ready.validate.ok).toBe(true);
    expect(ready.plan).toBeDefined();
  });
});

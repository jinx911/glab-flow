import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadModel, currentNode } from './model.js';
import { validateTransition, validateWritePlan } from './guard.js';
import { toFacts, parseAssigneeTable, type GitLabIssue } from './gitlab.js';
import { renderReturn } from './render.js';
import { buildForwardPlan } from './plan.js';
import { runTransition } from './transition.js';
import { runModeSelectCommand } from './cli-commands.js';
import { initState } from './state.js';
import type { RequirementsReviewEvidence, TransitionInput, WritePlan } from './types.js';

const model = loadModel();
const issue = JSON.parse(readFileSync(new URL('../fixtures/issue-story-draft.json', import.meta.url), 'utf8')) as GitLabIssue;
const VALID_REVIEW_EVIDENCE: RequirementsReviewEvidence = {
  images: [], frontend: { applicable: false, routes: [] },
  grilling: { coverage: ['目标与范围', '角色与权限', '业务规则与边界', '数据与兼容', '验收与多环境验证'], decisions: [], unresolved: [] },
};

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
      reviewEvidence: VALID_REVIEW_EVIDENCE,
      gateOutcome: '通过', reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true,
    });
    expect(r.ok).toBe(true);

    // step 7: the validated payload produces a compatible schedule writeback.
    const plan: WritePlan = buildForwardPlan({
      type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'doc' },
      weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true },
      reviewEvidence: VALID_REVIEW_EVIDENCE,
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

describe('e2e: 开发入口的持久化自动模式护栏', () => {
  const body = '# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n';
  const pausedWeekPlan = `## 周排期

- 计划开始：2026-08-17
- 计划完成：2026-09-06
- 计划覆盖周：W34 ～ W36
- 自动 rollover：暂停`;
  const developmentInput: TransitionInput = {
    type: 'story', iid: 42, labels: ['type::story', 'story-status::已评审'], body, notes: [{ body: pausedWeekPlan }], state: 'opened',
    fields: {
      技术方案评审通过记录或免评审结论: '通过', 实际开始日期: '2026-08-17', 研发Assignee: '@dev',
      计划提测时间: '2026-08-24', 计划上线时间: '2026-08-31',
    },
    datesConfirmed: true,
  };

  function selectMode(mode: 'semi-auto' | 'full-auto') {
    return runModeSelectCommand({
      state: initState({ iid: '42', type: 'story', host: 'gitlab.example', projectId: '1', workspaceRoot: '/workspace', runMode: 'full-auto', now: '2026-08-17T08:00:00Z' }),
      mode, selectedBy: '@owner', now: '2026-08-17T09:00:00Z',
    });
  }

  it('uses the persisted semi-auto selection at development entry and requires confirmation', () => {
    const state = selectMode('semi-auto');
    const result = runTransition(model, { ...developmentInput, runMode: state.runMode, runModeSelection: state.runModeSelection });

    expect(state.runModeSelection).toEqual({ mode: 'semi-auto', selectedAt: '2026-08-17T09:00:00Z', selectedBy: '@owner' });
    expect(result).toMatchObject({ validate: { ok: true }, modeSelectionRequired: false, shouldConfirm: true, plan: { ops: expect.any(Array) } });
    expect(result.preview).toContain('已持久化选择：@owner 于 2026-08-17T09:00:00Z');
  });

  it('uses the persisted full-auto selection to apply a non-hard development entry automatically', () => {
    const state = selectMode('full-auto');
    const result = runTransition(model, { ...developmentInput, runMode: state.runMode, runModeSelection: state.runModeSelection });

    expect(state.runModeSelection).toEqual({ mode: 'full-auto', selectedAt: '2026-08-17T09:00:00Z', selectedBy: '@owner' });
    expect(result).toMatchObject({ validate: { ok: true }, modeSelectionRequired: false, shouldConfirm: false, plan: { ops: expect.any(Array) } });
    expect(result.preview).toContain('护栏 ok 即可自动写回');
  });

  it('keeps a hard gate manually confirmed even after persisted full-auto selection', () => {
    const state = selectMode('full-auto');
    const hardGateInput: TransitionInput = {
      type: 'story', iid: 42, labels: ['type::story', 'story-status::待发布'], body, notes: [], state: 'opened',
      fields: { 发布日期: '2026-08-31', 研发Assignee: '@dev', 生产版本: 'v1', 发布记录或回滚信息: 'release record' },
      datesConfirmed: true, runMode: state.runMode, runModeSelection: state.runModeSelection,
    };

    const awaitingConfirmation = runTransition(model, hardGateInput);
    expect(awaitingConfirmation).toMatchObject({ validate: { ok: false }, shouldConfirm: true });
    expect(awaitingConfirmation.preview).toContain('hard_gate：必须人工确认');

    const confirmed = runTransition(model, { ...hardGateInput, humanConfirmed: true });
    expect(confirmed).toMatchObject({ validate: { ok: true }, shouldConfirm: true, plan: { ops: expect.any(Array) } });
  });
});

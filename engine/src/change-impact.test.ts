import { describe, expect, it } from 'vitest';
import { buildChangeClosePlan, buildChangeImpactPlan, validateChangeClose, validateChangeImpactClosure } from './change-impact.js';
import { validateTransition } from './guard.js';
import { loadModel, progressStepsFor } from './model.js';
import type { ChangeImpactInput, Payload } from './types.js';

const PLAN_V3 = `<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api
asset: TP-001 | scenario
-->`;
const PLAN_V4 = PLAN_V3.replace('plan-version: v3', 'plan-version: v4');

const input: ChangeImpactInput = {
  iid: 66,
  type: 'story',
  currentNode: '测试中',
  changeId: 'CI-20260825-001',
  proposer: '@dev',
  changeDate: '2026-08-25',
  source: 'technical-design',
  reason: '发现权限边界与已评审方案不一致',
  scopes: ['permission', 'frontend-route'],
  testPlan: PLAN_V3,
};

describe('change-impact closure', () => {
  it('derives all downstream artifacts and a safe return target without modifying status', () => {
    const { impact, plan } = buildChangeImpactPlan(input);
    expect(impact).toMatchObject({ returnTarget: '已评审', previousPlanVersion: 'v3' });
    expect(impact.requiredArtifacts).toEqual(['design', 'test-plan', 'apifox-assets', 'local-rerun', 'test-rerun']);
    expect(plan).toEqual({
      issueIid: 66,
      ops: [{ kind: 'add_comment', body: expect.stringContaining('status: open') }],
    });
    expect(plan.ops[0]).toMatchObject({ kind: 'add_comment' });
    expect((plan.ops[0] as { body: string }).body).toContain('return-target: 已评审');
  });

  it('blocks ordinary transition while an open impact receipt exists', () => {
    const { plan } = buildChangeImpactPlan(input);
    const notes = [{ body: (plan.ops[0] as { body: string }).body }];
    expect(validateChangeImpactClosure(notes)).toMatchObject({ ok: false, missing: ['changeImpact:CI-20260825-001'] });

    const payload: Payload = {
      type: 'story', from: '测试中', to: '待发布', testPlan: PLAN_V3,
      assigneeUser: '@dev', datesConfirmed: true,
      fields: {
        测试完成日期: '2026-08-25', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r',
        阻塞发布问题均已验证通过: '是', feature分支MR评审结论: '通过',
      },
    };
    const result = validateTransition(loadModel(), {
      labels: ['type::story', 'story-status::测试中'], body: '', state: 'opened', hasJiraSourceLabel: false,
    }, payload, notes);
    expect(result.ok).toBe(false);
    expect(result.reasons.join('\n')).toContain('未闭环变更影响单');
  });

  it('requires complete evidence and a strictly advanced test-plan version before closing', () => {
    const { plan } = buildChangeImpactPlan(input);
    const notes = [{ body: (plan.ops[0] as { body: string }).body }];
    const base = {
      iid: 66, changeId: input.changeId, closer: '@dev', closeDate: '2026-08-25', notes,
      completed: {
        design: 'design.md#permissions', 'test-plan': 'test-plan.md#v4', 'apifox-assets': 'audit:123',
        'local-rerun': 'run:local-123', 'test-rerun': 'run:test-123',
      },
    };
    expect(validateChangeClose({ ...base, testPlan: PLAN_V3 })).toMatchObject({ ok: false, missing: ['testPlan'] });
    expect(validateChangeClose({ ...base, completed: { ...base.completed, 'test-rerun': '' }, testPlan: PLAN_V4 }))
      .toMatchObject({ ok: false, missing: ['test-rerun'] });
    expect(validateChangeClose({ ...base, testPlan: PLAN_V4 })).toEqual({ ok: true, missing: [], reasons: [] });
  });

  it('emits a closed receipt that releases the same impact id', () => {
    const { plan } = buildChangeImpactPlan(input);
    const open = (plan.ops[0] as { body: string }).body;
    const close = buildChangeClosePlan({
      iid: 66, changeId: input.changeId, closer: '@dev', closeDate: '2026-08-25', notes: [{ body: open }], testPlan: PLAN_V4,
      completed: {
        design: 'design.md#permissions', 'test-plan': 'test-plan.md#v4', 'apifox-assets': 'audit:123',
        'local-rerun': 'run:local-123', 'test-rerun': 'run:test-123',
      },
    });
    const closed = (close.ops[0] as { body: string }).body;
    expect(closed).toContain('status: closed');
    expect(validateChangeImpactClosure([{ body: open }, { body: closed }])).toEqual({ ok: true, missing: [], reasons: [] });
  });

  it('releases a close receipt even when GitLab returns notes newest-first', () => {
    const { plan } = buildChangeImpactPlan(input);
    const open = (plan.ops[0] as { body: string }).body;
    const close = buildChangeClosePlan({
      iid: 66, changeId: input.changeId, closer: '@dev', closeDate: '2026-08-25', notes: [{ body: open }], testPlan: PLAN_V4,
      completed: {
        design: 'design.md#permissions', 'test-plan': 'test-plan.md#v4', 'apifox-assets': 'audit:123',
        'local-rerun': 'run:local-123', 'test-rerun': 'run:test-123',
      },
    });
    const closed = (close.ops[0] as { body: string }).body;
    expect(validateChangeImpactClosure([
      { id: 20, created_at: '2026-08-26T09:01:00Z', body: closed },
      { id: 10, created_at: '2026-08-25T09:01:00Z', body: open },
    ])).toEqual({ ok: true, missing: [], reasons: [] });
  });

  it('requires proposal plus schedule evidence for a requirement change', () => {
    const { impact } = buildChangeImpactPlan({
      ...input, currentNode: '开发中', source: 'requirement', scopes: ['functional', 'schedule'], testPlan: undefined,
    });
    expect(impact.requiredArtifacts).toEqual(['proposal', 'design', 'test-plan', 'apifox-assets', 'local-rerun', 'week-plan']);
    expect(impact.returnTarget).toBe('待评审');
  });

  it('lightweight close: derived T1/T2 skips the strict plan-version advance', () => {
    const { plan } = buildChangeImpactPlan({ ...input, scopes: ['frontend-copy'] });
    const notes = [{ body: (plan.ops[0] as { body: string }).body }];
    const base = {
      iid: 66, changeId: input.changeId, closer: '@dev', closeDate: '2026-08-25', notes, testPlan: PLAN_V3,
      completed: {
        design: 'design.md#permissions', 'test-plan': 'test-plan.md#unchanged', 'apifox-assets': 'audit:123',
        'local-rerun': 'run:local-123', 'test-rerun': 'run:test-123',
      },
    } as const;
    // 未传 tier：按 open 单 scopes（frontend-copy）推导 T1 → 轻量关闭仍工作。
    expect(validateChangeClose(base)).toEqual({ ok: true, missing: [], reasons: [] });
    // 与推导一致的自报 tier 放行。
    expect(validateChangeClose({ ...base, tier: 'T1' })).toEqual({ ok: true, missing: [], reasons: [] });
  });

  it('derives close tier from the open receipt scopes and rejects self-reported downgrade', () => {
    // open 单声明 data-model（T4）；客户端自报 T1 试图绕过版本递增。
    const { plan } = buildChangeImpactPlan({ ...input, scopes: ['data-model'] });
    const notes = [{ body: (plan.ops[0] as { body: string }).body }];
    const base = {
      iid: 66, changeId: input.changeId, closer: '@dev', closeDate: '2026-08-25', notes, testPlan: PLAN_V3,
      completed: {
        design: 'design.md#permissions', 'test-plan': 'test-plan.md#unchanged', 'apifox-assets': 'audit:123',
        'local-rerun': 'run:local-123', 'test-rerun': 'run:test-123',
      },
    } as const;
    expect(validateChangeClose({ ...base, tier: 'T1' })).toMatchObject({
      ok: false,
      missing: ['tier'],
      reasons: [expect.stringContaining('close tier 与 open 单 scopes 推导不符')],
    });
    // 不传 tier → 用推导值 T4：版本未前进仍拒绝。
    expect(validateChangeClose(base)).toMatchObject({ ok: false, missing: ['testPlan'] });
    expect(validateChangeClose({ ...base, testPlan: PLAN_V4 })).toEqual({ ok: true, missing: [], reasons: [] });
  });

  it('places the single shared test plan before coding and local self-test', () => {
    const model = loadModel();
    expect(progressStepsFor(model, '开发中')).toEqual(['技术方案', '测试计划', '编码实现', '本地自测', '代码评审']);
    expect(progressStepsFor(model, '测试中')).toEqual(['用例执行', '阻塞修复', '复测']);
  });
});

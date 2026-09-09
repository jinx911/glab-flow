import { describe, expect, it } from 'vitest';
import { parseLatestTestRun, parseTestPlan, renderTestRun, validateTestRun } from './test-run.js';

const planText = `# 测试计划

<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api,e2e
case: TP-002 | test | data,manual
case: TP-003 | local,test | unit
asset: TP-001 | scenario
data-prep: TP-002 | fixtures/realistic-customer-orders.sql | 华东客户合同续费订单数据 | shared-candidate
-->`;

const localRun = `<!-- glab-flow:test-run:v1
environment: local
plan-version: v3
outcome: passed
asset-audit: v3/local
cases: TP-001=passed,TP-003=passed
evidence: api=report:101,e2e=note:https://git.example/1,unit=phpunit:targeted
-->`;

const testRun = `<!-- glab-flow:test-run:v1
environment: test
plan-version: v3
outcome: passed
asset-audit: v3/test
cases: TP-001=passed,TP-002=passed,TP-003=passed
evidence: api=report:102,e2e=note:https://git.example/2,data=db:assertion,manual=video:https://git.example/2,unit=phpunit:targeted
-->`;

describe('test plan and environment execution receipts', () => {
  it('accepts independent complete local and test runs for one plan', () => {
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: localRun }, { body: testRun }], 'local'))).toEqual({ ok: true, errors: [] });
    expect(validateTestRun(parsed.plan, 'test', parseLatestTestRun([{ body: localRun }, { body: testRun }], 'test'))).toEqual({ ok: true, errors: [] });
  });

  it('rejects a missing required local case or method evidence', () => {
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const missingCase = localRun.replace('cases: TP-001=passed,TP-003=passed', 'cases:');
    const missingEvidence = localRun.replace('evidence: api=report:101,e2e=note:https://git.example/1,unit=phpunit:targeted', 'evidence: api=report:101');
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: missingCase }], 'local')).ok).toBe(false);
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: missingEvidence }], 'local')).errors).toContain('local 缺 e2e 执行证据');
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: missingEvidence }], 'local')).errors).toContain('local 缺 unit 执行证据');
  });

  it('rejects a stale plan version', () => {
    const parsed = parseTestPlan(planText.replace('plan-version: v3', 'plan-version: v4'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: localRun }], 'local')).errors[0]).toContain('版本不匹配');
  });

  it('does not fall back when the newest local run is malformed or failed', () => {
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const malformed = `<!-- glab-flow:test-run:v1\nenvironment: local\nplan-version: v3\n-->`;
    const failed = localRun.replace('outcome: passed', 'outcome: failed');
    expect(parseLatestTestRun([{ body: localRun }, { body: malformed }], 'local').kind).toBe('invalid-latest');
    expect(parseLatestTestRun([{ body: localRun }, { body: failed }], 'local').kind).toBe('invalid-latest');
  });

  it('uses GitLab created_at rather than newest-first API array order', () => {
    const older = localRun.replace('evidence: api=report:101', 'evidence: api=report:older');
    const latest = localRun.replace('evidence: api=report:101', 'evidence: api=report:latest');
    expect(parseLatestTestRun([
      { id: 20, created_at: '2026-08-26T09:01:00Z', body: latest },
      { id: 10, created_at: '2026-08-25T09:01:00Z', body: older },
    ], 'local')).toMatchObject({ kind: 'valid', run: { evidence: { api: 'report:latest' } } });
  });

  it('round-trips a rendered run and rejects unknown cases', () => {
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rendered = renderTestRun({
      environment: 'local', planVersion: 'v3', outcome: 'passed', assetAudit: 'v3/local',
      cases: { 'TP-001': 'passed', 'TP-003': 'passed' },
      evidence: { api: 'report:101', e2e: 'note:https://git.example/1', unit: 'phpunit:targeted' },
    });
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: rendered }], 'local'))).toEqual({ ok: true, errors: [] });
    const unexpected = rendered.replace('cases: TP-001=passed,TP-003=passed', 'cases: TP-001=passed,TP-003=passed,TP-999=passed');
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: unexpected }], 'local')).errors).toContain('local 记录含非本环境计划 case：TP-999');
  });

  it('never turns an untrusted failed runtime payload into a passing receipt', () => {
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rendered = renderTestRun({
      environment: 'local', planVersion: 'v3', outcome: 'failed', assetAudit: 'v3/local',
      cases: { 'TP-001': 'passed' }, evidence: { api: 'report:101', e2e: 'note:https://git.example/1' },
    });
    expect(rendered).toContain('outcome: failed');
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: rendered }], 'local')).ok).toBe(false);
  });

  it('requires a scenario declaration for every API case and a matching audit reference', () => {
    expect(parseTestPlan(planText.replace('asset: TP-001 | scenario\n', '')).ok).toBe(false);
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateTestRun(parsed.plan, 'local', parseLatestTestRun([{ body: localRun.replace('asset-audit: v3/local', 'asset-audit: v3/test') }], 'local')).errors)
      .toContain('local 测试执行记录未关联当前资产审计：应为 v3/local');
  });

  it('requires data-prep for data cases and rejects placeholder naming', () => {
    const missingPrep = parseTestPlan(planText.replace('data-prep: TP-002 | fixtures/realistic-customer-orders.sql | 华东客户合同续费订单数据 | shared-candidate\n', ''));
    expect(missingPrep.ok).toBe(false);
    if (!missingPrep.ok) expect(missingPrep.errors).toContain('case TP-002 的 data 测试必须声明 data-prep');

    const placeholder = parseTestPlan(planText.replace('华东客户合同续费订单数据', 'test-data'));
    expect(placeholder.ok).toBe(false);
    if (!placeholder.ok) expect(placeholder.errors.some((error) => error.includes('命名无效'))).toBe(true);
  });

  it('accepts script-managed cases without an Apifox asset audit', () => {
    const scriptPlan = `# 测试计划

<!-- glab-flow:test-plan:v1
plan-version: v4
case: TP-S01 | local,test | script
script: TP-S01 | scripts/leave-settlement.spec.ts | pnpm test:flow -- --case TP-S01
-->`;
    const parsed = parseTestPlan(scriptPlan);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.plan.cases[0]?.scripts).toEqual([{ path: 'scripts/leave-settlement.spec.ts', command: 'pnpm test:flow -- --case TP-S01' }]);
    const rendered = renderTestRun({
      environment: 'test',
      planVersion: 'v4',
      outcome: 'passed',
      cases: { 'TP-S01': 'passed' },
      evidence: { script: 'cmd:pnpm test:flow -- --env=test --case TP-S01' },
    });
    expect(rendered).not.toContain('asset-audit:');
    expect(validateTestRun(parsed.plan, 'test', parseLatestTestRun([{ body: rendered }], 'test'))).toEqual({ ok: true, errors: [] });
  });

  it('rejects script methods that are not tied to a managed relative script file', () => {
    expect(parseTestPlan('<!-- glab-flow:test-plan:v1\nplan-version: v1\ncase: TP-S01 | local | script\n-->')).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(['case TP-S01 的 script 测试必须声明 script 资产']),
    });
    const escaped = parseTestPlan('<!-- glab-flow:test-plan:v1\nplan-version: v1\ncase: TP-S01 | local | script\nscript: TP-S01 | ../tmp.spec.ts | pnpm test\n-->');
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) expect(escaped.errors.some((e) => e.includes('路径无效'))).toBe(true);
  });

  it('parses optional presentation and authentication declarations without changing v1 plans', () => {
    const governed = parseTestPlan(planText.replace('-->', 'presentation: TP-001 | scenario\nauth-profile: TP-001 | client-user\n-->'));
    expect(governed.ok).toBe(true);
    if (!governed.ok) return;
    expect(governed.plan.cases[0]).toMatchObject({ presentations: ['scenario'], authProfiles: ['client-user'] });
    expect(parseTestPlan(planText.replace('-->', 'presentation: TP-001 | test-data\n-->')).ok).toBe(false);
    expect(parseTestPlan(planText.replace('-->', 'auth-profile: TP-001 | client-user\nauth-profile: TP-001 | client-user\n-->')).ok).toBe(false);
  });
});

describe('AC 覆盖硬校验（Q1：漏 AC 映射=漏测，不再自律）', () => {
  const plan = (extra: string): string => `<!-- glab-flow:test-plan:v1\nplan-version: v1\nac-set: AC1,AC2\ncase: TP-001 | local | api\nasset: TP-001 | scenario\n${extra}-->`;
  it('rejects when an AC has no case mapping（漏测拦截）', () => {
    const r = parseTestPlan(plan('ac: TP-001 | AC1\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('AC2') && e.includes('漏测'))).toBe(true);
  });
  it('passes when every AC is mapped', () => {
    const r = parseTestPlan(plan('ac: TP-001 | AC1,AC2\n'));
    expect(r.ok).toBe(true);
  });
  it('rejects ac mapping to unknown case and out-of-set AC', () => {
    const r = parseTestPlan(plan('ac: TP-001 | AC1\nac: TP-999 | AC2\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('未知 case'))).toBe(true);
      expect(r.errors.some((e) => e.includes('AC2') && e.includes('漏测'))).toBe(true);
    }
  });
  it('legacy plan without ac-set still parses（存量兼容）', () => {
    const r = parseTestPlan('<!-- glab-flow:test-plan:v1\nplan-version: v1\ncase: TP-001 | local | api\nasset: TP-001 | scenario\n-->');
    expect(r.ok).toBe(true);
  });
  it('duplicate ac mapping rejected', () => {
    const r = parseTestPlan(plan('ac: TP-001 | AC1\nac: TP-001 | AC1,AC2\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('映射重复'))).toBe(true);
  });
});

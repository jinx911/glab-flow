import { describe, expect, it } from 'vitest';
import { parseLatestApifoxAssetAudit, renderApifoxAssetAudit, validateApifoxAssetAudit } from './asset-audit.js';
import { parseTestPlan } from './test-run.js';

const planText = `<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api,e2e
case: TP-002 | test | api,data
asset: TP-001 | scenario
asset: TP-001 | suite-or-group
asset: TP-002 | scenario
asset: TP-002 | test-data
-->`;

const localAudit = `<!-- glab-flow:apifox-asset-audit:v1
environment: local
plan-version: v3
project: 8731182
branch: main
unresolved-findings: 0
evidence: scenario:list-get:https://apifox.example/local
asset: TP-001 | scenario | scenario-101 | reuse
asset: TP-001 | suite-or-group | group-201 | reuse
-->`;

const testAudit = `<!-- glab-flow:apifox-asset-audit:v1
environment: test
plan-version: v3
project: 8731182
branch: main
unresolved-findings: 0
evidence: scenario:list-get:https://apifox.example/test
asset: TP-001 | scenario | scenario-101 | reuse
asset: TP-001 | suite-or-group | group-201 | reuse
asset: TP-002 | scenario | scenario-102 | create
asset: TP-002 | test-data | data-301 | create
-->`;

const governedPlanText = planText.replace('-->', 'presentation: TP-001 | scenario\nauth-profile: TP-001 | client-user\n-->');

const governedLocalAudit = `<!-- glab-flow:apifox-asset-audit:v2
environment: local
plan-version: v3
project: 8731182
branch: main
unresolved-findings: 0
evidence: list-get:https://apifox.example/local;report:255001
asset: TP-001 | scenario | scenario-101 | reuse
asset: TP-001 | suite-or-group | group-201 | reuse
presentation: TP-001 | scenario | local | local | local
auth-profile: TP-001 | client-user | auth_token
-->`;

describe('Apifox asset audit receipts', () => {
  it('accepts matching local and test audits for one versioned plan', () => {
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: localAudit }, { body: testAudit }], 'local'))).toEqual({ ok: true, errors: [] });
    expect(validateApifoxAssetAudit(parsed.plan, 'test', parseLatestApifoxAssetAudit([{ body: localAudit }, { body: testAudit }], 'test'))).toEqual({ ok: true, errors: [] });
  });

  it('rejects missing planned resources, unresolved findings and stale plans', () => {
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateApifoxAssetAudit(parsed.plan, 'test', parseLatestApifoxAssetAudit([{ body: testAudit.replace('asset: TP-002 | test-data | data-301 | create\n', '') }], 'test')).errors)
      .toContain('test Apifox 资产审计缺计划资产：TP-002/test-data');
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: localAudit.replace('unresolved-findings: 0', 'unresolved-findings: 2') }], 'local')).errors)
      .toContain('local Apifox 资产审计仍有 2 个未处置问题');
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: localAudit.replace('plan-version: v3', 'plan-version: v2') }], 'local')).errors[0])
      .toContain('计划版本不匹配');
  });

  it('does not fall back after a malformed latest audit and renders pure comment previews', () => {
    const parsed = parseTestPlan(planText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const malformed = `<!-- glab-flow:apifox-asset-audit:v1\nenvironment: local\nplan-version: v3\n-->`;
    expect(parseLatestApifoxAssetAudit([{ body: localAudit }, { body: malformed }], 'local').kind).toBe('invalid-latest');
    const rendered = renderApifoxAssetAudit({
      environment: 'local', planVersion: 'v3', project: '8731182', branch: 'main', unresolvedFindings: 0,
      evidence: 'scenario:list-get:https://apifox.example/local',
      assets: [
        { caseId: 'TP-001', type: 'scenario', id: 'scenario-101', action: 'reuse' },
        { caseId: 'TP-001', type: 'suite-or-group', id: 'group-201', action: 'reuse' },
      ],
    });
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: rendered }], 'local'))).toEqual({ ok: true, errors: [] });
  });

  it('uses GitLab created_at rather than newest-first API array order', () => {
    const older = localAudit.replace('plan-version: v3', 'plan-version: v2');
    const latest = localAudit.replace('evidence: scenario:list-get:https://apifox.example/local', 'evidence: scenario:list-get:https://apifox.example/local-v3');
    const parsed = parseLatestApifoxAssetAudit([
      { id: 20, created_at: '2026-08-26T09:01:00Z', body: latest },
      { id: 10, created_at: '2026-08-25T09:01:00Z', body: older },
    ], 'local');
    expect(parsed).toMatchObject({ kind: 'valid', audit: { planVersion: 'v3', evidence: 'scenario:list-get:https://apifox.example/local-v3' } });
  });

  it('requires v2 display and authentication evidence only when the plan declares it', () => {
    const parsed = parseTestPlan(governedPlanText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: localAudit }], 'local')).errors)
      .toContain('local 测试计划要求 Apifox 资产审计 v2');
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: governedLocalAudit }], 'local')))
      .toEqual({ ok: true, errors: [] });
  });

  it('blocks mismatched list/report environments and incomplete authentication receipts', () => {
    const parsed = parseTestPlan(governedPlanText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const displayMismatch = governedLocalAudit.replace('presentation: TP-001 | scenario | local | local | local', 'presentation: TP-001 | scenario | test | local | test');
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: displayMismatch }], 'local')).errors)
      .toContain('local Apifox 页面展示环境不一致：TP-001/scenario（预期 test，页面 local，报告 test）');
    const missingAuth = governedLocalAudit.replace('auth-profile: TP-001 | client-user | auth_token\n', '');
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: missingAuth }], 'local')).errors)
      .toContain('local Apifox 资产审计缺认证契约：TP-001/client-user');
    const invalidTokenVariable = governedLocalAudit.replace('auth-profile: TP-001 | client-user | auth_token', 'auth-profile: TP-001 | client-user | bearer.secret');
    expect(parseLatestApifoxAssetAudit([{ body: invalidTokenVariable }], 'local').kind).toBe('invalid-latest');
  });

  it('renders and round-trips a v2 preview without credential values', () => {
    const parsed = parseTestPlan(governedPlanText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rendered = renderApifoxAssetAudit({
      markerVersion: 'v2', environment: 'local', planVersion: 'v3', project: '8731182', branch: 'main', unresolvedFindings: 0,
      evidence: 'list-get:https://apifox.example/local;report:255001',
      assets: [
        { caseId: 'TP-001', type: 'scenario', id: 'scenario-101', action: 'reuse' },
        { caseId: 'TP-001', type: 'suite-or-group', id: 'group-201', action: 'reuse' },
      ],
      presentations: [{ caseId: 'TP-001', type: 'scenario', expectedEnvironment: 'local', displayedEnvironment: 'local', reportEnvironment: 'local' }],
      authProfiles: [{ caseId: 'TP-001', profile: 'client-user', tokenVariable: 'auth_token' }],
    });
    expect(rendered).toContain('glab-flow:apifox-asset-audit:v2');
    expect(rendered).toContain('auth-profile: TP-001 | client-user | auth_token');
    expect(rendered).not.toContain('password=');
    expect(validateApifoxAssetAudit(parsed.plan, 'local', parseLatestApifoxAssetAudit([{ body: rendered }], 'local')))
      .toEqual({ ok: true, errors: [] });
  });
});

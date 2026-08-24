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
});

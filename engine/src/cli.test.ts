import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = join(REPO_ROOT, 'engine', 'src', 'cli.ts');
const VALID_REVIEW_EVIDENCE = {
  images: [], frontend: { applicable: false, routes: [] },
  grilling: { coverage: ['目标与范围', '角色与权限', '业务规则与边界', '数据与兼容', '验收与多环境验证'], decisions: [], unresolved: [] },
};

/** 跑 CLI，stdin 喂 JSON，捕获 stdout（直接用 tsx，绕过 pnpm 的 script header 污染）。 */
function cli(command: 'validate' | 'render' | 'plan' | 'test-run' | 'asset-audit' | 'resource' | 'change' | 'reconcile', stdin: object): { json: unknown; status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [TSX_CLI, CLI, command], {
    input: JSON.stringify(stdin),
    encoding: 'utf8',
  });
  return { json: r.stdout ? JSON.parse(r.stdout) : null, status: r.status, stderr: r.stderr ?? '' };
}

describe('cli render — public comment fail-closed', () => {
  it('does not emit unsafe comment content on stdout', () => {
    const result = cli('render', {
      type: 'story', from: '草稿中', to: '待评审',
      fields: { 背景: '需求背景', 目标: '目标', 下一步: '使用 token=secret 完成验证' },
      assigneeUser: '@pm',
    });
    expect(result.status).toBe(1);
    expect(result.json).toBeNull();
    expect(result.stderr).toContain('正式状态评论包含内部执行证据');
  });
});

describe('cli plan — DU-aware transition projection', () => {
  it('uses supplied labels/DU and writes the projected target for skipped states', () => {
    const result = cli('plan', {
      iid: 88,
      labels: ['type::story', 'story-status::开发中'],
      payload: {
        type: 'story', from: '开发中', to: '测试中',
        fields: {
          代码评审结论: '通过', 提测日期: '2026-09-01', 研发Assignee: '@dev',
          可测试版本或环境: 'service:abc123', 测试说明: 'A/B 配置已核对',
          测试完成日期: '2026-09-01', 测试Assignee: '@qa', 测试结论: '通过',
          回归范围或证据: '受影响用例', 阻塞发布问题均已验证通过: '是',
        },
        assigneeUser: '@qa', datesConfirmed: true,
        testPlan: '<!-- glab-flow:test-plan:v1\nplan-version: v3\ncase: TP-001 | local | api\nasset: TP-001 | scenario\n-->',
      },
      config: { roles: { 研发: '@dev' } },
      du: {
        iid: 88, type: 'story', cachedNode: '开发中', affectedScopes: ['frontend-copy'],
        evidence: [
          { kind: 'asset-audit', environment: 'local', planVersion: 'v3', outcome: '0', recordedAt: '2026-09-01T00:00:00Z' },
          { kind: 'test-run', environment: 'local', planVersion: 'v3', outcome: 'passed', recordedAt: '2026-09-01T00:00:00Z', version: 'service:abc123' },
        ], resources: [], metricEvents: [], updatedAt: '2026-09-01T00:00:00Z',
        gateSet: {
          scopes: ['frontend-copy'], skipStates: ['测试中'], environments: ['local'],
          mrReview: false, regression: 'affected-cases', rollbackPlan: false, minUnitCases: 0, overrides: [],
        },
      },
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      ops: expect.arrayContaining([
        { kind: 'remove_label', value: 'story-status::开发中' },
        { kind: 'add_label', value: 'story-status::待发布' },
        { kind: 'set_assignee', username: '@dev' },
      ]),
    });
    expect(JSON.stringify(result.json)).toContain('待发布');
  });
});

describe('cli validate — body passthrough (G6b reachable, ⑩)', () => {
  // 待评审→已评审：requiredFields 齐 + gateOutcome 通过 + reviewType 需求评审 + 日期已确认；
  // 唯一变量是 assigneeUser 是否与「交付协同」表的研发角色一致（G6b 交叉校验）。
  const payload = (assignee: string) => ({
    type: 'story', from: '待评审', to: '已评审',
    fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
    reviewEvidence: VALID_REVIEW_EVIDENCE,
    gateOutcome: '通过', reviewType: '需求评审', assigneeUser: assignee, datesConfirmed: true,
  });
  const TABLE_BODY = '# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n';

  it('flags G6b mismatch when body present and assignee disagrees with table', () => {
    const { json, status } = cli('validate', {
      type: 'story', labels: ['type::story', 'story-status::待评审'], body: TABLE_BODY, payload: payload('@someone-else'),
    });
    expect(status).toBe(0);
    const g = json as { ok: boolean; reasons: string[] };
    expect(g.ok).toBe(false);
    expect(g.reasons.some((x) => x.includes('与交付协同表'))).toBe(true);
  });

  it('does NOT flag G6b when body omitted (back-compat: empty body skips cross-check)', () => {
    // 旧用法（无 body）→ G6b 跳过；@someone-else 是合法 @ 用户，仅过格式 G6 → ok
    const { json, status } = cli('validate', {
      type: 'story', labels: ['type::story', 'story-status::待评审'], payload: payload('@someone-else'),
    });
    expect(status).toBe(0);
    const g = json as { ok: boolean };
    expect(g.ok).toBe(true);
  });
});

describe('cli plan — transition-path validation', () => {
  it.each([
    ['草稿中', '已评审'],
    ['待评审', '开发中'],
  ])('rejects an invalid Story jump %s → %s before producing a WritePlan', (from, to) => {
    const { json, status } = cli('plan', {
      payload: { type: 'story', from, to, fields: {}, assigneeUser: '@dev' },
    });
    expect(status).toBe(1);
    expect(json).toMatchObject({ ok: false, reasons: [expect.stringContaining('not allowed')] });
    expect(json).not.toHaveProperty('ops');
  });
});

describe('cli versioned environment TestRun gates', () => {
  const plan = `<!-- glab-flow:test-plan:v1
plan-version: v3
case: TP-001 | local,test | api,e2e
asset: TP-001 | scenario
-->`;
  const localRun = `<!-- glab-flow:test-run:v1
environment: local
plan-version: v3
version: service:abc123
outcome: passed
asset-audit: v3/local
cases: TP-001=passed
evidence: api=report:101,e2e=note:https://git.example/local
-->`;
  const testRun = `<!-- glab-flow:test-run:v1
environment: test
plan-version: v3
version: service:abc123
outcome: passed
asset-audit: v3/test
cases: TP-001=passed
evidence: api=report:102,e2e=note:https://git.example/test
-->`;
  const localAudit = `<!-- glab-flow:apifox-asset-audit:v1
environment: local
plan-version: v3
project: 8731182
branch: main
unresolved-findings: 0
evidence: list-get:https://apifox.example/local
asset: TP-001 | scenario | scenario-101 | reuse
-->`;
  const testAudit = `<!-- glab-flow:apifox-asset-audit:v1
environment: test
plan-version: v3
project: 8731182
branch: main
unresolved-findings: 0
evidence: list-get:https://apifox.example/test
asset: TP-001 | scenario | scenario-101 | reuse
-->`;
  const submit = {
    type: 'story' as const, from: '开发中', to: '测试中',
    fields: { 代码评审结论: '通过', 提测日期: '2026-08-24', 研发Assignee: '@dev', 可测试版本或环境: 'service:abc123', 测试说明: 'A/B 配置已核对' },
    assigneeUser: '@qa', datesConfirmed: true,
  };
  const accept = {
    type: 'story' as const, from: '测试中', to: '待发布',
    fields: { 测试完成日期: '2026-08-24', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'report', 阻塞发布问题均已验证通过: '是', feature分支MR评审结论: '通过' },
    assigneeUser: '@dev', datesConfirmed: true,
  };

  it('enforces the same plan through legacy validate and plan commands', () => {
    expect(cli('validate', { type: 'story', labels: ['type::story', 'story-status::开发中'], payload: submit }).json).toMatchObject({ ok: false, missing: ['testPlan'] });
    expect(cli('plan', { payload: submit, testPlan: plan, notes: [{ body: localAudit }, { body: localRun }] })).toMatchObject({ status: 0, json: { ops: expect.any(Array) } });
    expect(cli('validate', { type: 'story', labels: ['type::story', 'story-status::测试中'], payload: accept, testPlan: plan, notes: [{ body: localAudit }, { body: localRun }] }).json)
      .toMatchObject({ ok: false, missing: expect.arrayContaining(['testAssetAudit', 'testTestRun']) });
    expect(cli('plan', { payload: accept, testPlan: plan, notes: [{ body: localAudit }, { body: localRun }, { body: testAudit }, { body: testRun }] })).toMatchObject({ status: 0, json: { ops: expect.any(Array) } });
  });

  it('renders a parseable TestRun preview without I/O', () => {
    const result = cli('test-run', {
      plan,
      run: { environment: 'local', planVersion: 'v3', version: 'service:abc123', outcome: 'passed', assetAudit: 'v3/local', cases: { 'TP-001': 'passed' }, evidence: { api: 'report:101', e2e: 'note:https://git.example/local' } },
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ validate: { ok: true }, comment: expect.stringContaining('glab-flow:test-run:v1') });
  });

  it('renders a parseable asset-audit preview without I/O', () => {
    const result = cli('asset-audit', {
      plan,
      audit: { environment: 'local', planVersion: 'v3', project: '8731182', branch: 'main', unresolvedFindings: 0, evidence: 'list-get:https://apifox.example/local', assets: [{ caseId: 'TP-001', type: 'scenario', id: 'scenario-101', action: 'reuse' }] },
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ validate: { ok: true }, comment: expect.stringContaining('glab-flow:apifox-asset-audit:v1') });
  });

  it('renders a v2 presentation and AuthProfile audit without credential values', () => {
    const governedPlan = plan.replace('-->', 'presentation: TP-001 | scenario\nauth-profile: TP-001 | client-user\n-->');
    const result = cli('asset-audit', {
      plan: governedPlan,
      audit: {
        markerVersion: 'v2', environment: 'local', planVersion: 'v3', project: '8731182', branch: 'main', unresolvedFindings: 0,
        evidence: 'list-get:https://apifox.example/local;report:255001',
        assets: [{ caseId: 'TP-001', type: 'scenario', id: 'scenario-101', action: 'reuse' }],
        presentations: [{ caseId: 'TP-001', type: 'scenario', expectedEnvironment: 'local', displayedEnvironment: 'local', reportEnvironment: 'local' }],
        authProfiles: [{ caseId: 'TP-001', profile: 'client-user', tokenVariable: 'auth_token' }],
      },
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ validate: { ok: true }, comment: expect.stringContaining('glab-flow:apifox-asset-audit:v2') });
    expect(JSON.stringify(result.json)).not.toContain('password');
  });
});

describe('cli resource — boundary validation', () => {
  const du = {
    iid: 88, type: 'story', cachedNode: '', affectedScopes: [], evidence: [],
    resources: [], metricEvents: [], updatedAt: '2026-09-01T00:00:00Z',
  };

  it('exits non-zero when register is missing entry (no silent {} garbage)', () => {
    const { status, stderr } = cli('resource', { du, op: 'register', now: '2026-09-01T00:00:00Z' });
    expect(status).toBe(1);
    expect(stderr).toContain('register requires entry');
  });

  it('exits non-zero when dispose targets an unknown resourceId (no silent no-op)', () => {
    const { status, stderr } = cli('resource', { du, op: 'dispose', resourceId: 'nope', disposal: 'deleted', now: '2026-09-01T00:00:00Z' });
    expect(status).toBe(1);
    expect(stderr).toContain('unknown resourceId');
  });

  it('exits non-zero when op is not one of register|check|cleanup|dispose', () => {
    const { status, stderr } = cli('resource', { du, op: 'purge', now: '2026-09-01T00:00:00Z' });
    expect(status).toBe(1);
    expect(stderr).toContain('resource:');
  });
});

describe('cli change / reconcile — boundary validation', () => {
  const du = {
    iid: 88, type: 'story', cachedNode: '开发中', affectedScopes: [], evidence: [],
    resources: [], metricEvents: [], updatedAt: '2026-09-01T00:00:00Z',
  };
  const changeInput = {
    iid: 88, type: 'story', currentNode: '开发中', changeId: 'C-1', proposer: '@dev',
    changeDate: '2026-09-01', source: 'implementation', reason: 'r', scopes: ['functional'],
  };

  it('change exits non-zero when du is missing (no silent ratchet skip)', () => {
    const { status, stderr } = cli('change', changeInput);
    expect(status).toBe(1);
    expect(stderr).toContain('change: du required');
  });

  it('reconcile exits non-zero when type is invalid', () => {
    const { status, stderr } = cli('reconcile', { type: 'epic', labels: [], state: 'opened', du });
    expect(status).toBe(1);
    expect(stderr).toContain('reconcile:');
  });

  it('reconcile exits non-zero when labels is not an array', () => {
    const { status, stderr } = cli('reconcile', { type: 'story', labels: 'story-status::开发中', state: 'opened', du });
    expect(status).toBe(1);
    expect(stderr).toContain('reconcile:');
  });

  it('reconcile exits non-zero when state is invalid', () => {
    const { status, stderr } = cli('reconcile', { type: 'story', labels: [], state: 'locked', du });
    expect(status).toBe(1);
    expect(stderr).toContain('reconcile:');
  });

  it('reconcile exits non-zero when du is missing', () => {
    const { status, stderr } = cli('reconcile', { type: 'story', labels: [], state: 'opened' });
    expect(status).toBe(1);
    expect(stderr).toContain('reconcile:');
  });
});

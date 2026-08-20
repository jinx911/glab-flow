import { describe, it, expect } from 'vitest';
import { parseTestConfig, buildTestContext } from './test-config.js';

const MD = `# test config

\`\`\`yaml
environments:
  local:
    apifox: { project: oa_platform, env: local }
    databases: { platform: local_platform, tenant: local_tenant_kn }
    frontend: { build: "pnpm build:backend", workdir: "/w", output: "/o" }
    test_data: { prefix: "E2E{iid}", cleanup_required: true, prohibited: [非E2E数据] }
    credentials: { account: "a@x.com", password: "pw" }
    web_url: "http://tenant.oa.com"
    desc: 本地
  test:
    apifox: { project: oa_platform, env: test }
    databases: { platform: test_platform }
    credentials: { account: "b@x.com", password: "pw2" }
apifox_projects:
  oa_platform: { project_id: 8731182, envs: { local: 48389105, test: 48357135 } }
  oa_service:  { project_id: 8372255, envs: { local: 46095111 } }
routes:
  - repos: [oa-platform, oa-frontend-intergration]
    apifox: oa_platform
  - repos: [oa-service, oa-gateway]
    apifox: oa_service
\`\`\`
`;

describe('parseTestConfig', () => {
  it('parses environments / apifoxProjects / routes', () => {
    const c = parseTestConfig(MD);
    expect(Object.keys(c.environments)).toEqual(['local', 'test']);
    expect(c.apifoxProjects.oa_platform?.projectId).toBe('8731182');
    expect(c.apifoxProjects.oa_service?.envs.local).toBe('46095111');
    expect(c.routes).toHaveLength(2);
  });
  it('rejects profile without apifox index', () => {
    const bad = '# t\n\n```yaml\nenvironments:\n  x:\n    desc: no index\napifox_projects: {}\nroutes: []\n```\n';
    expect(() => parseTestConfig(bad)).toThrow(/缺 apifox \{project, env\}/);
  });
  it('rejects empty environments', () => {
    const empty = '# t\n\n```yaml\nenvironments: {}\napifox_projects: {}\nroutes: []\n```\n';
    expect(() => parseTestConfig(empty)).toThrow(/environments 为空/);
  });
});

describe('buildTestContext', () => {
  const c = parseTestConfig(MD);

  it('#172 场景:oa-platform+前端 → oa_platform 项目,拼齐全部测试要素', () => {
    const ctx = buildTestContext(c, { env: 'local', repos: ['oa-platform', 'oa-frontend-intergration'], iid: 172 });
    expect(ctx.apifox).toMatchObject({ project: 'oa_platform', projectId: '8731182', envName: 'local', envId: '48389105' });
    expect(ctx.databases).toEqual({ platform: 'local_platform', tenant: 'local_tenant_kn' });
    expect(ctx.frontend.build).toBe('pnpm build:backend');
    expect(ctx.testData.prefix).toBe('E2E172');           // {iid} 已替换
    expect(ctx.testData.cleanupRequired).toBe(true);
    expect(ctx.credentials.account).toBe('a@x.com');
    expect(ctx.webUrl).toBe('http://tenant.oa.com');
    expect(ctx.warnings).toHaveLength(0);
  });

  it('Java 仓 → oa_service 项目(路由推导方向正确)', () => {
    const ctx = buildTestContext(c, { env: 'local', repos: ['oa-service'] });
    expect(ctx.apifox.project).toBe('oa_service');
    expect(ctx.apifox.envId).toBe('46095111');
  });

  it('未命中仓库 → warning,不阻断', () => {
    const ctx = buildTestContext(c, { env: 'local', repos: ['oa-platform', 'capital-parent'] });
    expect(ctx.apifox.project).toBe('oa_platform');
    expect(ctx.warnings.some((w) => w.includes('capital-parent'))).toBe(true);
  });

  it('环境 ID 缺失 → envId undefined + warning(oa_service 无 test 环境)', () => {
    const ctx = buildTestContext(c, { env: 'test', repos: ['oa-service'] });
    expect(ctx.apifox.project).toBe('oa_service');
    expect(ctx.apifox.envId).toBeUndefined();
  });

  it('不存在的环境 → 报可用清单', () => {
    expect(() => buildTestContext(c, { env: 'staging', repos: ['oa-platform'] })).toThrow(/可用: local, test/);
  });
});

describe('多项目与跨环境变量(issue 28)', () => {
  const FENCE = ['```yaml', ...[
    'environments:',
    '  local:',
    '    apifox: { project: oa_platform, env: local }',
    '    credentials:',
    '      account: "a@x.com"',
    '      password: "pw"',
    '      vars: { account: local_client_email, password: local_client_password }',
    '    login: { owner: oa_platform, endpoint: "/client/v1/login", token_var: x_client_token }',
    'apifox_projects:',
    '  oa_platform: { project_id: "8731182", envs: { local: "48389105" } }',
    '  oa_service:  { project_id: "8372255", envs: { local: "46095111" } }',
    'routes:',
    '  - repos: [oa-platform]',
    '    apifox: oa_platform',
    '  - repos: [oa-service, oa-gateway]',
    '    apifox: oa_service',
  ], '```'].join('\n');
  const c2 = parseTestConfig(`# t\n${FENCE}\n`);

  it('跨平台+Java 需求:apifoxTargets 含全部项目,逐项目有独立 envId', () => {
    const ctx = buildTestContext(c2, { env: 'local', repos: ['oa-platform', 'oa-service'] });
    expect(ctx.apifoxTargets.map((t) => t.project)).toEqual(['oa_platform', 'oa_service']);
    expect(ctx.apifoxTargets.map((t) => t.envId)).toEqual(['48389105', '46095111']);
    expect(ctx.apifox.project).toBe('oa_platform');
    expect(ctx.warnings.some((w) => w.includes('逐项目跑'))).toBe(true);
  });

  it('credentials.vars 解析(场景变量名映射)', () => {
    const ctx = buildTestContext(c2, { env: 'local', repos: ['oa-platform'] });
    expect(ctx.credentials.account).toBe('a@x.com');
    expect(ctx.credentials.vars?.account).toBe('local_client_email');
    expect(ctx.credentials.vars?.password).toBe('local_client_password');
  });

  it('login 契约解析(共用 PHP 登录 + token 变量)', () => {
    const ctx = buildTestContext(c2, { env: 'local', repos: ['oa-service'] });
    expect(ctx.login).toMatchObject({ owner: 'oa_platform', endpoint: '/client/v1/login', tokenVar: 'x_client_token' });
  });
});

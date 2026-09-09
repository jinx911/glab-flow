import { describe, it, expect } from 'vitest';
import { parseTestConfig, buildTestContext } from './test-config.js';

const MD = `# test config

\`\`\`yaml
environments:
  local:
    apifox: { project: sample_web, env: local }
    databases: { platform: local_platform, tenant: local_tenant }
    frontend: { build: "pnpm build:backend", workdir: "/w", output: "/o" }
    test_data:
      prefix: "E2E{iid}"
      cleanup_required: true
      prohibited: [非E2E数据]
      seed_files: [".glab-flow/{iid}/spec/fixtures/customer-orders.sql"]
      asset_retention: "promote-shared"
      realistic_naming: true
    credentials: { account: "a@x.com", password: "pw" }
    web_url: "http://app.local.test"
    desc: 本地
  test:
    apifox: { project: sample_web, env: test }
    databases: { platform: test_platform }
    credentials: { account: "b@x.com", password: "pw2" }
apifox_projects:
  sample_web: { project_id: 10001, envs: { local: 20001, test: 20002 } }
  sample_service:  { project_id: 10002, envs: { local: 20003 } }
routes:
  - repos: [web-app, frontend]
    apifox: sample_web
  - repos: [service-api, gateway]
    apifox: sample_service
\`\`\`
`;

describe('parseTestConfig', () => {
  it('parses environments / apifoxProjects / routes', () => {
    const c = parseTestConfig(MD);
    expect(Object.keys(c.environments)).toEqual(['local', 'test']);
    expect(c.apifoxProjects.sample_web?.projectId).toBe('10001');
    expect(c.apifoxProjects.sample_service?.envs.local).toBe('20003');
    expect(c.routes).toHaveLength(2);
  });
  it('accepts profile without apifox index for script-only testing', () => {
    const scriptOnly = '# t\n\n```yaml\nenvironments:\n  x:\n    desc: no index\napifox_projects: {}\nroutes: []\n```\n';
    expect(parseTestConfig(scriptOnly).environments.x?.apifox).toBeUndefined();
  });
  it('rejects empty environments', () => {
    const empty = '# t\n\n```yaml\nenvironments: {}\napifox_projects: {}\nroutes: []\n```\n';
    expect(() => parseTestConfig(empty)).toThrow(/environments 为空/);
  });
  it('rejects script runtime paths escaping managed workspace', () => {
    const absoluteRoot = '# t\n\n```yaml\nenvironments:\n  x:\n    scripts: { root: "/tmp/tests" }\nroutes: []\n```\n';
    const parentEnvFile = '# t\n\n```yaml\nenvironments:\n  x:\n    scripts: { env_file: "../secret.env" }\nroutes: []\n```\n';
    expect(() => parseTestConfig(absoluteRoot)).toThrow(/scripts\.root 路径无效/);
    expect(() => parseTestConfig(parentEnvFile)).toThrow(/scripts\.env_file 路径无效/);
  });
  it('rejects test data seed files escaping managed workspace or invalid retention', () => {
    const escapedSeed = '# t\n\n```yaml\nenvironments:\n  x:\n    test_data: { seed_files: ["../seed.sql"] }\nroutes: []\n```\n';
    const badRetention = '# t\n\n```yaml\nenvironments:\n  x:\n    test_data: { asset_retention: "drop" }\nroutes: []\n```\n';
    expect(() => parseTestConfig(escapedSeed)).toThrow(/test_data\.seed_files 路径无效/);
    expect(() => parseTestConfig(badRetention)).toThrow(/asset_retention 无效/);
  });
});

describe('buildTestContext', () => {
  const c = parseTestConfig(MD);

  it('Web 应用与前端改动路由到 sample_web 项目，并拼齐测试要素', () => {
    const ctx = buildTestContext(c, { env: 'local', repos: ['web-app', 'frontend'], iid: 172 });
    expect(ctx.apifox).toMatchObject({ project: 'sample_web', projectId: '10001', envName: 'local', envId: '20001' });
    expect(ctx.databases).toEqual({ platform: 'local_platform', tenant: 'local_tenant' });
    expect(ctx.frontend.build).toBe('pnpm build:backend');
    expect(ctx.testData.prefix).toBe('E2E172');           // {iid} 已替换
    expect(ctx.testData.cleanupRequired).toBe(true);
    expect(ctx.testData.seedFiles).toEqual(['.glab-flow/172/spec/fixtures/customer-orders.sql']);
    expect(ctx.testData.assetRetention).toBe('promote-shared');
    expect(ctx.testData.realisticNaming).toBe(true);
    expect(ctx.credentials.account).toBe('a@x.com');
    expect(ctx.webUrl).toBe('http://app.local.test');
    expect(ctx.warnings).toHaveLength(0);
  });

  it('服务仓路由到 sample_service 项目', () => {
    const ctx = buildTestContext(c, { env: 'local', repos: ['service-api'] });
    expect(ctx.apifox?.project).toBe('sample_service');
    expect(ctx.apifox?.envId).toBe('20003');
  });

  it('未命中仓库 → warning,不阻断', () => {
    const ctx = buildTestContext(c, { env: 'local', repos: ['web-app', 'unmapped-repo'] });
    expect(ctx.apifox?.project).toBe('sample_web');
    expect(ctx.warnings.some((w) => w.includes('unmapped-repo'))).toBe(true);
  });

  it('环境 ID 缺失 → envId undefined + warning（sample_service 无 test 环境）', () => {
    const ctx = buildTestContext(c, { env: 'test', repos: ['service-api'] });
    expect(ctx.apifox?.project).toBe('sample_service');
    expect(ctx.apifox?.envId).toBeUndefined();
  });

  it('不存在的环境 → 报可用清单', () => {
    expect(() => buildTestContext(c, { env: 'staging', repos: ['web-app'] })).toThrow(/可用: local, test/);
  });
});

describe('多项目与跨环境变量(issue 28)', () => {
  const FENCE = ['```yaml', ...[
    'environments:',
    '  local:',
    '    apifox: { project: sample_web, env: local }',
    '    credentials:',
    '      account: "a@x.com"',
    '      password: "pw"',
    '      vars: { account: local_client_email, password: local_client_password }',
    '    login: { owner: sample_web, endpoint: "/api/login", token_var: access_token }',
    'apifox_projects:',
    '  sample_web: { project_id: "10001", envs: { local: "20001" } }',
    '  sample_service:  { project_id: "10002", envs: { local: "20003" } }',
    'routes:',
    '  - repos: [web-app]',
    '    apifox: sample_web',
    '  - repos: [service-api, gateway]',
    '    apifox: sample_service',
  ], '```'].join('\n');
  const c2 = parseTestConfig(`# t\n${FENCE}\n`);

  it('跨项目需求：apifoxTargets 含全部项目，逐项目有独立 envId', () => {
    const ctx = buildTestContext(c2, { env: 'local', repos: ['web-app', 'service-api'] });
    expect(ctx.apifoxTargets.map((t) => t.project)).toEqual(['sample_web', 'sample_service']);
    expect(ctx.apifoxTargets.map((t) => t.envId)).toEqual(['20001', '20003']);
    expect(ctx.apifox?.project).toBe('sample_web');
    expect(ctx.warnings.some((w) => w.includes('逐项目跑'))).toBe(true);
  });

  it('credentials.vars 解析(场景变量名映射)', () => {
    const ctx = buildTestContext(c2, { env: 'local', repos: ['web-app'] });
    expect(ctx.credentials.account).toBe('a@x.com');
    expect(ctx.credentials.vars?.account).toBe('local_client_email');
    expect(ctx.credentials.vars?.password).toBe('local_client_password');
  });

  it('login 契约解析（共用登录 + token 变量）', () => {
    const ctx = buildTestContext(c2, { env: 'local', repos: ['service-api'] });
    expect(ctx.login).toMatchObject({ owner: 'sample_web', endpoint: '/api/login', tokenVar: 'access_token' });
  });
});

describe('脚本测试上下文', () => {
  const SCRIPT_MD = `# t

\`\`\`yaml
environments:
  local:
    databases: { platform: local_platform }
    test_data:
      prefix: "E2E{iid}L"
      cleanup_required: true
      seed_files: [".glab-flow/{iid}/spec/fixtures/script-flow.sql"]
      asset_retention: "preserve"
      realistic_naming: true
    web_url: "http://app.local.test"
    scripts:
      root: ".glab-flow/{iid}/tests/{env}"
      command: "pnpm test:flow -- --issue={iid} --env={env}"
      env_file: ".glab-flow/{iid}/env/{env}.env"
      variables: { BASE_URL: "http://app.local.test", TEST_DATA_PREFIX: "E2E{iid}L" }
routes:
  - repos: [web-app]
\`\`\`
`;

  it('纯脚本路由不要求 Apifox 项目,并输出可复跑脚本上下文', () => {
    const ctx = buildTestContext(parseTestConfig(SCRIPT_MD), { env: 'local', repos: ['web-app'], iid: 88 });
    expect(ctx.apifox).toBeUndefined();
    expect(ctx.apifoxTargets).toEqual([]);
    expect(ctx.scripts).toEqual({
      root: '.glab-flow/88/tests/local',
      command: 'pnpm test:flow -- --issue=88 --env=local',
      envFile: '.glab-flow/88/env/local.env',
      variables: { BASE_URL: 'http://app.local.test', TEST_DATA_PREFIX: 'E2E88L' },
    });
    expect(ctx.testData.seedFiles).toEqual(['.glab-flow/88/spec/fixtures/script-flow.sql']);
    expect(ctx.testData.assetRetention).toBe('preserve');
    expect(ctx.resolution.scriptOnlyRoutes).toEqual(['web-app']);
    expect(ctx.resolution.unmatchedRepos).toEqual([]);
  });
});

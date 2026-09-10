import { describe, expect, it } from 'vitest';
import { buildTestContext, parseTestConfig } from './test-config.js';

const MD = `# test config

\`\`\`yaml
environments:
  local:
    databases: { platform: local_platform, tenant: local_tenant }
    frontend: { build: "pnpm build:backend", workdir: "apps/web", output: "dist" }
    test_data:
      prefix: "E2E{iid}L"
      cleanup_required: true
      prohibited: [非E2E数据]
      seed_files: [".glab-flow/{iid}/spec/fixtures/kn-contract-renewal.sql"]
      asset_retention: "promote-shared"
      realistic_naming: true
    credentials:
      account: "KN1001"
      password: "pw"
      vars: { account: TEST_EMPLOYEE_NO, password: TEST_PASSWORD }
    login: { owner: oa-platform, endpoint: "/api/login", token_var: access_token }
    web_url: "http://app.local.test"
    scripts:
      root: ".glab-flow/{iid}/tests/{env}"
      command: "pnpm test:flow -- --issue={iid} --env={env}"
      env_file: ".glab-flow/{iid}/env/{env}.env"
      variables: { BASE_URL: "http://app.local.test", TENANT: "KN", EMPLOYEE_NO: "KN1001" }
    desc: 本地
  test:
    databases: { platform: test_platform, tenant: test_tenant }
    credentials: { account: "KN1002", password: "pw2" }
    scripts:
      root: ".glab-flow/{iid}/tests/{env}"
      command: "pnpm test:flow -- --issue={iid} --env={env}"
      variables: { BASE_URL: "https://app.test.example", TENANT: "KN", EMPLOYEE_NO: "KN1002" }
routes:
  - repos: [web-app, frontend]
    target: web-flow
  - repos: [service-api, gateway]
    target: service-flow
\`\`\`
`;

describe('parseTestConfig', () => {
  it('parses environments and script-first routes', () => {
    const c = parseTestConfig(MD);
    expect(Object.keys(c.environments)).toEqual(['local', 'test']);
    expect(c.routes).toEqual([
      { repos: ['web-app', 'frontend'], target: 'web-flow' },
      { repos: ['service-api', 'gateway'], target: 'service-flow' },
    ]);
  });

  it('rejects empty environments', () => {
    const empty = '# t\n\n```yaml\nenvironments: {}\nroutes: []\n```\n';
    expect(() => parseTestConfig(empty)).toThrow(/environments 为空/);
  });

  it('rejects paths escaping managed workspace', () => {
    const absoluteRoot = '# t\n\n```yaml\nenvironments:\n  x:\n    scripts: { root: "/tmp/tests" }\nroutes: []\n```\n';
    const parentEnvFile = '# t\n\n```yaml\nenvironments:\n  x:\n    scripts: { env_file: "../secret.env" }\nroutes: []\n```\n';
    const escapedSeed = '# t\n\n```yaml\nenvironments:\n  x:\n    test_data: { seed_files: ["../seed.sql"] }\nroutes: []\n```\n';
    expect(() => parseTestConfig(absoluteRoot)).toThrow(/scripts\.root 路径无效/);
    expect(() => parseTestConfig(parentEnvFile)).toThrow(/scripts\.env_file 路径无效/);
    expect(() => parseTestConfig(escapedSeed)).toThrow(/test_data\.seed_files 路径无效/);
  });

  it('rejects invalid test data retention', () => {
    const badRetention = '# t\n\n```yaml\nenvironments:\n  x:\n    test_data: { asset_retention: "drop" }\nroutes: []\n```\n';
    expect(() => parseTestConfig(badRetention)).toThrow(/asset_retention 无效/);
  });
});

describe('buildTestContext', () => {
  const c = parseTestConfig(MD);

  it('builds reproducible script context with real business identifiers', () => {
    const ctx = buildTestContext(c, { env: 'local', repos: ['web-app', 'frontend'], iid: 172 });
    expect(ctx.resolution).toEqual({ repos: ['web-app', 'frontend'], matchedRoutes: ['web-flow'], unmatchedRepos: [] });
    expect(ctx.databases).toEqual({ platform: 'local_platform', tenant: 'local_tenant' });
    expect(ctx.frontend.build).toBe('pnpm build:backend');
    expect(ctx.testData.prefix).toBe('E2E172L');
    expect(ctx.testData.seedFiles).toEqual(['.glab-flow/172/spec/fixtures/kn-contract-renewal.sql']);
    expect(ctx.credentials.account).toBe('KN1001');
    expect(ctx.credentials.vars?.account).toBe('TEST_EMPLOYEE_NO');
    expect(ctx.login).toMatchObject({ owner: 'oa-platform', endpoint: '/api/login', tokenVar: 'access_token' });
    expect(ctx.webUrl).toBe('http://app.local.test');
    expect(ctx.scripts).toEqual({
      root: '.glab-flow/172/tests/local',
      command: 'pnpm test:flow -- --issue=172 --env=local',
      envFile: '.glab-flow/172/env/local.env',
      variables: { BASE_URL: 'http://app.local.test', TENANT: 'KN', EMPLOYEE_NO: 'KN1001' },
    });
    expect(ctx.warnings).toHaveLength(0);
  });

  it('warns on unmapped repositories without blocking context generation', () => {
    const ctx = buildTestContext(c, { env: 'local', repos: ['web-app', 'unmapped-repo'] });
    expect(ctx.resolution.matchedRoutes).toEqual(['web-flow']);
    expect(ctx.warnings.some((w) => w.includes('unmapped-repo'))).toBe(true);
  });

  it('reports available environments when env is unknown', () => {
    expect(() => buildTestContext(c, { env: 'staging', repos: ['web-app'] })).toThrow(/可用: local, test/);
  });
});

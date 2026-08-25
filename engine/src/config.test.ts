import { describe, it, expect } from 'vitest';
import { parseConfig } from './config.js';

const VALID = [
  '# glab-flow config',
  '',
  '```yaml',
  'gitlab:',
  '  host: gitlab.example.test',
  '  project_id: "100"',
  'workspace:',
  '  root: /tmp/workspace',
  '```',
  '',
].join('\n');

describe('parseConfig', () => {
  it('parses required fields and applies defaults', () => {
    const c = parseConfig(VALID);
    expect(c.gitlab.host).toBe('gitlab.example.test');
    expect(c.gitlab.projectId).toBe('100');
    expect(c.workspace.root).toBe('/tmp/workspace');
    expect(c.runMode).toBe('semi-auto');
    expect(c.branchNaming.format).toBe('{type}/{iid}');
    expect(c.branchNaming.typeMap).toEqual({ story: 'feat', bug: 'fix' });
  });


  it('throws when no yaml block present', () => {
    expect(() => parseConfig('# just markdown, no yaml')).toThrow(/yaml/);
  });

  it('throws when required fields missing', () => {
    expect(() => parseConfig('```yaml\nrun_mode: full-auto\n```')).toThrow(/missing required/);
  });

  it('maps full-auto, deploy_branch, jenkins with defaults', () => {
    const md = '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\nrun_mode: full-auto\ndeploy_branch: test\njenkins: { job_name: sample-service }\n```';
    const c = parseConfig(md);
    expect(c.runMode).toBe('full-auto');
    expect(c.deployBranch).toBe('test');
    expect(c.jenkins?.jobName).toBe('sample-service');
    expect(c.jenkins?.branchParam).toBe('branch');
    expect(c.jenkins?.defaultParams).toEqual({});
  });

  it('accepts project_path as fallback for project_id', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_path: "group/project" }\nworkspace: { root: /r }\n```');
    expect(c.gitlab.projectId).toBe('group/project');
  });

  it('throws a clean error when yaml block parses to null (empty or `null`)', () => {
    expect(() => parseConfig('```yaml\nnull\n```')).toThrow(/did not parse to an object/);
    expect(() => parseConfig('```yaml\n\n```')).toThrow(/did not parse to an object/);
  });

  it('coerces unquoted numeric project_id to string', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_id: 3915 }\nworkspace: { root: /r }\n```');
    expect(c.gitlab.projectId).toBe('3915');
  });

  it('maps databases and secure test environment profiles', () => {
    const md = [
      '```yaml',
      'gitlab: { host: h, project_id: "1" }',
      'workspace: { root: /r }',
      'databases:',
      '  main: { mcp: mcp__db__q, desc: 主库 }',
      'test_environments:',
      '  local:',
      '    url: http://app.local.test',
      '    runtime: local-docker',
      '    login: { credential_ref: local_admin, role: "管理员" }',
      '    data:',
      '      platform: { database_ref: local_platform }',
      '      default_tenant: { website: app.local.test, database_ref: local_tenant }',
      '    frontend:',
      '      build:',
      '        required: true',
      '        command: pnpm build:backend',
      '        workdir: /workspace/frontend',
      '        output_dir: /workspace/platform/public/frontend',
      '```',
    ].join('\n');
    const c = parseConfig(md);
    expect(c.databases?.main).toEqual({ mcp: 'mcp__db__q', desc: '主库' });
    expect(c.testEnvironments?.local).toEqual({
      url: 'http://app.local.test',
      runtime: 'local-docker',
      login: { credentialRef: 'local_admin', role: '管理员' },
      data: {
        platform: { databaseRef: 'local_platform' },
        defaultTenant: { website: 'app.local.test', databaseRef: 'local_tenant' },
      },
      frontend: {
        build: {
          required: true,
          command: 'pnpm build:backend',
          workdir: '/workspace/frontend',
          outputDir: '/workspace/platform/public/frontend',
        },
      },
    });
  });

  it('maps explicitly configured environment credentials', () => {
    const md = '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\ntest_environments:\n  local: { url: http://x, account: user, password: secret }\n```';
    expect(parseConfig(md).testEnvironments?.local).toEqual({ url: 'http://x', account: 'user', password: 'secret' });
  });

  it('maps Apifox project routing with distinct local and test environments', () => {
    const md = [
      '```yaml',
      'gitlab: { host: h, project_id: "1" }',
      'workspace: { root: /r }',
      'apifox:',
      '  projects:',
      '    sample_web:',
      '      project_id: "10001"',
      '      branch: main',
      '      environments:',
      '        local: { name: "本地环境", base_url: "http://app.local.test" }',
      '        test: { id: "20002", name: "Test", base_url: "https://test.example.com" }',
      '```',
    ].join('\n');

    expect(parseConfig(md).apifox?.projects.sample_web).toEqual({
      projectId: '10001',
      branch: 'main',
      environments: {
        local: { name: '本地环境', baseUrl: 'http://app.local.test' },
        test: { id: '20002', name: 'Test', baseUrl: 'https://test.example.com' },
      },
    });
  });

  it('passes through gitlab.harness_clone when present', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_id: "1", harness_clone: "/p/harness" }\nworkspace: { root: /r }\n```');
    expect(c.gitlab.harnessClone).toBe('/p/harness');
  });

  it('defaults an unknown run_mode to semi-auto', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\nrun_mode: bogus\n```');
    expect(c.runMode).toBe('semi-auto');
  });

  it('parses roles default mapping', () => {
    const md = '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\nroles:\n  产品: "@a"\n  研发: "@b"\n  测试: "@c"\n```';
    const c = parseConfig(md);
    expect(c.roles).toEqual({ 产品: '@a', 研发: '@b', 测试: '@c' });
  });

  it('parses multi-repo jenkins.jobs and keeps single jobName compatible', () => {
    const md = [
      '```yaml',
      'gitlab: { host: h, project_id: "1" }',
      'workspace: { root: /r }',
      'jenkins:',
      '  job_name: sample-service',
      '  jobs:',
      '    sample-service: { job_name: sample-service, branch_param: branch }',
      '    sample-frontend: { job_name: sample-frontend, branch_param: GIT_BRANCH, env_param: DEPLOY_ENV, default_params: { RUN_LINT: "true" } }',
      '```',
    ].join('\n');
    const c = parseConfig(md);
    expect(c.jenkins?.jobName).toBe('sample-service');
    expect(c.jenkins?.branchParam).toBe('branch');
    expect(c.jenkins?.jobs?.['sample-frontend']).toEqual({
      jobName: 'sample-frontend',
      branchParam: 'GIT_BRANCH',
      envParam: 'DEPLOY_ENV',
      defaultParams: { RUN_LINT: 'true' },
    });
  });

  it('enables jenkins on jobs-only config (no single job_name)', () => {
    const md = '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\njenkins:\n  jobs:\n    sample-service: { job_name: sample-service }\n```';
    const c = parseConfig(md);
    expect(c.jenkins?.jobName).toBeUndefined();
    expect(c.jenkins?.jobs?.['sample-service']?.jobName).toBe('sample-service');
    expect(c.jenkins?.branchParam).toBe('branch');
  });

  it('does not enable jenkins when neither job_name nor jobs present', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\njenkins: { branch_param: x }\n```');
    expect(c.jenkins).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { parseConfig } from './config.js';

const VALID = [
  '# glab-flow config',
  '',
  '```yaml',
  'gitlab:',
  '  host: git.kuainiujinke.com',
  '  project_id: "3915"',
  'workspace:',
  '  root: /tmp/oa',
  '```',
  '',
].join('\n');

describe('parseConfig', () => {
  it('parses required fields and applies defaults', () => {
    const c = parseConfig(VALID);
    expect(c.gitlab.host).toBe('git.kuainiujinke.com');
    expect(c.gitlab.projectId).toBe('3915');
    expect(c.workspace.root).toBe('/tmp/oa');
    expect(c.runMode).toBe('semi-auto');
    expect(c.branchNaming.format).toBe('{type}/{iid}');
    expect(c.branchNaming.typeMap).toEqual({ story: 'feat', bug: 'fix' });
  });

  it('parses optional repos list', () => {
    const md = ['# cfg', '', '```yaml', 'gitlab:', '  host: h', '  project_id: "1"', 'workspace:', '  root: /r', 'repos:', '  - oa/oa-service', '  - oa/oa-frontend', '```', ''].join('\n');
    expect(parseConfig(md).repos).toEqual(['oa/oa-service', 'oa/oa-frontend']);
  });

  it('throws when no yaml block present', () => {
    expect(() => parseConfig('# just markdown, no yaml')).toThrow(/yaml/);
  });

  it('throws when required fields missing', () => {
    expect(() => parseConfig('```yaml\nrun_mode: full-auto\n```')).toThrow(/missing required/);
  });

  it('maps full-auto, deploy_branch, jenkins with defaults', () => {
    const md = '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\nrun_mode: full-auto\ndeploy_branch: test\njenkins: { job_name: oa-service }\n```';
    const c = parseConfig(md);
    expect(c.runMode).toBe('full-auto');
    expect(c.deployBranch).toBe('test');
    expect(c.jenkins?.jobName).toBe('oa-service');
    expect(c.jenkins?.branchParam).toBe('oa_branch');
    expect(c.jenkins?.defaultParams).toEqual({});
  });

  it('accepts project_path as fallback for project_id', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_path: "oa/oa" }\nworkspace: { root: /r }\n```');
    expect(c.gitlab.projectId).toBe('oa/oa');
  });

  it('throws a clean error when yaml block parses to null (empty or `null`)', () => {
    expect(() => parseConfig('```yaml\nnull\n```')).toThrow(/did not parse to an object/);
    expect(() => parseConfig('```yaml\n\n```')).toThrow(/did not parse to an object/);
  });

  it('coerces unquoted numeric project_id to string', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_id: 3915 }\nworkspace: { root: /r }\n```');
    expect(c.gitlab.projectId).toBe('3915');
  });

  it('maps databases and test_environments with defaults', () => {
    const md = '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\ndatabases:\n  main: { mcp: mcp__db__q, desc: 主库 }\ntest_environments:\n  default: { url: http://x, account: a }\n```';
    const c = parseConfig(md);
    expect(c.databases?.main).toEqual({ mcp: 'mcp__db__q', desc: '主库' });
    expect(c.testEnvironments?.default).toEqual({ url: 'http://x', account: 'a' });
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
      '  job_name: oa-service',
      '  jobs:',
      '    oa-service: { job_name: oa-service, branch_param: oa_branch }',
      '    oa-frontend: { job_name: oa-frontend, branch_param: GIT_BRANCH, env_param: DEPLOY_ENV, default_params: { RUN_LINT: "true" } }',
      '```',
    ].join('\n');
    const c = parseConfig(md);
    expect(c.jenkins?.jobName).toBe('oa-service');
    expect(c.jenkins?.branchParam).toBe('oa_branch');
    expect(c.jenkins?.jobs?.['oa-frontend']).toEqual({
      jobName: 'oa-frontend',
      branchParam: 'GIT_BRANCH',
      envParam: 'DEPLOY_ENV',
      defaultParams: { RUN_LINT: 'true' },
    });
  });

  it('enables jenkins on jobs-only config (no single job_name)', () => {
    const md = '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\njenkins:\n  jobs:\n    oa-service: { job_name: oa-service }\n```';
    const c = parseConfig(md);
    expect(c.jenkins?.jobName).toBeUndefined();
    expect(c.jenkins?.jobs?.['oa-service']?.jobName).toBe('oa-service');
    expect(c.jenkins?.branchParam).toBe('oa_branch');
  });

  it('does not enable jenkins when neither job_name nor jobs present', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\njenkins: { branch_param: x }\n```');
    expect(c.jenkins).toBeUndefined();
  });
});

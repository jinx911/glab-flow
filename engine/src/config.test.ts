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
});

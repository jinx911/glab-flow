import { describe, it, expect } from 'vitest';
import { glabApi, buildArgs, glabHost, type GlabRunner } from './glab.js';

describe('buildArgs', () => {
  it('builds GET args with hostname + method + path', () => {
    expect(buildArgs('GET', 'projects/3915/issues/123', {}, 'git.kuainiujinke.com')).toEqual([
      'api', '--hostname', 'git.kuainiujinke.com', '--method', 'GET', 'projects/3915/issues/123',
    ]);
  });
  it('appends --raw-field for each field', () => {
    const a = buildArgs('PUT', 'projects/3915/issues/123', { add_labels: 'x,y', state_event: 'close' }, 'git.kuainiujinke.com');
    expect(a).toContain('--raw-field');
    expect(a).toContain('add_labels=x,y');
    expect(a).toContain('state_event=close');
    expect(a[a.length - 1]).toBe('projects/3915/issues/123');
  });
});

describe('glabApi', () => {
  it('parses JSON returned by the runner', async () => {
    const runner: GlabRunner = async () => '{"iid":123,"state":"opened","labels":["x"]}';
    const r = await glabApi<{ iid: number }>('GET', 'projects/3915/issues/123', {}, { runner });
    expect(r.iid).toBe(123);
  });
  it('returns {} for empty stdout', async () => {
    const runner: GlabRunner = async () => '';
    const r = await glabApi('DELETE' as 'GET', 'x', {}, { runner });
    expect(r).toEqual({});
  });
  it('passes the runner the built argv', async () => {
    let got: string[] = [];
    const runner: GlabRunner = async (args) => { got = args; return '{}'; };
    await glabApi('PUT', 'p', { k: 'v' }, { runner, host: 'git.kuainiujinke.com' });
    expect(got).toEqual(['api', '--hostname', 'git.kuainiujinke.com', '--method', 'PUT', '--raw-field', 'k=v', 'p']);
  });
  it('retries on runner failure then succeeds', async () => {
    let calls = 0;
    const runner: GlabRunner = async () => {
      calls++;
      if (calls < 2) throw new Error('net');
      return '{"ok":true}';
    };
    const r = await glabApi<{ ok: boolean }>('GET', 'p', {}, { runner });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('glabHost', () => {
  it('defaults to git.kuainiujinke.com', () => {
    const saved = process.env.GLAB_FLOW_HOST;
    delete process.env.GLAB_FLOW_HOST;
    expect(glabHost()).toBe('git.kuainiujinke.com');
    if (saved !== undefined) process.env.GLAB_FLOW_HOST = saved;
  });
});

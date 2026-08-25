import { describe, expect, it } from 'vitest';
import { progressCommand, runModeSelectCommand, stateWritebackCommand } from './cli-commands.js';
import type { RunModeSelectCommandInput } from './cli-commands.js';
import { initState } from './state.js';

const base = initState({ iid: '1', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/r', now: 't0' });

describe('CLI state command handlers', () => {
  it('progress 标记子步骤 done(幂等,返回 RunState)', () => {
    const output = progressCommand({ state: { ...base, progress: { node: '已评审', done: [] } }, step: '技术方案 design.md', now: 't2' });
    expect(output).toMatchObject({ progress: { node: '已评审', done: ['技术方案 design.md'] } });
  });

  it('progress resetToNode 重置进度', () => {
    const output = progressCommand({ state: base, resetToNode: '开发中', now: 't1' });
    expect(output).toMatchObject({ progress: { node: '开发中', done: [] } });
  });

  it('returns the state-writeback state directly', () => {
    const output = stateWritebackCommand({
      state: base,
      audit: { target: 'issue', stage: 'metadata', status: 'succeeded', detail: 'labels read back' },
      now: 't1',
    });
    expect(output.writebackAudit).toEqual([{ target: 'issue', stage: 'metadata', status: 'succeeded', detail: 'labels read back', at: 't1' }]);
  });

  it('resumes legacy persisted state through CLI commands with writebackAudit defaulted', () => {
    const legacy = { ...base } as Partial<typeof base>;
    delete legacy.writebackAudit;
    const resumed = progressCommand({ state: legacy as typeof base, resetToNode: '开发中', now: 't1' });
    expect(resumed).toMatchObject({ progress: { node: '开发中', done: [] }, writebackAudit: [] });
    expect(progressCommand({ state: legacy as typeof base, now: 't1' })).toMatchObject({ writebackAudit: [] });
    expect(stateWritebackCommand({ state: legacy as typeof base, audit: { target: 'issue', stage: 'metadata', status: 'succeeded', detail: 'read back' }, now: 't1' }).writebackAudit).toHaveLength(1);
  });
});

describe('run-mode-select command handler', () => {
  it('trims and persists the first selection', () => {
    const output = runModeSelectCommand({ state: base, mode: 'full-auto', selectedBy: '  @owner  ', now: '  t1  ' });
    expect(output.runModeSelection).toEqual({ mode: 'full-auto', selectedAt: 't1', selectedBy: '@owner' });
  });

  it.each([
    ['invalid mode', { mode: 'manual' as never, selectedBy: '@owner', now: 't1' }],
    ['empty selectedBy', { mode: 'semi-auto', selectedBy: '   ', now: 't1' }],
    ['empty now', { mode: 'semi-auto', selectedBy: '@owner', now: '   ' }],
  ])('rejects %s', (_label, input) => {
    expect(() => runModeSelectCommand({ state: base, ...input } as RunModeSelectCommandInput)).toThrow('run-mode-select:');
  });
});

import { describe, it, expect } from 'vitest';
import { effectiveRunMode, initState, markProgressDone, normalizeRunState, recordWritebackAudit, resetProgress, addLastAction, MAX_LAST_ACTIONS, selectRunMode } from './state.js';

describe('initState', () => {
  it('builds initial state with defaults', () => {
    const s = initState({ iid: '123', type: 'story', host: 'gitlab.example.test', projectId: '100', workspaceRoot: '/tmp/workspace', now: '2026-07-29T00:00:00Z' });
    expect(s.iid).toBe('123');
    expect(s.type).toBe('story');
    expect(s.project).toEqual({ host: 'gitlab.example.test', id: '100' });
    expect(s.cachedNode).toBe('');
    expect(s.docVersion).toBe(1);
    expect(s.lessonsCaptured).toBe(0);
    expect(s.lastActions).toEqual([]);
    expect(s.spawnedAgents).toEqual([]);
    expect(s.progress).toEqual({ node: '', done: [] });
    expect(s.writebackAudit).toEqual([]);
    expect(s.specDir).toBe('/tmp/workspace/.glab-flow/123/spec');
    expect(s.runMode).toBe('semi-auto');
    expect(s.cachedNodeAt).toBe('2026-07-29T00:00:00Z');
    expect(s.updatedAt).toBe('2026-07-29T00:00:00Z');
  });

  it('honors runMode override', () => {
    const s = initState({ iid: '1', type: 'bug', host: 'h', projectId: '9', workspaceRoot: '/r', runMode: 'full-auto', now: 'x' });
    expect(s.runMode).toBe('full-auto');
    expect(s.type).toBe('bug');
  });

  it('derives specDir from workspaceRoot and iid', () => {
    const s = initState({ iid: '456', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/var/oa', now: 't' });
    expect(s.specDir).toBe('/var/oa/.glab-flow/456/spec');
  });
});

describe('progress tracking', () => {
  const base = initState({ iid: '1', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/r', now: 't0' });

  it('marks a step done (idempotent, immutable)', () => {
    const atDev = resetProgress(base, '开发中', 't1');
    const s1 = markProgressDone(atDev, '技术方案', 't2');
    expect(s1.progress.done).toEqual(['技术方案']);
    expect(s1.updatedAt).toBe('t2');
    const s2 = markProgressDone(s1, '技术方案', 't3');
    expect(s2.progress.done).toEqual(['技术方案']);
    expect(s2).toBe(s1);
    const s3 = markProgressDone(s1, '编码实现', 't4');
    expect(s3.progress.done).toEqual(['技术方案', '编码实现']);
  });

  it('resetProgress clears done when node changes', () => {
    const marked = markProgressDone(resetProgress(base, '开发中', 't1'), '技术方案', 't2');
    const atDev = resetProgress(marked, '开发中', 't1');
    expect(atDev.progress).toEqual({ node: '开发中', done: ['技术方案'] });
    const atTest = resetProgress(atDev, '测试中', 't3');
    expect(atTest.progress).toEqual({ node: '测试中', done: [] });
  });

  it('resetProgress is a no-op when same node', () => {
    const atDev = resetProgress(base, '开发中', 't1');
    const again = resetProgress(atDev, '开发中', 't2');
    expect(again).toBe(atDev);
  });
});

describe('Issue-level run mode selection', () => {
  const base = initState({ iid: '1', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/r', now: 't0' });
  const selection = { mode: 'full-auto' as const, selectedAt: 't1', selectedBy: '@owner' };

  it('keeps legacy state compatible and uses runMode as the effective default', () => {
    const legacy = { ...base } as Partial<typeof base>;
    delete legacy.runModeSelection;
    const normalized = normalizeRunState(legacy as typeof base);
    expect(normalized.runModeSelection).toBeUndefined();
    expect(effectiveRunMode(normalized)).toBe('semi-auto');
  });

  it('persists a selection and makes it effective', () => {
    const input = { ...selection };
    const selected = selectRunMode(base, input);
    input.selectedBy = '@mutated';
    expect(selected.runModeSelection).toEqual(selection);
    expect(selected.runModeSelection).not.toBe(input);
    expect(selected.updatedAt).toBe('t1');
    expect(effectiveRunMode(selected)).toBe('full-auto');
  });

  it('is idempotent for the exact same selection and rejects changes', () => {
    const selected = selectRunMode(base, selection);
    expect(selectRunMode(selected, selection)).toBe(selected);
    expect(() => selectRunMode(selected, { ...selection, selectedBy: '@other' })).toThrow('runModeSelection is immutable');
    expect(() => selectRunMode(selected, { ...selection, selectedAt: 't2' })).toThrow('runModeSelection is immutable');
    expect(() => selectRunMode(selected, { ...selection, mode: 'semi-auto' })).toThrow('runModeSelection is immutable');
  });
});

describe('writeback audit recovery state', () => {
  const base = initState({ iid: '1', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/r', now: 't0' });

  it('retains successful writeback stages before a later failure for recovery', () => {
    const metadataSuccess = { target: 'issue' as const, stage: 'metadata' as const, status: 'succeeded' as const, detail: 'labels and assignee read back' };
    const commentFailure = { target: 'issue' as const, stage: 'state-comment' as const, status: 'failed' as const, detail: 'HTTP 415' };
    const s = recordWritebackAudit(recordWritebackAudit(base, metadataSuccess, 't1'), commentFailure, 't2');
    expect(s.writebackAudit).toEqual([
      { ...metadataSuccess, at: 't1' },
      { ...commentFailure, at: 't2' },
    ]);
    expect(recordWritebackAudit(s, commentFailure, 't3')).toBe(s);
  });

  it('normalizes legacy persisted state (writebackAudit defaulted)', () => {
    const legacy = { ...base } as Partial<typeof base>;
    delete legacy.writebackAudit;
    const normalized = normalizeRunState(legacy as typeof base);
    expect(normalized).toMatchObject({ writebackAudit: [] });
    expect(recordWritebackAudit(legacy as typeof base, { target: 'issue', stage: 'metadata', status: 'succeeded', detail: 'read back' }, 't1').writebackAudit).toHaveLength(1);
  });

  it('records an independent Week Milestone sync audit without changing the Issue writeback stages', () => {
    const next = recordWritebackAudit(base, {
      target: 'issue', stage: 'week-milestone-sync', status: 'failed', detail: 'Week W35 association timed out',
    }, 't1');
    expect(next.writebackAudit).toEqual([{
      target: 'issue', stage: 'week-milestone-sync', status: 'failed', detail: 'Week W35 association timed out', at: 't1',
    }]);
  });
});

describe('addLastAction / clampLastActions', () => {
  const base = initState({ iid: '1', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/r', now: 't0' });

  it('appends an action (immutable, updates timestamp)', () => {
    const s = addLastAction(base, '推进 待评审→已评审', 't1');
    expect(s.lastActions).toEqual(['推进 待评审→已评审']);
    expect(s.updatedAt).toBe('t1');
    expect(base.lastActions).toEqual([]);
  });
  it('skips blank action (no-op, same ref)', () => {
    const s = addLastAction(base, '   ', 't1');
    expect(s.lastActions).toEqual([]);
    expect(s).toBe(base);
  });
  it('dedupes adjacent identical actions', () => {
    const s1 = addLastAction(base, '推进', 't1');
    const s2 = addLastAction(s1, '推进', 't2');
    expect(s2.lastActions).toEqual(['推进']);
  });
  it('trims to MAX_LAST_ACTIONS (FIFO)', () => {
    let s = base;
    for (let i = 0; i < MAX_LAST_ACTIONS + 5; i++) s = addLastAction(s, `action-${i}`, `t${i}`);
    expect(s.lastActions).toHaveLength(MAX_LAST_ACTIONS);
    expect(s.lastActions[0]).toBe('action-5');
    expect(s.lastActions[MAX_LAST_ACTIONS - 1]).toBe(`action-${MAX_LAST_ACTIONS + 4}`);
  });

  it('recordWritebackAudit also clamps lastActions (限长贯穿)', () => {
    let s = base;
    for (let i = 0; i < MAX_LAST_ACTIONS + 5; i++) {
      s = recordWritebackAudit(s, { target: 'issue', stage: 'metadata', status: 'succeeded', detail: `d${i}` }, `t${i}`);
    }
    expect(s.lastActions.length).toBeLessThanOrEqual(MAX_LAST_ACTIONS);
  });
});

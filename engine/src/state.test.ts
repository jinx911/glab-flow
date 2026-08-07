import { describe, it, expect } from 'vitest';
import { initState, markProgressDone, resetProgress } from './state.js';

describe('initState', () => {
  it('builds initial state with defaults', () => {
    const s = initState({
      iid: '123',
      type: 'story',
      host: 'git.kuainiujinke.com',
      projectId: '3915',
      workspaceRoot: '/tmp/oa',
      now: '2026-07-29T00:00:00Z',
    });
    expect(s.iid).toBe('123');
    expect(s.type).toBe('story');
    expect(s.project).toEqual({ host: 'git.kuainiujinke.com', id: '3915' });
    expect(s.cachedNode).toBe('');
    expect(s.docVersion).toBe(1);
    expect(s.lessonsCaptured).toBe(0);
    expect(s.lastActions).toEqual([]);
    expect(s.spawnedAgents).toEqual([]);
    expect(s.progress).toEqual({ node: '', done: [] });
    expect(s.specDir).toBe('/tmp/oa/.glab-flow/123/spec');
    expect(s.runMode).toBe('semi-auto');
    expect(s.cachedNodeAt).toBe('2026-07-29T00:00:00Z');
    expect(s.updatedAt).toBe('2026-07-29T00:00:00Z');
  });

  it('honors runMode override', () => {
    const s = initState({
      iid: '1',
      type: 'bug',
      host: 'h',
      projectId: '9',
      workspaceRoot: '/r',
      runMode: 'full-auto',
      now: 'x',
    });
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

  it('markProgressDone adds a step (idempotent, immutable)', () => {
    const atDev = resetProgress(base, '开发中', 't1');
    const s1 = markProgressDone(atDev, '技术方案', 't2');
    expect(s1.progress.done).toEqual(['技术方案']);
    expect(s1.updatedAt).toBe('t2');
    const s2 = markProgressDone(s1, '技术方案', 't3');
    expect(s2.progress.done).toEqual(['技术方案']); // idempotent
    expect(s2).toBe(s1); // same ref, no new object
    const s3 = markProgressDone(s1, '编码实现', 't4');
    expect(s3.progress.done).toEqual(['技术方案', '编码实现']);
  });

  it('resetProgress clears done when node changes', () => {
    const atDev = resetProgress(markProgressDone(resetProgress(base, '开发中', 't1'), '技术方案', 't2'), '开发中', 't1');
    expect(atDev.progress).toEqual({ node: '开发中', done: ['技术方案'] });
    const atTest = resetProgress(atDev, '测试中', 't3');
    expect(atTest.progress).toEqual({ node: '测试中', done: [] });
  });

  it('resetProgress is a no-op when same node and already empty', () => {
    const atDev = resetProgress(base, '开发中', 't1');
    const again = resetProgress(atDev, '开发中', 't2');
    expect(again).toBe(atDev); // same ref
  });
});

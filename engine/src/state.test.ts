import { describe, it, expect } from 'vitest';
import { initState } from './state.js';

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

import { describe, it, expect } from 'vitest';
import { initState, markProgressDone, normalizeRunState, recordVerifiedReceipt, recordWritebackAudit, resetProgress, setDataEvidenceProfile, tryMarkProgressDone } from './state.js';
import type { ArtifactReceipt } from './types.js';

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
    expect(s.artifactReceipts).toEqual([]);
    expect(s.writebackAudit).toEqual([]);
    expect(s.dataEvidenceProfile).toBeUndefined();
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

  const designReceipt: ArtifactReceipt = {
    kind: 'design', target: { kind: 'issue', projectId: '1', iid: 1 }, source: '.glab-flow/1/spec/design.md', sha256: 'design-sha', noteId: '9', observedAt: '2026-08-12T10:00:00Z',
  };

  it('uses state receipts by default to complete the matching governed progress step', () => {
    const withReceipt = recordVerifiedReceipt(base, designReceipt, 't1');
    const r = tryMarkProgressDone(resetProgress(withReceipt, '已评审', 't2'), '技术方案 design.md', 't3');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected stored receipt to satisfy the progress gate');
    expect(r.state.progress.done).toEqual(['技术方案 design.md']);
  });

  it('supplements stored receipts with supplied receipts', () => {
    const r = tryMarkProgressDone(resetProgress(base, '测试中', 't1'), '测试计划', 't2', [{
      ...designReceipt,
      kind: 'test-plan',
      noteId: '10',
      source: '.glab-flow/1/spec/test-plan.md',
    }]);
    expect(r.ok).toBe(true);
  });

  it('marks ungated development steps done (idempotent, immutable)', () => {
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
    const marked = markProgressDone(resetProgress(base, '开发中', 't1'), '技术方案', 't2');
    const atDev = resetProgress(marked, '开发中', 't1');
    expect(atDev.progress).toEqual({ node: '开发中', done: ['技术方案'] });
    const atTest = resetProgress(atDev, '测试中', 't3');
    expect(atTest.progress).toEqual({ node: '测试中', done: [] });
  });

  it('resetProgress is a no-op when same node and already empty', () => {
    const atDev = resetProgress(base, '开发中', 't1');
    const again = resetProgress(atDev, '开发中', 't2');
    expect(again).toBe(atDev); // same ref
  });

  it('rejects marking a governed progress step done without its verified receipt', () => {
    const atDev = resetProgress(base, '已评审', 't1');
    const r = tryMarkProgressDone(atDev, '技术方案 design.md', 't2');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected receipt gate to block progress');
    expect(r.error).toEqual({ code: 'missing_artifact_receipt', required: 'design', step: '技术方案 design.md' });
    expect(r.state).toBe(atDev);
  });

  it.each([
    ['六清楚草稿', 'proposal'],
    ['测试计划', 'test-plan'],
    ['发布计划就绪', 'release-plan'],
    ['上线前确认', 'release-plan'],
  ] as const)('requires %s receipt before marking %s complete', (step, kind) => {
    const r = tryMarkProgressDone(base, step, 't1');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected receipt gate to block progress');
    expect(r.error.required).toBe(kind);
  });
});

describe('artifact receipt and writeback recovery state', () => {
  const base = initState({ iid: '1', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/r', now: 't0' });
  const designReceipt: ArtifactReceipt = {
    kind: 'design', target: { kind: 'issue', projectId: '1', iid: 1 }, source: '.glab-flow/1/spec/design.md', sha256: 'design-sha', noteId: '9', observedAt: '2026-08-12T10:00:00Z',
  };

  it('records a verified receipt idempotently after GitLab readback', () => {
    const once = recordVerifiedReceipt(base, designReceipt, 't1');
    expect(once.artifactReceipts).toEqual([designReceipt]);
    expect(recordVerifiedReceipt(once, once.artifactReceipts[0]!, 't2')).toBe(once);
  });

  it('records the declared data-evidence profile immutably and idempotently', () => {
    const profiled = setDataEvidenceProfile(base, 'data-backed', 't1');
    expect(profiled.dataEvidenceProfile).toBe('data-backed');
    expect(profiled.updatedAt).toBe('t1');
    expect(setDataEvidenceProfile(profiled, 'data-backed', 't2')).toBe(profiled);
  });

  it('retains successful writeback stages before a later failure for recovery', () => {
    const metadataSuccess = { target: 'issue' as const, stage: 'metadata' as const, status: 'succeeded' as const, detail: 'labels and assignee read back' };
    const commentFailure = { target: 'issue' as const, stage: 'state-comment' as const, status: 'failed' as const, detail: 'HTTP 415' };
    const s = recordWritebackAudit(recordWritebackAudit(base, metadataSuccess, 't1'), commentFailure, 't2');
    expect(s.writebackAudit).toEqual([
      { ...metadataSuccess, at: 't1' },
      { ...commentFailure, at: 't2' },
    ]);
    expect(recordWritebackAudit(s, commentFailure, 't3')).toBe(s);
    expect(s.writebackAudit).toEqual([
      { ...metadataSuccess, at: 't1' },
      { ...commentFailure, at: 't2' },
    ]);
  });

  it('rejects an Issue receipt from a different project or Issue', () => {
    const foreign: ArtifactReceipt = { ...designReceipt, target: { kind: 'issue', projectId: 'other', iid: 1 } };
    expect(recordVerifiedReceipt(base, foreign, 't1')).toBe(base);
    const r = tryMarkProgressDone(resetProgress(base, '已评审', 't1'), '技术方案 design.md', 't2', [foreign]);
    expect(r.ok).toBe(false);
  });

  it('normalizes legacy persisted state before receipt, audit, and progress operations', () => {
    const legacy = { ...base } as Partial<typeof base>;
    delete legacy.artifactReceipts;
    delete legacy.writebackAudit;
    delete legacy.dataEvidenceProfile;
    const normalized = normalizeRunState(legacy as typeof base);
    expect(normalized).toMatchObject({ artifactReceipts: [], writebackAudit: [] });
    expect(recordVerifiedReceipt(legacy as typeof base, designReceipt, 't1').artifactReceipts).toEqual([designReceipt]);
    expect(recordWritebackAudit(legacy as typeof base, { target: 'issue', stage: 'metadata', status: 'succeeded', detail: 'read back' }, 't1').writebackAudit).toHaveLength(1);
    expect(tryMarkProgressDone(legacy as typeof base, '编码实现', 't1')).toMatchObject({ ok: true, state: { artifactReceipts: [], writebackAudit: [] } });
  });
});

import { describe, expect, it } from 'vitest';
import { initDu } from './du.js';
import { registerResource, checkResources, cleanupChecklist, disposeResource } from './resource.js';

const T = '2026-09-01T00:00:00Z';
const base = () => initDu({ iid: 88, type: 'story', now: T });

describe('resource registry', () => {
  it('registers immutably and dedupes by id', () => {
    const du = registerResource(base(), { id: 'TMP-88-members', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    expect(du.resources).toHaveLength(1);
    expect(base().resources).toHaveLength(0); // 原 du 不受影响（不可变）
    expect(registerResource(du, { id: 'TMP-88-members', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T).resources).toHaveLength(1);
  });
  it('flags temporary apifox resource without TMP prefix', () => {
    const du = registerResource(base(), { id: 'members-data', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    expect(checkResources(du)).toHaveLength(1);
    expect(checkResources(du)[0]?.issue).toContain('TMP-88-');
  });
  it('flags prod resource with temporary lifecycle', () => {
    const du = registerResource(base(), { id: 'prod-config', kind: 'test-data', scope: 'prod', lifecycle: 'temporary', createdAt: T }, T);
    expect(checkResources(du).some((i) => i.issue.includes('生产资源'))).toBe(true);
  });
  it.each(['id', 'kind', 'scope', 'lifecycle', 'createdAt'])('throws when entry misses required field %s (no garbage {} entries)', (field) => {
    const entry = { id: 'TMP-88-members', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T };
    const malformed = { ...entry, [field]: undefined } as unknown as Parameters<typeof registerResource>[1];
    expect(() => registerResource(base(), malformed, T)).toThrow(field);
  });
  it('throws when entry id is an empty string', () => {
    const malformed = { kind: 'test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T, id: '' } as unknown as Parameters<typeof registerResource>[1];
    expect(() => registerResource(base(), malformed, T)).toThrow('id');
  });
  it('cleanup checklist lists undisposed only, with lifecycle-based suggestion', () => {
    let du = registerResource(base(), { id: 'TMP-88-a', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    du = registerResource(du, { id: 'share-88', kind: 'apifox-scenario', scope: 'non-prod', lifecycle: 'shared-candidate', createdAt: T }, T);
    du = registerResource(du, { id: 'branch-f-88', kind: 'branch', scope: 'non-prod', lifecycle: 'permanent', createdAt: T }, T);
    du = disposeResource(du, 'branch-f-88', 'kept', T);
    const list = cleanupChecklist(du);
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.resourceId === 'TMP-88-a')?.suggestion).toBe('删除');
    expect(list.find((x) => x.resourceId === 'share-88')?.suggestion).toBe('升级为共享资产');
  });
  it('dispose is immutable and stamps disposal', () => {
    const du = registerResource(base(), { id: 'TMP-88-x', kind: 'test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    const next = disposeResource(du, 'TMP-88-x', 'deleted', '2026-09-02T00:00:00Z');
    expect(du.resources[0]?.disposedAt).toBeUndefined();
    expect(next.resources[0]).toMatchObject({ disposedAt: '2026-09-02T00:00:00Z', disposal: 'deleted' });
    expect(cleanupChecklist(next)).toHaveLength(0);
  });
});

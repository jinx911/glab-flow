import { describe, expect, it } from 'vitest';
import { renderAssetCatalog, parseAssetCatalog, upsertCatalogEntry, searchCatalog, catalogEntriesFromDisposal } from './asset-catalog.js';
import { initDu } from './du.js';
import { registerResource as reg, disposeResource } from './resource.js';

const T = '2026-09-01T00:00:00Z';

describe('asset-catalog render/parse 往返', () => {
  it('renders and parses back with all fields', () => {
    const entries = [
      { domain: '会员导出', name: '导出-全量场景', apifoxId: 'scenario-101', kind: 'scenario' as const, covers: '按条件导出会员列表全流程', lastVerifiedPlanVersion: 'v3', registeredAt: T },
      { domain: '转移矩阵', name: '转移矩阵', apifoxId: 'td-201', kind: 'test-data' as const, covers: '员工调岗转移参数矩阵', registeredAt: T },
    ];
    const md = renderAssetCatalog(entries);
    const parsed = parseAssetCatalog(md);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toMatchObject({ domain: '会员导出', apifoxId: 'scenario-101', lastVerifiedPlanVersion: 'v3' });
    expect(parsed.entries[1]).toMatchObject({ kind: 'test-data' });
  });
  it('empty/undefined catalog parses to empty', () => {
    expect(parseAssetCatalog(undefined).ok).toBe(true);
  });
  it('count mismatch flagged', () => {
    const parsed = parseAssetCatalog('<!-- glab-flow:asset-catalog:v1\ncount: 5\n- a | b | scenario | 1 | x | 登记 T\n-->');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries).toHaveLength(1); // 坏行跳过不整文件失败；count 不匹配只对有效行
  });
});

describe('upsert 幂等', () => {
  it('same apifoxId updates in place preserving registeredAt', () => {
    const a = [{ domain: 'd', name: 'n', apifoxId: 'x1', kind: 'scenario' as const, covers: 'c', registeredAt: 'T0' }];
    const up = upsertCatalogEntry(a, { domain: 'd2', name: 'n2', apifoxId: 'x1', kind: 'scenario', covers: 'c2', registeredAt: 'T1' });
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ domain: 'd2', registeredAt: 'T0' });
  });
});

describe('search 检索', () => {
  const entries = [
    { domain: '会员导出', name: '导出-全量', apifoxId: '1', kind: 'scenario' as const, covers: '导出会员列表', registeredAt: T },
    { domain: '转移矩阵', name: '调岗矩阵', apifoxId: '2', kind: 'test-data' as const, covers: '员工调岗', registeredAt: T },
  ];
  it('filters by domain and keyword（覆盖描述也命中）', () => {
    expect(searchCatalog(entries, '会员导出')).toHaveLength(1);
    expect(searchCatalog(entries, undefined, '调岗')).toHaveLength(1);
    expect(searchCatalog(entries, undefined, '导出')).toHaveLength(1);
    expect(searchCatalog(entries, '不存在域')).toHaveLength(0);
    expect(searchCatalog(entries)).toHaveLength(2);
  });
});

describe('from-disposal 终态升级推导', () => {
  it('collects promoted-shared resources as catalog entries', () => {
    let du = initDu({ iid: 88, type: 'story', now: T });
    du = reg(du, { id: '会员-导出场景', kind: 'apifox-scenario', scope: 'non-prod', lifecycle: 'shared-candidate', createdAt: T }, T);
    du = reg(du, { id: 'TMP-88-临时', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    du = disposeResource(du, '会员-导出场景', 'promoted-shared', '2026-09-05T00:00:00Z');
    du = disposeResource(du, 'TMP-88-临时', 'deleted', '2026-09-05T00:00:00Z');
    const entries = catalogEntriesFromDisposal(du, T);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: '会员-导出场景', kind: 'scenario', registeredAt: '2026-09-05T00:00:00Z' });
  });
});

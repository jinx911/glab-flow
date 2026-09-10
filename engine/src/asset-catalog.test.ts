import { describe, expect, it } from 'vitest';
import { catalogEntriesFromDisposal, parseAssetCatalog, renderAssetCatalog, searchCatalog, upsertCatalogEntry } from './asset-catalog.js';
import { initDu } from './du.js';
import { disposeResource, registerResource as reg } from './resource.js';

const T = '2026-09-01T00:00:00Z';

describe('asset-catalog render/parse 往返', () => {
  it('renders and parses back script/data assets', () => {
    const entries = [
      { domain: '请假结算', name: 'KN租户请假结算脚本', assetId: 'cases/kn-leave-settlement.spec.ts', kind: 'test-script' as const, covers: 'KN1001 员工请假结算主流程', lastVerifiedPlanVersion: 'v3', registeredAt: T },
      { domain: '合同续费', name: 'KN租户合同续费数据', assetId: 'fixtures/kn-contract-renewal.sql', kind: 'test-data' as const, covers: '合同续费单与员工 KN1002 组合数据', registeredAt: T },
    ];
    const parsed = parseAssetCatalog(renderAssetCatalog(entries));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toMatchObject({ domain: '请假结算', assetId: 'cases/kn-leave-settlement.spec.ts', lastVerifiedPlanVersion: 'v3' });
    expect(parsed.entries[1]).toMatchObject({ kind: 'test-data' });
  });

  it('empty/undefined catalog parses to empty', () => {
    expect(parseAssetCatalog(undefined).ok).toBe(true);
  });
});

describe('upsert and search', () => {
  it('same assetId updates in place preserving registeredAt', () => {
    const current = [{ domain: 'd', name: 'n', assetId: 'x1', kind: 'test-script' as const, covers: 'c', registeredAt: 'T0' }];
    const up = upsertCatalogEntry(current, { domain: 'd2', name: 'n2', assetId: 'x1', kind: 'test-script', covers: 'c2', registeredAt: 'T1' });
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ domain: 'd2', registeredAt: 'T0' });
  });

  it('filters by domain and keyword', () => {
    const entries = [
      { domain: '请假结算', name: 'KN请假脚本', assetId: '1', kind: 'test-script' as const, covers: '员工 KN1001 请假', registeredAt: T },
      { domain: '合同续费', name: '合同数据', assetId: '2', kind: 'test-data' as const, covers: '续费单', registeredAt: T },
    ];
    expect(searchCatalog(entries, '请假结算')).toHaveLength(1);
    expect(searchCatalog(entries, undefined, 'KN1001')).toHaveLength(1);
    expect(searchCatalog(entries, '不存在域')).toHaveLength(0);
  });
});

describe('from-disposal 终态升级推导', () => {
  it('collects promoted-shared resources as catalog entries', () => {
    let du = initDu({ iid: 88, type: 'story', now: T });
    du = reg(du, { id: 'cases/kn-leave-settlement.spec.ts', kind: 'test-script', scope: 'non-prod', lifecycle: 'shared-candidate', createdAt: T }, T);
    du = reg(du, { id: 'TMP-88-kn-contract-renewal', kind: 'test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    du = disposeResource(du, 'cases/kn-leave-settlement.spec.ts', 'promoted-shared', '2026-09-05T00:00:00Z');
    du = disposeResource(du, 'TMP-88-kn-contract-renewal', 'deleted', '2026-09-05T00:00:00Z');
    const entries = catalogEntriesFromDisposal(du, T);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ assetId: 'cases/kn-leave-settlement.spec.ts', kind: 'test-script', registeredAt: '2026-09-05T00:00:00Z' });
  });
});

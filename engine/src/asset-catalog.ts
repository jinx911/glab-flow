import type { DuResourceEntry, DuState } from './types.js';

/**
 * workspace 级测试资产目录（R1/E5：复用优先从「全量 list+人肉比对」变检索）。
 * 落盘 `<workspace.root>/.glab-flow/asset-catalog.md`（Leader 维护，引擎只算）。
 * 条目来源：① 终态 TMP/E2E 数据→共享升级时登记 ② 测试脚本/fixture 新建共享资产时登记。
 */
export interface AssetCatalogEntry {
  /** 业务域/功能能力、数据矩阵域或用途（回归/冒烟/发布）——检索的第一键。 */
  domain: string;
  name: string;
  assetId: string;
  kind: 'test-script' | 'test-fixture' | 'test-data';
  /** 覆盖的用例类型/能力一句话（新需求判断能否复用的依据）。 */
  covers: string;
  /** 最后验证时的计划版本（复用前核对是否已随最近的接口变化更新）。 */
  lastVerifiedPlanVersion?: string;
  registeredAt: string;
}

const CATALOG_MARKER = '<!-- glab-flow:asset-catalog:v1';

/** 渲染目录为 markdown（人可读 + marker 包裹可回读）。 */
export function renderAssetCatalog(entries: AssetCatalogEntry[]): string {
  const lines = entries.map((e) =>
    `- ${e.domain} | ${e.name} | ${e.kind} | ${e.assetId} | ${e.covers}${e.lastVerifiedPlanVersion ? ` | 最后验证 ${e.lastVerifiedPlanVersion}` : ''} | 登记 ${e.registeredAt}`);
  return [CATALOG_MARKER, `count: ${entries.length}`, ...lines, '-->', '', '（资产目录由终态升级与新共享资产登记自动维护；检索按「业务域 | 名称关键词」过滤后回读脚本/fixture/数据来源确认）'].join('\n');
}

/** 回读目录（与 render 互逆；损坏行跳过不整文件失败）。 */
export function parseAssetCatalog(text: string | undefined): { ok: true; entries: AssetCatalogEntry[] } | { ok: false; errors: string[] } {
  if (!text) return { ok: true, entries: [] };
  const start = text.indexOf(CATALOG_MARKER);
  if (start < 0) return { ok: false, errors: ['资产目录缺 glab-flow:asset-catalog:v1 标记'] };
  const end = text.indexOf('-->', start);
  const body = text.slice(start + CATALOG_MARKER.length, end < 0 ? undefined : end);
  const entries: AssetCatalogEntry[] = [];
  const errors: string[] = [];
  let count = -1;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cnt = line.match(/^count:\s*(\d+)$/);
    if (cnt) { count = Number(cnt[1]); continue; }
    const parts = line.replace(/^- /, '').split('|').map((p) => p.trim());
    if (parts.length < 5) { errors.push(`目录行格式无效（需 域|名称|类型|ID|覆盖）：${line.slice(0, 40)}`); continue; }
    const verified = parts.find((p) => p.startsWith('最后验证 '))?.slice(5);
    entries.push({
      domain: parts[0]!, name: parts[1]!, kind: parts[2]! as AssetCatalogEntry['kind'],
      assetId: parts[3]!, covers: parts[4]!, lastVerifiedPlanVersion: verified,
      registeredAt: parts.find((p) => p.startsWith('登记 '))?.slice(3) ?? '',
    });
  }
  if (count >= 0 && count !== entries.length) errors.push(`目录声明 count=${count} 但解析到 ${entries.length} 条`);
  return { ok: true, entries };
}

/** 追加/更新条目（按 assetId 幂等；更新时保留 registeredAt）。不可变。 */
export function upsertCatalogEntry(entries: AssetCatalogEntry[], entry: AssetCatalogEntry): AssetCatalogEntry[] {
  const idx = entries.findIndex((e) => e.assetId === entry.assetId);
  if (idx < 0) return [...entries, entry];
  const next = [...entries];
  next[idx] = { ...entry, registeredAt: entries[idx]!.registeredAt };
  return next;
}

/** 检索：按域与关键词（名称/覆盖描述包含匹配，大小写不敏感）。 */
export function searchCatalog(entries: AssetCatalogEntry[], domain?: string, keyword?: string): AssetCatalogEntry[] {
  const kw = keyword?.trim().toLowerCase();
  return entries.filter((e) =>
    (!domain || !domain.trim() || e.domain.includes(domain.trim()))
    && (!kw || e.name.toLowerCase().includes(kw) || e.covers.toLowerCase().includes(kw)));
}

/** 从终态资源登记推导应入目录的条目（升级为共享的资产）。 */
export function catalogEntriesFromDisposal(du: DuState, now: string): AssetCatalogEntry[] {
  return du.resources
    .filter((r: DuResourceEntry) => r.disposal === 'promoted-shared')
    .map((r) => ({
      domain: r.id.includes('-') ? r.id.slice(0, r.id.indexOf('-')) : r.id,
      name: r.id,
      assetId: r.id,
      kind: r.kind as AssetCatalogEntry['kind'],
      covers: '终态升级共享（处置时补充覆盖描述）',
      registeredAt: r.disposedAt ?? now,
    }));
}

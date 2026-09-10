import type { DuResourceEntry, DuState, ResourceCheckIssue } from './types.js';

/** 临时资源强制命名前缀：TMP-<iid>-...。 */
export function tmpPrefixFor(iid: number): string {
  return `TMP-${iid}-`;
}

function e2eDataPrefixFor(iid: number, environment: 'local' | 'test'): string {
  return `E2E${iid}${environment === 'local' ? 'L' : 'T'}-`;
}

function isManagedTestResource(kind: DuResourceEntry['kind']): boolean {
  return kind === 'test-data' || kind === 'test-fixture';
}

/**
 * 资源登记（spec §3.4）：DU 名下资源创建即登记。幂等（同 id 不重复），
 * 不可变——返回新 DuState，原对象不动。
 */
export function registerResource(du: DuState, entry: Omit<DuResourceEntry, 'disposedAt' | 'disposal'>, now: string): DuState {
  // 边界校验：五个必填字段防 undefined/空串混入（CLI 层缺 entry 时展开会成为 {}，必须在此拦截）。
  for (const field of ['id', 'kind', 'scope', 'lifecycle', 'createdAt'] as const) {
    if (typeof entry[field] !== 'string' || entry[field] === '') {
      throw new Error(`resource register: entry.${field} 必填且为非空字符串`);
    }
  }
  if (du.resources.some((r) => r.id === entry.id)) return du;
  return { ...du, resources: [...du.resources, { ...entry }], updatedAt: now };
}

/** 登记校验（spec §3.4）：临时测试数据命名前缀与生产生命周期约束。 */
export function checkResources(du: DuState): ResourceCheckIssue[] {
  const issues: ResourceCheckIssue[] = [];
  const tmpPrefix = tmpPrefixFor(du.iid);
  const localPrefix = e2eDataPrefixFor(du.iid, 'local');
  const testPrefix = e2eDataPrefixFor(du.iid, 'test');
  for (const r of du.resources) {
    if (r.lifecycle === 'temporary' && isManagedTestResource(r.kind)
      && !r.id.startsWith(tmpPrefix) && !r.id.startsWith(localPrefix) && !r.id.startsWith(testPrefix)) {
      issues.push({ resourceId: r.id, issue: `临时测试数据/fixture 应以 ${tmpPrefix}、${localPrefix} 或 ${testPrefix} 前缀命名` });
    }
    if (r.scope === 'prod' && r.lifecycle === 'temporary') {
      issues.push({ resourceId: r.id, issue: '生产资源不允许 temporary 生命周期' });
    }
  }
  return issues;
}

/** 终态清理清单条目：未处置资源逐项给出处置建议。 */
export interface CleanupChecklistItem {
  resourceId: string;
  kind: DuResourceEntry['kind'];
  suggestion: '删除' | '升级为共享资产' | '保留并说明';
}

/** 终态清理清单（spec §3.4）：未处置资源逐项给出处置建议。 */
export function cleanupChecklist(du: DuState): CleanupChecklistItem[] {
  return du.resources
    .filter((r) => !r.disposedAt)
    .map((r) => ({
      resourceId: r.id,
      kind: r.kind,
      suggestion: r.lifecycle === 'temporary' ? '删除' : r.lifecycle === 'shared-candidate' ? '升级为共享资产' : '保留并说明',
    }));
}

/** 处置登记（spec §3.4）：终态清理后回写处置方式与时间。不可变。 */
export function disposeResource(du: DuState, resourceId: string, disposal: NonNullable<DuResourceEntry['disposal']>, now: string): DuState {
  return {
    ...du,
    resources: du.resources.map((r) => (r.id === resourceId ? { ...r, disposedAt: now, disposal } : r)),
    updatedAt: now,
  };
}

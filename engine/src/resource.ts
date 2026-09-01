import type { DuResourceEntry, DuState, ResourceCheckIssue } from './types.js';

/**
 * 资源登记（spec §3.4）：DU 名下资源创建即登记。幂等（同 id 不重复），
 * 不可变——返回新 DuState，原对象不动。
 */
export function registerResource(du: DuState, entry: Omit<DuResourceEntry, 'disposedAt' | 'disposal'>, now: string): DuState {
  if (du.resources.some((r) => r.id === entry.id)) return du;
  return { ...du, resources: [...du.resources, { ...entry }], updatedAt: now };
}

/** 登记校验（spec §3.4）：临时资源命名前缀与生产生命周期约束。 */
export function checkResources(du: DuState, iid: number): ResourceCheckIssue[] {
  const issues: ResourceCheckIssue[] = [];
  const tmpPrefix = `TMP-${iid}-`;
  for (const r of du.resources) {
    if (r.lifecycle === 'temporary' && r.kind.startsWith('apifox') && !r.id.startsWith(tmpPrefix)) {
      issues.push({ resourceId: r.id, issue: `临时 Apifox 资源应以 ${tmpPrefix} 前缀命名` });
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

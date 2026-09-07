import type { DuState, DuEvidenceEntry, IssueType, ChangeScope, GateSet, GateMatrix } from './types.js';
import { deriveGateSet, freezeGateSet, gateScopeValidationErrors } from './gate-set.js';

export interface InitDuInput {
  iid: number;
  type: IssueType;
  now: string;
}

export function initDu(input: InitDuInput): DuState {
  return {
    iid: input.iid,
    type: input.type,
    cachedNode: '',
    affectedScopes: [],
    evidence: [],
    resources: [],
    metricEvents: [],
    updatedAt: input.now,
  };
}

/**
 * 追加一条执行事实（幂等：同 kind+environment+planVersion+recordedAt+outcome
 * 不重复追加）。outcome 计入幂等键：同刻重跑产生不同结论是「新事实」而非
 * 重放，必须共存——否则 latestEvidence 会留着过期的 failed 事实挡门禁。
 * 不可变。
 */
export function recordEvidence(du: DuState, entry: DuEvidenceEntry, now: string): DuState {
  const dup = du.evidence.some((e) =>
    e.kind === entry.kind && e.environment === entry.environment
    && e.planVersion === entry.planVersion && e.recordedAt === entry.recordedAt
    && e.outcome === entry.outcome);
  if (dup) return du;
  return { ...du, evidence: [...du.evidence, entry], updatedAt: now };
}

/**
 * 把技术方案声明的受影响维度绑定进 DU：deriveGateSet 推导并冻结 gateSet，
 * affectedScopes 同步为声明集（作为后续 change 棘轮的种子——扩容时并集推导）。
 * 已冻结过 gateSet 的 DU 拒绝重绑（防意外降级；变更走 change 棘轮）。
 */
export function bindGateSet(du: DuState, matrix: GateMatrix, scopes: ChangeScope[], now: string): DuState {
  const scopeErrors = gateScopeValidationErrors(scopes);
  if (scopeErrors.length) throw new Error(`bindGateSet: ${scopeErrors.join('；')}`);
  if (du.gateSet?.frozenAt) return du;
  return {
    ...du,
    affectedScopes: [...new Set(scopes)],
    gateSet: freezeGateSet(deriveGateSet(matrix, scopes), now),
    updatedAt: now,
  };
}

/** 流转成功后更新 cachedNode（reconcile 对账基准）。不可变；节点相同返回原引用。 */
export function setCachedNode(du: DuState, node: string, now: string): DuState {
  if (du.cachedNode === node) return du;
  return { ...du, cachedNode: node, updatedAt: now };
}

/** 某环境最新事实（无则 undefined）。按追加序取最后一条，调用方须按时间序追加。 */
export function latestEvidence(du: DuState, kind: DuEvidenceEntry['kind'], environment: string): DuEvidenceEntry | undefined {
  // M4：按 recordedAt 时间序取最新（同刻按追加序 tie-break）——乱序补录/备份恢复时
  // 旧 passed 事实不会因「后追加」冒充最新；时间戳不可解析的条目退回追加序参与。
  const stamps = new Map<number, number>();
  du.evidence.forEach((e, idx) => {
    const t = Date.parse(e.recordedAt);
    stamps.set(idx, Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t);
  });
  let best: DuEvidenceEntry | undefined;
  let bestKey = -1;
  du.evidence.forEach((e, idx) => {
    if (e.kind !== kind || e.environment !== environment) return;
    const key = stamps.get(idx) ?? Number.NEGATIVE_INFINITY;
    if (idx > bestKey && (best === undefined || key >= (stamps.get(bestKey) ?? Number.NEGATIVE_INFINITY))) {
      best = e;
      bestKey = idx;
    }
  });
  return best;
}

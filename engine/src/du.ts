import type { DuState, DuEvidenceEntry, IssueType } from './types.js';

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

/** 某环境最新事实（无则 undefined）。按追加序取最后一条，调用方须按时间序追加。 */
export function latestEvidence(du: DuState, kind: DuEvidenceEntry['kind'], environment: string): DuEvidenceEntry | undefined {
  return [...du.evidence].reverse().find((e) => e.kind === kind && e.environment === environment);
}

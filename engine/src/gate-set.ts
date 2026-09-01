import type { ChangeScope, GateMatrix, GateSet } from './types.js';

/** 维度风险档位：取命中规则的最高档为基准（数字越大风险越高）。 */
const RANK: Record<string, number> = {
  'frontend-copy': 0,
  functional: 1,
  'frontend-route': 2,
  'api-contract': 2,
  'data-model': 3,
  permission: 3,
  schedule: 0,
  release: 4,
};

/** 声明集按风险降序去重排序。 */
function rankScopes(scopes: ChangeScope[]): ChangeScope[] {
  return [...new Set(scopes)].sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0));
}

/**
 * 从声明维度推导 GateSet：找「声明集中最高档维度」所在的规则为基准；
 * 未命中（如 release/schedule 不在 rules 里，或声明集为空）走 defaults。纯函数。
 */
export function deriveGateSet(matrix: GateMatrix, scopes: ChangeScope[]): GateSet {
  const ranked = rankScopes(scopes);
  const top = ranked[0];
  const hit = top === undefined ? undefined : matrix.rules.find((rule) => rule.scopes.includes(top));
  const base = hit ?? matrix.defaults;
  return {
    scopes: ranked,
    skipStates: [...(base.skipStates ?? [])],
    environments: (base.environments ?? matrix.defaults.environments).slice(),
    mrReview: base.mrReview ?? matrix.defaults.mrReview,
    regression: base.regression ?? matrix.defaults.regression,
    rollbackPlan: base.rollbackPlan ?? false,
    overrides: [],
  };
}

/**
 * 棘轮（spec §3.2）：只升不降——并集维度重推导；显式降级必须走 overrideGateSet 留痕。
 * 已冻结的 GateSet 保持冻结；既有 override 记录原样保留。
 */
export function ratchetGateSet(current: GateSet, matrix: GateMatrix, newScopes: ChangeScope[]): GateSet {
  const merged = [...new Set([...current.scopes, ...newScopes])];
  const next = deriveGateSet(matrix, merged);
  return { ...next, overrides: current.overrides, frozenAt: current.frozenAt };
}

/** 显式改判（增/删门禁）：记录 override 并返回新 GateSet。不可变。 */
export function overrideGateSet(
  current: GateSet,
  field: 'mrReview' | 'regression' | 'rollbackPlan',
  value: GateSet[typeof field],
  by: string,
  at: string,
): GateSet {
  const from = String(current[field]);
  return { ...current, [field]: value, overrides: [...current.overrides, { field, from, to: String(value), by, at }] };
}

/** 冻结 GateSet（已评审→开发中 绑定时）；幂等——已冻结的原样返回。 */
export function freezeGateSet(gs: GateSet, at: string): GateSet {
  return gs.frozenAt ? gs : { ...gs, frozenAt: at };
}

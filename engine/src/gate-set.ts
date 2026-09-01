import type { ChangeScope, GateMatrix, GateSet } from './types.js';

/** G14 绑定的必填字段名：feature→master MR 评审结论（guard/transition 共用）。 */
export const MR_REVIEW_FIELD = 'feature分支MR评审结论';

/**
 * 维度风险档位：取命中规则的最高档为基准（数字越大风险越高）。
 * Record<ChangeScope, number> 让新增 ChangeScope 联合成员在编译期强制补档（I5）。
 */
export const SCOPE_RANK: Record<ChangeScope, number> = {
  'frontend-copy': 0,
  functional: 1,
  'frontend-route': 2,
  'api-contract': 2,
  'data-model': 3,
  permission: 3,
  schedule: 0,
  release: 4,
};

/** GateSet 中允许显式改判（overrideGateSet）的字段。 */
export type GateSetOverrideField = 'mrReview' | 'regression' | 'rollbackPlan';

const OVERRIDE_FIELDS: ReadonlySet<string> = new Set<string>(['mrReview', 'regression', 'rollbackPlan']);

/** 同档位用名字典序做次级排序键（不用 localeCompare——ICU 区域设置会影响确定性）。 */
function compareScopes(a: ChangeScope, b: ChangeScope): number {
  const diff = SCOPE_RANK[b] - SCOPE_RANK[a];
  return diff !== 0 ? diff : a < b ? -1 : 1;
}

/** 声明集去重并按风险降序排序；结果与传入顺序无关（I1 确定性）。 */
function rankScopes(scopes: ChangeScope[]): ChangeScope[] {
  return [...new Set(scopes)].sort(compareScopes);
}

/** GateSet 关闭 MR 评审时豁免 MR 评审必填字段（G14）；其余字段不受 GateSet 影响。 */
export function isWaivedByGateSet(gateSet: GateSet | undefined, field: string): boolean {
  return !!gateSet && gateSet.mrReview === false && field === MR_REVIEW_FIELD;
}

/**
 * 从声明维度推导 GateSet：找「声明集中最高档的被规则覆盖维度」所在规则为基准。
 * 未被规则覆盖的维度（如 schedule/release）不参与 top 竞争——只作 defaults 地板，
 * 不会把高覆盖维度挤回 defaults（I1：['data-model','release'] 仍按 data-model 规则）。
 * 声明集为空或全部未被覆盖时走 defaults。纯函数。
 */
export function deriveGateSet(matrix: GateMatrix, scopes: ChangeScope[]): GateSet {
  const covered = new Set(matrix.rules.flatMap((rule) => rule.scopes));
  const ranked = rankScopes(scopes);
  const top = ranked.find((scope) => covered.has(scope));
  const hit = top === undefined ? undefined : matrix.rules.find((rule) => rule.scopes.includes(top));
  const base = hit ?? matrix.defaults;
  return {
    scopes: ranked,
    skipStates: [...(base.skipStates ?? [])],
    environments: (base.environments ?? matrix.defaults.environments).slice(),
    mrReview: base.mrReview ?? matrix.defaults.mrReview,
    regression: base.regression ?? matrix.defaults.regression,
    rollbackPlan: base.rollbackPlan ?? matrix.defaults.rollbackPlan,
    overrides: [],
  };
}

/** 每个 overrideable 字段的末次改判值（账本后写覆盖先写）。 */
function lastOverridePerField(overrides: GateSet['overrides']): Map<string, string> {
  const last = new Map<string, string>();
  for (const entry of overrides) {
    if (OVERRIDE_FIELDS.has(entry.field)) last.set(entry.field, entry.to);
  }
  return last;
}

/** 改判账本的字符串值 → 字段类型；无法解析的返回 undefined（保持推导值，fail-closed 不抛）。 */
function parseOverrideValue(field: string, raw: string): boolean | 'affected-cases' | 'full' | undefined {
  if (field === 'mrReview' || field === 'rollbackPlan') return raw === 'true';
  if (field === 'regression') return raw === 'affected-cases' || raw === 'full' ? raw : undefined;
  return undefined;
}

/**
 * 棘轮（spec §3.2）：只升不降——并集维度重推导后，按字段重放「末次显式改判」，
 * 让账本最后一笔与实际值一致（I2）：显式降级是唯一合法的降级路径，经
 * overrideGateSet 落账后在后续维度扩张中存活；已冻结的保持冻结，账本原样保留。
 */
export function ratchetGateSet(current: GateSet, matrix: GateMatrix, newScopes: ChangeScope[], declaredScopes: ChangeScope[] = []): GateSet {
  // 种子 = 冻结的 gateSet.scopes ∪ DU.affectedScopes（bindGateSet 播种的声明集）∪ 本次新维度。
  // gateSet.scopes 与 affectedScopes 通常同源；并集保证旧 DU（affectedScopes 已播种但
  // gateSet 曾被手工构造）不丢维度——棘轮只升不降的前提是种子不缺。
  const merged = [...new Set([...current.scopes, ...declaredScopes, ...newScopes])];
  const derived = deriveGateSet(matrix, merged);
  const replayed = new Map([...lastOverridePerField(current.overrides)].flatMap(([field, raw]) => {
    const value = parseOverrideValue(field, raw);
    return value === undefined ? [] : [[field, value] as const];
  }));
  return { ...derived, ...Object.fromEntries(replayed), overrides: current.overrides, frozenAt: current.frozenAt };
}

/**
 * 显式改判（增/删门禁）：把一个可改判字段设为指定值并追加留痕，返回新 GateSet（不可变）。
 * 语义：这是唯一合法的降级路径——ratchetGateSet 重推导后会按字段重放「末次改判值」，
 * 想让降级在后续维度扩张中存活必须经本函数写入账本，而不是改内存对象。
 * value 类型与字段绑定（I4 泛型）：'mrReview'/'rollbackPlan' 只收 boolean，'regression' 只收档位。
 */
export function overrideGateSet<F extends GateSetOverrideField>(
  current: GateSet,
  field: F,
  value: GateSet[F],
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

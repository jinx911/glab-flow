import type { ChangeScope, GateEnvironment, GateMatrix, GateSet } from './types.js';

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
const SUPPORTED_SCOPES: ReadonlySet<ChangeScope> = new Set<ChangeScope>([
  'frontend-copy', 'functional', 'frontend-route', 'api-contract',
  'data-model', 'permission', 'schedule', 'release',
]);
const SUPPORTED_ENVIRONMENTS: ReadonlySet<GateEnvironment> = new Set<GateEnvironment>(['local', 'test']);

/** Runtime validation for scope arrays loaded from JSON/YAML, which bypasses TypeScript. */
export function gateScopeValidationErrors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ['scopes 必须是非空数组'];
  if (value.some((scope) => typeof scope !== 'string' || !SUPPORTED_SCOPES.has(scope as ChangeScope))) {
    return ['scopes 包含未支持的变更维度'];
  }
  if (new Set(value).size !== value.length) return ['scopes 不得重复'];
  return [];
}

/** Runtime validation for DU GateSets loaded from JSON/YAML, which bypasses TypeScript. */
export function gateSetValidationErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['GateSet 必须是对象'];
  const gateSet = value as Partial<GateSet>;
  const errors: string[] = [];
  const scopeErrors = gateScopeValidationErrors(gateSet.scopes);
  if (scopeErrors.length) errors.push(...scopeErrors.map((error) => `GateSet.${error}`));
  if (!Array.isArray(gateSet.skipStates)) {
    errors.push('GateSet.skipStates 必须是数组');
  } else {
    if (gateSet.skipStates.some((state) => typeof state !== 'string' || !state.trim())) {
      errors.push('GateSet.skipStates 必须仅包含非空字符串');
    }
    if (new Set(gateSet.skipStates).size !== gateSet.skipStates.length) {
      errors.push('GateSet.skipStates 不得重复');
    }
  }
  if (!Array.isArray(gateSet.environments) || gateSet.environments.length === 0) {
    errors.push('GateSet.environments 必须是非空数组');
  } else {
    if (new Set(gateSet.environments).size !== gateSet.environments.length) errors.push('GateSet.environments 不得重复');
    if (gateSet.environments.some((env) => typeof env !== 'string' || !SUPPORTED_ENVIRONMENTS.has(env))) {
      errors.push('GateSet.environments 仅支持 local/test，禁止空值、重复值或未支持环境');
    }
  }
  if (typeof gateSet.mrReview !== 'boolean') errors.push('GateSet.mrReview 必须是 boolean');
  if (gateSet.regression !== 'affected-cases' && gateSet.regression !== 'full') errors.push('GateSet.regression 必须是 affected-cases/full');
  if (typeof gateSet.rollbackPlan !== 'boolean') errors.push('GateSet.rollbackPlan 必须是 boolean');
  if (!Number.isInteger(gateSet.minUnitCases) || (gateSet.minUnitCases as number) < 0) errors.push('GateSet.minUnitCases 必须是非负整数');
  if (!Array.isArray(gateSet.overrides)) {
    errors.push('GateSet.overrides 必须是数组');
  } else if (gateSet.overrides.some((entry) => {
    if (!entry || typeof entry !== 'object') return true;
    const override = entry as Partial<GateSet['overrides'][number]>;
    return !OVERRIDE_FIELDS.has(override.field ?? '')
      || typeof override.from !== 'string'
      || typeof override.to !== 'string'
      || typeof override.by !== 'string'
      || typeof override.at !== 'string';
  })) {
    errors.push('GateSet.overrides 包含非法改判记录');
  }
  if (gateSet.frozenAt !== undefined && typeof gateSet.frozenAt !== 'string') {
    errors.push('GateSet.frozenAt 必须是字符串');
  }
  return errors;
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return [...new Set(a)].sort().join('|') === [...new Set(b)].sort().join('|');
}

/**
 * Ensure a persisted GateSet is the trusted matrix derivation for its scopes.
 * Only the three documented override fields may differ, and only when their
 * immutable override ledger replays to the persisted value.
 */
export function gateSetConsistencyErrors(
  matrix: GateMatrix,
  gateSet: GateSet,
  affectedScopes: ChangeScope[] = gateSet.scopes,
): string[] {
  const errors = gateSetValidationErrors(gateSet);
  if (errors.length) return errors;
  if (affectedScopes.some((scope) => !gateSet.scopes.includes(scope))) {
    errors.push('DU.affectedScopes 不得包含 GateSet.scopes 之外的维度');
  }
  const derived = deriveGateSet(matrix, gateSet.scopes);
  const expected = { ...derived };
  for (const override of gateSet.overrides) {
    const value = parseOverrideValue(override.field, override.to);
    if (value === undefined) {
      errors.push(`GateSet.overrides.${override.field} 的 to 值非法`);
      continue;
    }
    (expected as Record<string, unknown>)[override.field] = value;
  }
  if (!sameValues(gateSet.skipStates, expected.skipStates)) errors.push('GateSet.skipStates 与 gateMatrix 推导不一致');
  if (!sameValues(gateSet.environments, expected.environments)) errors.push('GateSet.environments 与 gateMatrix 推导不一致');
  if (gateSet.mrReview !== expected.mrReview) errors.push('GateSet.mrReview 与 gateMatrix/override 推导不一致');
  if (gateSet.regression !== expected.regression) errors.push('GateSet.regression 与 gateMatrix/override 推导不一致');
  if (gateSet.rollbackPlan !== expected.rollbackPlan) errors.push('GateSet.rollbackPlan 与 gateMatrix/override 推导不一致');
  if (gateSet.minUnitCases !== expected.minUnitCases) errors.push('GateSet.minUnitCases 与 gateMatrix 推导不一致');
  return errors;
}

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
 * 从声明维度推导 GateSet：单一规则沿用其明确配置；多个维度或存在
 * 未覆盖维度时组合要求，按更严格值收敛，避免低风险规则覆盖高风险事实。
 * 纯函数且与声明顺序无关。
 */
export function deriveGateSet(matrix: GateMatrix, scopes: ChangeScope[]): GateSet {
  const ranked = rankScopes(scopes);
  const rules = matrix.rules.filter((rule) => rule.scopes.some((scope) => ranked.includes(scope as ChangeScope)));
  const covered = new Set(matrix.rules.flatMap((rule) => rule.scopes));
  const hasUncovered = ranked.some((scope) => !covered.has(scope));
  const base = rules.length === 1 && !hasUncovered ? (rules[0] ?? matrix.defaults) : matrix.defaults;
  const matched = hasUncovered ? [matrix.defaults, ...rules] : (rules.length ? rules : [matrix.defaults]);
  const environments = [...new Set(matched.flatMap((rule) => rule.environments ?? []))];
  const requiresMrReview = matched.some((rule) => (rule.mrReview ?? matrix.defaults.mrReview) !== false);
  const regression = matched.some((rule) => (rule.regression ?? matrix.defaults.regression) === 'full') ? 'full' : 'affected-cases';
  const rollbackPlan = matched.some((rule) => (rule.rollbackPlan ?? matrix.defaults.rollbackPlan) === true);
  const minUnitCases = Math.max(...matched.map((rule) => rule.minUnitCases ?? matrix.defaults.minUnitCases ?? 0));
  const skipStates = matched.every((rule) => rule.skipStates?.length)
    ? [...new Set(matched.flatMap((rule) => rule.skipStates ?? []))]
    : [];
  return {
    scopes: ranked,
    skipStates: hasUncovered ? skipStates : [...(base.skipStates ?? skipStates)],
    environments: environments.length ? environments : [...matrix.defaults.environments],
    mrReview: requiresMrReview,
    regression,
    rollbackPlan,
    minUnitCases,
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

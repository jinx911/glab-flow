import type { ChangeImpact, ChangeImpactInput, ChangeTier, DuState, GateSet, GuardResult, StateMachine } from './types.js';
import { deriveChangeImpact, validateChangeImpactInput } from './change-impact.js';
import { ratchetGateSet } from './gate-set.js';
import { classifyChangeTier, isLightTier, TIER_BY_SCOPE } from './tier.js';

/**
 * 分级内核已移至 tier.ts：change.ts → change-impact.ts 的既有依赖方向不允许
 * change-impact.ts 反向 import change.js（会成环）；re-export 保住既有 API。
 */
export { classifyChangeTier, isLightTier, TIER_BY_SCOPE };

export interface ChangePlanInput extends ChangeImpactInput {
  du: DuState;
}

export interface ChangePlanOutput {
  tier: ChangeTier;
  impact: ChangeImpact;
  /** 棘轮扩容后的 GateSet（仅当扩容真的改变了门禁时输出）。 */
  expandedGateSet?: GateSet;
  /** 按级别的关闭要求：T3+ 才要求测试计划版本递增。 */
  closeRequiresPlanVersionBump: boolean;
}

/** planChange 的判别联合结果（照 WeekPlanValidation 先例：ok=true 必带 plan）。 */
export type ChangePlanResult =
  | (GuardResult & { ok: true; missing: []; reasons: []; plan: ChangePlanOutput })
  | (GuardResult & { ok: false; plan?: undefined });

/**
 * 判断棘轮扩容是否实质改变门禁。比较所有会改变执行约束的字段；
 * scopes 是门禁来源审计的一部分，minUnitCases 直接改变测试计划要求。
 * overrides/frozenAt 只记录来源与生命周期，不改变门禁约束本身。
 */
function sameValues(a: string[], b: string[]): boolean {
  return [...new Set(a)].sort().join('|') === [...new Set(b)].sort().join('|');
}

export function gateSetMateriallyChanged(a: GateSet, b: GateSet): boolean {
  return a.mrReview !== b.mrReview
    || !sameValues(a.skipStates, b.skipStates)
    || !sameValues(a.environments, b.environments)
    || a.regression !== b.regression
    || a.rollbackPlan !== b.rollbackPlan
    || a.minUnitCases !== b.minUnitCases
    || !sameValues(a.scopes, b.scopes);
}

/**
 * `change` 命令（spec §4.3）：在 change-impact 闭环上叠加定级与棘轮扩容。
 * 只推导不落盘——expandedGateSet 由 Leader 过目后写回 DU。无 gateMatrix
 * 或 DU 尚未绑定 GateSet 时不做扩容（保持既有推导路径）。
 */
export function planChange(model: StateMachine, input: ChangePlanInput): ChangePlanResult {
  const base = validateChangeImpactInput(input);
  if (!base.ok) return base as Extract<ChangePlanResult, { ok: false }>;
  const tier = classifyChangeTier(input.scopes);
  const impact = deriveChangeImpact(input);
  const current = input.du.gateSet;
  // current 存在时 expanded 才可能有值；扩容未实质改变门禁时不下发 expandedGateSet。
  // 棘轮种子含 DU.affectedScopes（bindGateSet 播种的声明集，防旧 DU 手工 gateSet 丢维度）。
  const expanded = current && model.gateMatrix
    ? ratchetGateSet(current, model.gateMatrix, input.scopes, input.du.affectedScopes)
    : undefined;
  const nextGateSet = expanded !== undefined && current !== undefined && gateSetMateriallyChanged(current, expanded) ? expanded : undefined;
  return {
    ok: true,
    missing: [],
    reasons: [],
    plan: {
      tier,
      impact,
      ...(nextGateSet ? { expandedGateSet: nextGateSet } : {}),
      closeRequiresPlanVersionBump: !isLightTier(tier),
    },
  };
}

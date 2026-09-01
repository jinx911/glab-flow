import type { ChangeImpact, ChangeImpactInput, ChangeScope, ChangeTier, DuState, GateSet, GuardResult, StateMachine } from './types.js';
import { deriveChangeImpact, validateChangeImpactInput } from './change-impact.js';
import { ratchetGateSet } from './gate-set.js';

/** 维度 → 级别映射；Record<ChangeScope, ChangeTier> 让新增维度在编译期强制补档。 */
const TIER_BY_SCOPE: Record<ChangeScope, ChangeTier> = {
  'frontend-copy': 'T1',
  functional: 'T2',
  'frontend-route': 'T2',
  'api-contract': 'T3',
  'data-model': 'T4',
  permission: 'T4',
  schedule: 'T1',
  release: 'T4',
};

const TIER_RANK: Record<ChangeTier, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

/** 变化分级（spec §4.3）：多维度取最高档；空集兜底 T1（validate 已拦空 scopes）。 */
export function classifyChangeTier(scopes: ChangeScope[]): ChangeTier {
  return scopes.reduce<ChangeTier>(
    (acc, scope) => (TIER_RANK[TIER_BY_SCOPE[scope]] > TIER_RANK[acc] ? TIER_BY_SCOPE[scope] : acc),
    'T1',
  );
}

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

/** 判断棘轮扩容是否实质改变门禁（mrReview/skipStates/regression/rollbackPlan 任一变化）。 */
function gateSetMateriallyChanged(a: GateSet, b: GateSet): boolean {
  return a.mrReview !== b.mrReview
    || a.skipStates.join() !== b.skipStates.join()
    || a.regression !== b.regression
    || a.rollbackPlan !== b.rollbackPlan;
}

/**
 * `change` 命令（spec §4.3）：在 change-impact 闭环上叠加定级与棘轮扩容。
 * 只推导不落盘——expandedGateSet 由 Leader 过目后写回 DU。无 gateMatrix
 * 或 DU 尚未绑定 GateSet 时不做扩容（保持既有推导路径）。
 */
export function planChange(model: StateMachine, input: ChangePlanInput): GuardResult & { plan?: ChangePlanOutput } {
  const base = validateChangeImpactInput(input);
  if (!base.ok) return base;
  const tier = classifyChangeTier(input.scopes);
  const impact = deriveChangeImpact(input);
  const current = input.du.gateSet;
  const expanded = model.gateMatrix && current ? ratchetGateSet(current, model.gateMatrix, input.scopes) : undefined;
  const changed = expanded !== undefined && current !== undefined && gateSetMateriallyChanged(current, expanded);
  return {
    ok: true,
    missing: [],
    reasons: [],
    plan: {
      tier,
      impact,
      ...(changed && expanded ? { expandedGateSet: expanded } : {}),
      closeRequiresPlanVersionBump: TIER_RANK[tier] >= TIER_RANK['T3'],
    },
  };
}

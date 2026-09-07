import type { ChangeScope, ChangeTier } from './types.js';

/**
 * 变化分级（spec §4.3）的纯函数内核。独立小模块的原因：change.ts（定级+棘轮）
 * 已 import change-impact.js，而 change-impact.ts 关闭校验又需要从 open 回读单
 * 重推导 tier——若分级函数留在 change.ts 会形成环。本模块只依赖 types.js。
 */

/** 维度 → 级别映射；Record<ChangeScope, ChangeTier> 让新增维度在编译期强制补档。 */
export const TIER_BY_SCOPE: Record<ChangeScope, ChangeTier> = {
  'frontend-copy': 'T1',
  functional: 'T2',
  'frontend-route': 'T2',
  'api-contract': 'T3',
  'data-model': 'T4',
  permission: 'T4',
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

/** 轻量档（spec §4.3 轻量关闭）：T1/T2 关闭时跳过「测试计划版本严格递增」检查。 */
export function isLightTier(tier: ChangeTier): boolean {
  return TIER_RANK[tier] < TIER_RANK['T3'];
}

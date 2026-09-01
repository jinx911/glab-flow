// engine/src/action-policy.ts
import type { Transition } from './types.js';

/** 动作分层（spec §3.3）：L1 可逆/非生产自动执行；L2 业务判断批量确认；L3 不可逆恒人工。 */
export type ActionTier = 'L1' | 'L2' | 'L3';

export interface ActionDecision {
  tier: ActionTier;
  /** L2/L3 时给 Leader 的一次性批量确认文案标题。 */
  batchTitle: string;
}

export function classifyAction(tr: Pick<Transition, 'gate' | 'hardGate'>): ActionDecision {
  if (tr.hardGate) {
    return { tier: 'L3', batchTitle: `硬门放行：${tr.gate ?? '不可逆动作'}（生产/终态，必须人工确认）` };
  }
  if (tr.gate) {
    return { tier: 'L2', batchTitle: `业务判断：${tr.gate}（评审结论/放行，一次批量确认）` };
  }
  return { tier: 'L1', batchTitle: '' };
}

/** 确认判定：L1 且校验通过 → 自动执行；其余需人工。run_mode 不再参与（spec §3.3）。 */
export function shouldConfirmFor(tr: Pick<Transition, 'gate' | 'hardGate'>, validateOk: boolean): boolean {
  if (!validateOk) return true;
  return classifyAction(tr).tier !== 'L1';
}

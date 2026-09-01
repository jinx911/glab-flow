import type { StateMachine, DuState, MissingItem, TransitionInput } from './types.js';
import { runTransition } from './transition.js';
import { TERMINAL } from './constants.js';

export type NextStepInput = Omit<TransitionInput, 'to'>;

export interface NextStepOutput {
  where: string;
  isTerminal: boolean;
  blockedOn: MissingItem[];
  /** 最快路径：从当前节点到终态还要经过的节点序列。 */
  fastestPath: string[];
  /** 谁欠什么：缺失字段按角色归组。 */
  owedBy: { role: string; items: string[] }[];
  /** 投影漂移：labels 与 DU/事实不一致时的对账提示（P5 前仅脏状态透传）。 */
  drift?: string;
  summary: string;
}

/** 主链最快路径：每节点取首条出边，直到终态或无出边（防环上限 12 跳）。 */
function fastestChain(model: StateMachine, type: TransitionInput['type'], from: string): string[] {
  const chain: string[] = [];
  let cur = from;
  for (let i = 0; i < 12; i++) {
    const trs = model[type].transitions.filter((t) => t.from === cur);
    if (!trs.length) break;
    chain.push(trs[0]!.to);
    cur = trs[0]!.to;
    if (TERMINAL.has(cur)) break;
  }
  return chain;
}

/** 缺失字段 → 角色归组（与 roleFields 的角色语义对齐的产品/测试/研发三类）。 */
function groupOwedBy(missing: MissingItem[]): { role: string; items: string[] }[] {
  const byRole = new Map<string, string[]>();
  for (const m of missing) {
    const owner = /评审|需求|验收|产品/.test(m.field) ? '产品' : /测试|复测|用例/.test(m.field) ? '测试' : '研发';
    byRole.set(owner, [...(byRole.get(owner) ?? []), m.field]);
  }
  return [...byRole.entries()].map(([role, items]) => ({ role, items }));
}

export function computeNextStep(model: StateMachine, input: NextStepInput): NextStepOutput {
  const out = runTransition(model, { ...input });
  if (out.dirty) {
    return { where: out.node ?? '?', isTerminal: false, blockedOn: [], fastestPath: [], owedBy: [], drift: out.dirtyReason, summary: `状态标签异常，需人工对账：${out.dirtyReason}` };
  }
  const node = out.node as string;
  if (TERMINAL.has(node)) {
    return { where: node, isTerminal: true, blockedOn: [], fastestPath: [], owedBy: [], summary: '已完成（终态）。剩余动作：资源清理（P4 起由 du.resources 驱动）。' };
  }
  const fastestPath = fastestChain(model, input.type, node);
  const owedBy = groupOwedBy(out.missing);
  const nextAction = out.validate.ok
    ? `可推进到「${out.next}」（${out.actionTier}：${out.actionTier === 'L1' ? '自动执行' : '批量确认'}）`
    : out.missing.length ? `补齐缺口后推进「${out.next}」` : `门禁未过：${out.validate.reasons[0] ?? ''}`;
  const summary = [`你在：${node}（#${input.iid}）`, `最快下一步：${nextAction}`, ...owedBy.map((o) => `待 ${o.role}：${o.items.join('、')}`)].join('\n');
  return { where: node, isTerminal: false, blockedOn: out.missing, fastestPath, owedBy, summary };
}

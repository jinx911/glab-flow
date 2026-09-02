import type { StateMachine, MissingItem, Role, TransitionInput } from './types.js';
import { runTransition } from './transition.js';
import { TERMINAL } from './constants.js';
import { cleanupChecklist } from './resource.js';

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

/** 非角色字段的关键词兜底（角色字段走 roleFields 反查）。 */
const FIELD_ROLE_KEYWORDS: { role: Role; pattern: RegExp }[] = [
  { role: '产品', pattern: /评审|需求|验收|产品/ },
  { role: '测试', pattern: /测试|复测|用例/ },
];

/**
 * 主链最快路径：每节点取首条出边，直到终态或无出边；跳数上限=该类型状态数。
 * 感知 GateSet.skipStates（与 transition 投影同口径）：被跳节点不出现在路径里，
 * 显示「这次真实会走的路」——frontend-copy 需求在开发中即显示直推待发布。
 */
function fastestChain(model: StateMachine, type: TransitionInput['type'], from: string, skipStates: string[] = []): string[] {
  const chain: string[] = [];
  let cur = from;
  for (let i = 0; i < model[type].states.length; i++) {
    const trs = model[type].transitions.filter((t) => t.from === cur);
    if (!trs.length) break;
    let next = trs[0]!.to;
    if (skipStates.includes(next)) {
      const beyond = model[type].transitions.filter((t) => t.from === next);
      if (beyond.length) next = beyond[0]!.to; // 只跳一层，与 transition 投影一致
    }
    chain.push(next);
    cur = next;
    if (TERMINAL.has(cur)) break;
  }
  return chain;
}

/** 缺失字段 → 角色归组：先查 roleFields 反查（权威映射），非角色字段按关键词兜底，其余归研发。 */
function groupOwedBy(model: StateMachine, missing: MissingItem[]): { role: string; items: string[] }[] {
  const fieldToRole = new Map<string, Role>();
  for (const [role, fields] of Object.entries(model.roleFields) as [Role, string[]][]) {
    for (const field of fields) fieldToRole.set(field, role);
  }
  const byRole = new Map<string, string[]>();
  for (const m of missing) {
    const owner = fieldToRole.get(m.field)
      ?? FIELD_ROLE_KEYWORDS.find(({ pattern }) => pattern.test(m.field))?.role
      ?? '研发';
    byRole.set(owner, [...(byRole.get(owner) ?? []), m.field]);
  }
  return [...byRole.entries()].map(([role, items]) => ({ role, items }));
}

export function computeNextStep(model: StateMachine, input: NextStepInput): NextStepOutput {
  const out = runTransition(model, { ...input });
  if (out.dirty) {
    return { where: out.node ?? '?', isTerminal: false, blockedOn: [], fastestPath: [], owedBy: [], drift: out.dirtyReason, summary: `状态标签异常，需人工对账：${out.dirtyReason}` };
  }
  // 非 dirty 时 runTransition 必有具体节点；防御性兜底与 dirty 同型输出。
  const node = out.node;
  if (!node) {
    const reason = '状态节点缺失：无法从标签解析当前节点（人工核对 type/status 标签后重跑）';
    return { where: '?', isTerminal: false, blockedOn: [], fastestPath: [], owedBy: [], drift: reason, summary: `状态标签异常，需人工对账：${reason}` };
  }
  if (TERMINAL.has(node)) {
    const pending = input.du ? cleanupChecklist(input.du) : [];
    return {
      where: node,
      isTerminal: true,
      blockedOn: [],
      fastestPath: [],
      owedBy: [],
      // R3：终态清单含 learn 升级建议（采集多蒸馏零的欠账——run 内 lessons 只有经 upgrade ritual 蒸馏进 knowledge.md 才会被后续 apply 注入）。
      summary: [
        pending.length
          ? `已完成（终态）。资源清理待办 ${pending.length} 项：${pending.map((p) => `${p.resourceId}(${p.suggestion})`).join('、')}`
          : '已完成（终态），无待清理资源。',
        ...(input.du?.metricEvents?.length ? [`建议运行 /glab-flow learn --upgrade：本轮采集了 ${input.du.metricEvents.length} 条指标事件与 run lessons，蒸馏进 knowledge.md 后才会被后续需求复用。`] : []),
      ].join('\n'),
    };
  }
  const fastestPath = fastestChain(model, input.type, node, input.du?.gateSet?.skipStates);
  const owedBy = groupOwedBy(model, out.missing);
  const nextAction = out.validate.ok
    ? `可推进到「${out.next}」（${out.actionTier}：${out.actionTier === 'L1' ? '自动执行' : '批量确认'}）`
    : out.missing.length ? `补齐缺口后推进「${out.next}」` : `门禁未过：${out.validate.reasons[0] ?? ''}`;
  const summary = [`你在：${node}（#${input.iid}）`, `最快下一步：${nextAction}`, ...owedBy.map((o) => `待 ${o.role}：${o.items.join('、')}`)].join('\n');
  return { where: node, isTerminal: false, blockedOn: out.missing, fastestPath, owedBy, summary };
}

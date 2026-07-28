import type { StateMachine, IssueType } from './types.js';
import { transitionFor } from './model.js';

export interface Invariants {
  storyStates: string[];
  bugStates: string[];
  transitions: [IssueType, string, string][];
  hardGates: [IssueType, string, string][];
  terminals: [IssueType, string, string][];
  returns: { type: IssueType; from: string; to: string; target: string }[];
}

export const INVARIANTS: Invariants = {
  storyStates: ['草稿中', '待评审', '已评审', '开发中', '测试中', '待发布', '生产验收中', '已完成'],
  bugStates: ['已确认缺陷', '开发中', '测试中', '待发布', '生产验证中', '已完成'],
  transitions: [
    ['story', '草稿中', '待评审'], ['story', '待评审', '已评审'], ['story', '已评审', '开发中'],
    ['story', '开发中', '测试中'], ['story', '测试中', '待发布'], ['story', '待发布', '生产验收中'],
    ['story', '生产验收中', '已完成'],
    ['bug', '已确认缺陷', '开发中'], ['bug', '开发中', '测试中'], ['bug', '测试中', '待发布'],
    ['bug', '待发布', '生产验证中'], ['bug', '生产验证中', '已完成'],
  ],
  hardGates: [['story', '待发布', '生产验收中'], ['story', '生产验收中', '已完成'],
              ['bug', '待发布', '生产验证中'], ['bug', '生产验证中', '已完成']],
  terminals: [['story', '生产验收中', '已完成'], ['bug', '生产验证中', '已完成']],
  returns: [
    { type: 'story', from: '待评审', to: '已评审', target: '草稿中' },
    { type: 'story', from: '测试中', to: '待发布', target: '开发中' },
  ],
};

export function assertModelContract(model: StateMachine, inv: Invariants): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!eq(model.story.states, inv.storyStates)) reasons.push('story states drift');
  if (!eq(model.bug.states, inv.bugStates)) reasons.push('bug states drift');
  for (const [t, f, to] of inv.transitions) if (!transitionFor(model, t, f, to)) reasons.push(`missing transition ${t} ${f}->${to}`);
  for (const [t, f, to] of inv.hardGates) if (!transitionFor(model, t, f, to)?.hardGate) reasons.push(`expected hardGate ${t} ${f}->${to}`);
  for (const [t, f, to] of inv.terminals) if (!transitionFor(model, t, f, to)?.terminal) reasons.push(`expected terminal ${t} ${f}->${to}`);
  for (const r of inv.returns) {
    const rt = transitionFor(model, r.type, r.from, r.to)?.return;
    if (!rt || rt.target !== r.target) reasons.push(`return target drift ${r.type} ${r.from}->${r.to} (want ${r.target})`);
  }
  return { ok: reasons.length === 0, reasons };
}

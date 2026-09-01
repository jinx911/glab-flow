import type { DuState, IssueType, StateMachine } from './types.js';
import { STATUS_PREFIX, TERMINAL } from './constants.js';

export interface ReconcileInput {
  type: IssueType;
  labels: string[];
  state: 'opened' | 'closed';
  du: DuState;
}

export type ReconcileVerdict =
  | { kind: 'in-sync' }
  | { kind: 'label-ahead'; labelNode: string; duNode: string; resolution: string }
  | { kind: 'du-ahead'; duNode: string; labelNode: string; resolution: string }
  | { kind: 'external-close'; resolution: string }
  | { kind: 'unknown-node'; labelNode?: string; duNode?: string; resolution: string }
  | { kind: 'dirty-labels'; resolution: string };

function modelIndex(model: StateMachine, type: IssueType, node: string): number {
  return model[type].states.indexOf(node);
}

/**
 * 对账（spec §3.5）：labels（投影）与 DU cachedNode（本地事实）不一致时不再抛
 * 「脏状态」异常，而是判定漂移方向并给出处理路径。外部事实（人工改标签/
 * 手动关闭）永远优先于引擎推导——引擎只裁决二选一，不代做决定。
 */
export function reconcileLabels(model: StateMachine, input: ReconcileInput): ReconcileVerdict {
  const prefix = STATUS_PREFIX[input.type];
  const status = input.labels.filter((label) => label.startsWith(prefix));
  if (status.length !== 1) {
    return { kind: 'dirty-labels', resolution: `状态标签缺失/冲突（期望 1 个 ${prefix}*，实际 ${status.length} 个）：人工修标签后重跑` };
  }
  const labelNode = status[0]!.slice(prefix.length);
  const duNode = input.du.cachedNode ?? '';
  if (input.state === 'closed' && !TERMINAL.has(labelNode)) {
    return { kind: 'external-close', resolution: 'Issue 被人工关闭：确认验收事实后补终态评论，或 reopen' };
  }
  if (!duNode || labelNode === duNode) return { kind: 'in-sync' };
  // 方向比较有意义的前提是双方都在状态机里；不在的先按 unknown-node 报，
  // 否则 indexOf 的 -1 会把「标签尾随空格/笔误」误判成 label-ahead。
  const labelIndex = modelIndex(model, input.type, labelNode);
  if (labelIndex === -1) {
    return { kind: 'unknown-node', labelNode, duNode, resolution: `标签节点 ${labelNode} 不在状态机 states 中——标签/DU 是否被手改` };
  }
  const duIndex = modelIndex(model, input.type, duNode);
  if (duIndex === -1) {
    return { kind: 'unknown-node', duNode, resolution: `DU 节点 ${duNode} 不在状态机 states 中——标签/DU 是否被手改` };
  }
  if (labelIndex > duIndex) {
    return { kind: 'label-ahead', labelNode, duNode, resolution: '人工推进了标签：将 DU 对齐到标签（接受人工推进）或回改标签（以 DU 为准）——一次 L2 确认' };
  }
  return { kind: 'du-ahead', duNode, labelNode, resolution: 'DU 领先：补发流转评论并写回标签（上次写回可能中断，见 writebackAudit）' };
}

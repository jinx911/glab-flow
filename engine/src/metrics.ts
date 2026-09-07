import type { DuMetricEvent, DuState } from './types.js';

/** 流程终态自动统计（spec §7）：确认/流转/重测/环境阻塞/返工/人工介入次数 + 周期。 */
export interface DeliveryMetrics {
  confirmations: number;
  transitions: number;
  reruns: number;
  envBlocks: number;
  reworks: number;
  manualInterventions: number;
  /** 从首个 transition 到最后 transition 的时长（ms）；<2 个 transition 事件时缺省。 */
  cycleMs?: number;
}

/** 记一条指标事件（Leader 调用；事件由 Leader 写入 DU，引擎只做不可变追加）。 */
export function recordMetric(du: DuState, event: DuMetricEvent): DuState {
  return { ...du, metricEvents: [...du.metricEvents, event], updatedAt: event.at };
}

/** 终态纯汇总：逐 kind 计数 + 首末 transition 时间戳求差（不可解析时间戳忽略）。 */
export function summarizeMetrics(du: DuState): DeliveryMetrics {
  const count = (kind: DuMetricEvent['kind']): number => du.metricEvents.filter((e) => e.kind === kind).length;
  const stamps = du.metricEvents
    .filter((e) => e.kind === 'transition')
    .map((e) => Date.parse(e.at))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  const first = stamps[0];
  const last = stamps[stamps.length - 1];
  return {
    confirmations: count('confirm'),
    transitions: count('transition'),
    reruns: count('rerun'),
    envBlocks: count('env-block'),
    reworks: count('rework'),
    manualInterventions: count('manual-intervention'),
    ...(first !== undefined && last !== undefined && stamps.length >= 2 ? { cycleMs: last - first } : {}),
  };
}

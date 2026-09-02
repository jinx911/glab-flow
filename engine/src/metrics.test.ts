import { describe, expect, it } from 'vitest';
import { initDu } from './du.js';
import { recordMetric, summarizeMetrics } from './metrics.js';

const T0 = '2026-09-01T00:00:00Z';
const T1 = '2026-09-05T00:00:00Z';
const DAY_MS = 24 * 3600 * 1000;

describe('metrics', () => {
  it('counts each event kind', () => {
    let du = initDu({ iid: 88, type: 'story', now: T0 });
    du = recordMetric(du, { at: T0, kind: 'confirm' });
    du = recordMetric(du, { at: T0, kind: 'confirm' });
    du = recordMetric(du, { at: T0, kind: 'rerun' });
    du = recordMetric(du, { at: T0, kind: 'env-block' });
    du = recordMetric(du, { at: T0, kind: 'rework' });
    du = recordMetric(du, { at: T0, kind: 'manual-intervention' });
    const m = summarizeMetrics(du);
    expect(m.confirmations).toBe(2);
    expect(m.reruns).toBe(1);
    expect(m.envBlocks).toBe(1);
    expect(m.reworks).toBe(1);
    expect(m.manualInterventions).toBe(1);
    expect(m.transitions).toBe(0);
  });
  it('computes cycle from first to last transition stamp', () => {
    let du = initDu({ iid: 88, type: 'story', now: T0 });
    du = recordMetric(du, { at: T0, kind: 'transition' });
    du = recordMetric(du, { at: '2026-09-03T00:00:00Z', kind: 'confirm' });
    du = recordMetric(du, { at: T1, kind: 'transition' });
    expect(summarizeMetrics(du).cycleMs).toBe(4 * DAY_MS);
  });
  it('omits cycleMs with fewer than two transitions', () => {
    const du = recordMetric(initDu({ iid: 88, type: 'story', now: T0 }), { at: T0, kind: 'transition' });
    expect(summarizeMetrics(du).cycleMs).toBeUndefined();
  });
  it('ignores unparseable timestamps for cycle computation', () => {
    let du = initDu({ iid: 88, type: 'story', now: T0 });
    du = recordMetric(du, { at: 'garbage', kind: 'transition' });
    du = recordMetric(du, { at: T0, kind: 'transition' });
    du = recordMetric(du, { at: T1, kind: 'transition' });
    expect(summarizeMetrics(du).cycleMs).toBe(4 * DAY_MS);
  });
  it('recordMetric is immutable', () => {
    const du = initDu({ iid: 88, type: 'story', now: T0 });
    const next = recordMetric(du, { at: T0, kind: 'confirm' });
    expect(du.metricEvents).toHaveLength(0);
    expect(next.metricEvents).toHaveLength(1);
    expect(next.updatedAt).toBe(T0);
  });
});

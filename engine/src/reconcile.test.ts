import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { reconcileLabels } from './reconcile.js';
import { initDu } from './du.js';
import type { DuState, IssueType } from './types.js';

const model = loadModel();
const T = '2026-09-01T00:00:00Z';
const freshDu = initDu({ iid: 88, type: 'story', now: T });
const duAt = (node: string): DuState => ({ ...freshDu, cachedNode: node });

const input = (overrides: { labels?: string[]; state?: 'opened' | 'closed'; du: DuState; type?: IssueType }) => ({
  type: 'story' as const,
  labels: overrides.labels ?? ['type::story', 'story-status::开发中'],
  state: overrides.state ?? 'opened',
  du: overrides.du,
});

describe('reconcileLabels', () => {
  it('fails closed when DU has no cached node baseline', () => {
    expect(reconcileLabels(model, input({ du: freshDu })).kind).toBe('unknown-node');
  });

  it('detects label-ahead drift when human advanced label', () => {
    expect(reconcileLabels(model, input({ du: duAt('已评审') })).kind).toBe('label-ahead');
  });

  it('detects du-ahead drift', () => {
    expect(reconcileLabels(model, input({ du: duAt('测试中') })).kind).toBe('du-ahead');
  });

  it('external-close flags non-terminal closed issue', () => {
    const verdict = reconcileLabels(model, input({
      labels: ['type::story', 'story-status::待发布'],
      state: 'closed',
      du: duAt('待发布'),
    }));
    expect(verdict.kind).toBe('external-close');
  });

  it('in-sync when a terminal-node issue is closed normally', () => {
    const verdict = reconcileLabels(model, input({
      labels: ['type::story', 'story-status::已完成'],
      state: 'closed',
      du: duAt('已完成'),
    }));
    expect(verdict.kind).toBe('in-sync');
  });

  it('dirty-labels when status label missing or duplicated', () => {
    const missing = reconcileLabels(model, input({ labels: ['type::story'], du: duAt('开发中') }));
    expect(missing.kind).toBe('dirty-labels');
    const duplicated = reconcileLabels(model, input({
      labels: ['type::story', 'story-status::开发中', 'story-status::测试中'],
      du: duAt('开发中'),
    }));
    expect(duplicated.kind).toBe('dirty-labels');
  });

  it('in-sync when nodes match', () => {
    expect(reconcileLabels(model, input({ du: duAt('开发中') })).kind).toBe('in-sync');
  });

  it('resolution text names both nodes for drift verdicts', () => {
    const ahead = reconcileLabels(model, input({ du: duAt('已评审') })) as { kind: string; labelNode: string; duNode: string };
    expect(ahead.labelNode).toBe('开发中');
    expect(ahead.duNode).toBe('已评审');
  });

  it('unknown-node (not du-ahead) when label has trailing whitespace', () => {
    const verdict = reconcileLabels(model, input({
      labels: ['type::story', 'story-status::开发中 '],
      du: duAt('开发中'),
    }));
    expect(verdict.kind).toBe('unknown-node');
  });

  it('unknown-node when the DU cached node is a typo outside the state machine', () => {
    const verdict = reconcileLabels(model, input({ du: duAt('开发 中') }));
    expect(verdict.kind).toBe('unknown-node');
  });
});

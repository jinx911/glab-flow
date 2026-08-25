import { describe, it, expect } from 'vitest';
import { loadModel, currentNode, transitionFor, requiredFields, assigneeRole, returnTarget, progressStepsFor } from './model.js';

const model = loadModel();

describe('model', () => {
  it('derives current story node from labels', () => {
    expect(currentNode(model, 'story', ['type::story', 'story-status::待评审'])).toBe('待评审');
  });
  it('returns null when no story-status label', () => {
    expect(currentNode(model, 'story', ['type::story'])).toBeNull();
  });
  it('finds a forward transition', () => {
    const t = transitionFor(model, 'story', '待评审', '已评审');
    expect(t?.gate).toBe('需求评审');
    expect(t?.gateOutcome).toEqual(['通过', '退回']);
  });
  it('lists required fields for a transition', () => {
    expect(requiredFields(model, 'story', '待评审', '已评审')).toContain('评审日期');
  });
  it('returns target-node assignee role', () => {
    expect(assigneeRole(model, 'story', '待评审', '已评审')).toBe('研发');
  });
  it('returns return target for a gated transition', () => {
    expect(returnTarget(model, 'story', '待评审', '已评审')?.target).toBe('草稿中');
  });
  it('marks hard-gate transitions', () => {
    expect(transitionFor(model, 'story', '待发布', '生产验收中')?.hardGate).toBe(true);
  });
  it('marks terminal transitions', () => {
    expect(transitionFor(model, 'story', '生产验收中', '已完成')?.terminal).toBe(true);
  });
});

describe('progressStepsFor (node sub-step checklist)', () => {
  it('returns the 开发中 checklist', () => {
    expect(progressStepsFor(model, '开发中')).toEqual(['技术方案', '测试计划', '编码实现', '本地自测', '代码评审']);
  });
  it('returns [] for terminal 已完成', () => {
    expect(progressStepsFor(model, '已完成')).toEqual([]);
  });
  it('returns [] for null/unknown node', () => {
    expect(progressStepsFor(model, null)).toEqual([]);
    expect(progressStepsFor(model, '不存在')).toEqual([]);
  });
});

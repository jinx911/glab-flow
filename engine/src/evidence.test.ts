import { describe, it, expect } from 'vitest';
import { extractEvidence } from './evidence.js';
import { renderStatusChange } from './render.js';
import type { Payload } from './types.js';

describe('extractEvidence', () => {
  it('extracts a 状态变更 block from a comment', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' }, assigneeUser: '@dev' };
    const ev = extractEvidence([{ body: renderStatusChange(p) }]);
    expect(ev.stateChanges.length).toBe(1);
    expect(ev.stateChanges[0]!.实际日期).toBe('2026-07-28');
    expect(ev.stateChanges[0]!.结论).toBe('通过');
    expect(ev.latest?.结论).toBe('通过');
  });
  it('handles multiple comments and multiple blocks, latest = last', () => {
    const c1 = renderStatusChange({ type: 'story', from: '草稿中', to: '待评审', fields: { 实际日期: '2026-07-20' }, assigneeUser: '@pm' });
    const c2 = renderStatusChange({ type: 'story', from: '待评审', to: '已评审', fields: { 实际日期: '2026-07-28', 评审结论: '通过' }, assigneeUser: '@dev' });
    const ev = extractEvidence([{ body: c1 }, { body: 'some discussion' }, { body: c2 }]);
    expect(ev.stateChanges.length).toBe(2);
    expect(ev.latest?.实际日期).toBe('2026-07-28');
  });
  it('returns empty when no 状态变更 blocks', () => {
    const ev = extractEvidence([{ body: 'just chat' }, { body: '## 别的标题\n- x：y' }]);
    expect(ev.stateChanges.length).toBe(0);
    expect(ev.latest).toBeUndefined();
  });
});

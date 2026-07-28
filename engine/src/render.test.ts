import { describe, it, expect } from 'vitest';
import { renderStatusChange, renderReturn } from './render.js';
import type { Payload } from './types.js';

describe('render', () => {
  it('renders a 状态变更 comment from structured fields', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
      assigneeUser: '@dev' };
    const md = renderStatusChange(p);
    expect(md).toContain('## 状态变更');
    expect(md).toContain('`待评审` → `已评审`');
    expect(md).toContain('2026-07-28');
    expect(md).toContain('@pm');
  });
  it('renders a 退回 comment with the 问题清单', () => {
    const md = renderReturn('草稿中', ['范围未明确', '验收标准缺失'], '@pm', '2026-07-28');
    expect(md).toContain('退回：`草稿中`');
    expect(md).toContain('范围未明确');
  });
});

import { describe, it, expect } from 'vitest';
import { renderStatusChange, renderReturn, renderChangeRequest, renderTestIssue, renderCorrection } from './render.js';
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
  it('emits every field, including ones without a semantic label', () => {
    const p: Payload = { type: 'story', from: '已评审', to: '开发中',
      fields: { 实际开始日期: '2026-07-28', 研发Assignee: '@dev', 计划提测时间: '2026-08-10', 计划上线时间: '2026-08-20', 技术方案评审通过记录或免评审结论: '免评审' },
      assigneeUser: '@dev' };
    const md = renderStatusChange(p);
    expect(md).toContain('计划提测时间：2026-08-10');
    expect(md).toContain('计划上线时间：2026-08-20');
    expect(md).toContain('依据：免评审');
  });
});

describe('extra templates', () => {
  it('renders 需求变更申请', () => {
    const md = renderChangeRequest({ 提出人: '@pm', 变更原因: '范围扩大', 建议: '待重新评审' });
    expect(md).toContain('## 需求变更申请');
    expect(md).toContain('- 提出人：@pm');
    expect(md).toContain('- 变更原因：范围扩大');
    expect(md).toContain('- 建议：待重新评审');
  });
  it('renders 测试问题', () => {
    const md = renderTestIssue({ 发现人: '@qa', 是否阻塞发布: '是', 当前结论: '待处理' });
    expect(md).toContain('## 测试问题');
    expect(md).toContain('- 是否阻塞发布：是');
  });
  it('renders 补充/更正 and skips empty fields', () => {
    const md = renderCorrection({ 对应节点: '已评审', 更正内容: '验收标准补充' });
    expect(md).toContain('## 补充/更正');
    expect(md).toContain('- 对应节点：已评审');
    expect(md).not.toContain('原记录链接');
  });
});

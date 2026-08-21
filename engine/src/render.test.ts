import { describe, it, expect } from 'vitest';
import { renderStatusChange, renderReturn, renderChangeRequest, renderTestIssue, renderCorrection, renderNodeComment } from './render.js';
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

describe('renderNodeComment — 合并评论(状态头 + 内容体)', () => {
  it('已评审→开发中:状态头 + 技术方案内容体 + 兜底', () => {
    const md = renderNodeComment({
      type: 'story', from: '已评审', to: '开发中',
      fields: {
        技术方案评审通过记录或免评审结论: '技评通过', 实际开始日期: '2026-08-13', 研发Assignee: '@dev',
        计划提测时间: '2026-08-20', 计划上线时间: '2026-09-01',
        方案概述: '部分扣减', 回滚方案: 'down()',
      },
      assigneeUser: '@dev',
    });
    expect(md).toContain('## 状态变更');
    expect(md).toContain('`已评审` → `开发中`');
    expect(md).toContain('- 实际日期：2026-08-13');
    expect(md).toContain('- 依据：技评通过');
    expect(md).toContain('## 技术方案');
    expect(md).toContain('- 方案概述：部分扣减');
    expect(md).toContain('- 回滚方案：down()');
    expect(md).toContain('- 计划提测时间：2026-08-20');
  });

  it('内容字段缺失则跳过内容体(不卡流转)', () => {
    const md = renderNodeComment({ type: 'story', from: '已评审', to: '开发中', fields: { 实际开始日期: '2026-08-13' }, assigneeUser: '@dev' });
    expect(md).not.toContain('## 技术方案');
    expect(md).toContain('## 状态变更');
  });

  it('草稿中→待评审:需求提案要点', () => {
    const md = renderNodeComment({ type: 'story', from: '草稿中', to: '待评审', fields: { 背景: 'b', 目标: 'g' }, assigneeUser: '@pm' });
    expect(md).toContain('## 需求提案要点');
    expect(md).toContain('- 背景：b');
  });

  it('bug 已确认缺陷→开发中:缺陷复现与根因', () => {
    const md = renderNodeComment({ type: 'bug', from: '已确认缺陷', to: '开发中', fields: { 复现步骤: 's', 根因: 'r' }, assigneeUser: '@dev' });
    expect(md).toContain('## 缺陷复现与根因');
    expect(md).toContain('- 根因：r');
  });

  it('appends the exact valid Week Plan only to Story review approval comments', () => {
    const md = renderNodeComment({
      type: 'story', from: '待评审', to: '已评审', fields: { 评审结论: '通过' },
      weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true },
      assigneeUser: '@dev',
    });
    expect(md).toContain(`## 周排期

- 计划开始：2026-08-17
- 计划完成：2026-09-06
- 计划覆盖周：W34 ～ W36
- 自动 rollover：启用`);
    const nonReview = renderNodeComment({
      type: 'story', from: '已评审', to: '开发中', fields: {}, assigneeUser: '@dev',
      weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true },
    });
    expect(nonReview).not.toContain('## 周排期');
  });

  it('does not render a Week Plan heading from malformed runtime data', () => {
    const md = renderNodeComment({
      type: 'story', from: '待评审', to: '已评审', fields: {}, assigneeUser: '@dev',
      weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', coverage: 'W34 ～ W36', autoRollover: '启用' },
    } as unknown as Payload);
    expect(md).not.toContain('## 周排期');
  });
});

describe('测试报告环境字段(测试中→待发布,issue 环境接入)', () => {
  it('渲染 测试环境/测试账号 进合并评论', () => {
    const md = renderNodeComment({
      type: 'story', from: '测试中', to: '待发布',
      fields: { 测试环境: 'stage https://stage-oa.kuainiu.io', 测试账号: 'dengken@kn.group', 回归详情: '回归通过' },
      assigneeUser: '@dev',
    });
    expect(md).toContain('## 测试报告');
    expect(md).toContain('- 测试环境：stage https://stage-oa.kuainiu.io');
    expect(md).toContain('- 测试账号：dengken@kn.group');
  });
  it('环境字段缺失时不渲染空行(不卡流转,与内容体语义一致)', () => {
    const md = renderNodeComment({ type: 'story', from: '测试中', to: '待发布', fields: { 回归详情: 'r' }, assigneeUser: '@dev' });
    expect(md).toContain('## 测试报告');
    expect(md).not.toContain('测试环境：');
  });
});

describe('测试报告双轨证据(issue 31:执行证据 vs 资产状态)', () => {
  it('渲染 reportId与环境/请求与断言统计/Apifox资产状态 进合并评论', () => {
    const md = renderNodeComment({
      type: 'story', from: '测试中', to: '待发布',
      fields: {
        测试环境: 'stage https://stage-oa.kuainiu.io',
        reportId与环境: '25522733 | https://app.apifox.com/link/... | environmentName=Stage(test-report get 回读);场景页签为空,项目级报告为准',
        请求与断言统计: 'requests 25/25 passed, assertions 25/25 passed',
        Apifox资产状态: '场景/套件已归位(Stage 套件 28005/28044);矩阵未沉淀 test-data(散在场景+seed)',
        回归详情: '全场景回归通过',
      },
      assigneeUser: '@dev',
    });
    expect(md).toContain('- reportId与环境：25522733');
    expect(md).toContain('- 请求与断言统计：requests 25/25');
    expect(md).toContain('- Apifox资产状态：场景/套件已归位');
  });
  it('资产字段缺失时跳过(不卡流转)', () => {
    const md = renderNodeComment({ type: 'story', from: '测试中', to: '待发布', fields: { 回归详情: 'r' }, assigneeUser: '@dev' });
    expect(md).not.toContain('Apifox资产状态：');
    expect(md).not.toContain('reportId与环境：');
  });
});

import { describe, it, expect } from 'vitest';
import { renderStatusChange, renderReturn, renderChangeRequest, renderTestIssue, renderCorrection, renderNodeComment } from './render.js';
import type { Payload } from './types.js';
import { initDu, recordEvidence } from './du.js';
import { registerResource } from './resource.js';
import { recordMetric } from './metrics.js';
import { deriveGateSet, freezeGateSet } from './gate-set.js';
import { loadModel } from './model.js';

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
  it('renders verified plan and environment-run references instead of free-text self-test claims', () => {
    const submission = renderNodeComment({
      type: 'story', from: '开发中', to: '测试中',
      fields: { 测试计划版本: 'v3', Apifox资产审计记录: 'Issue note #100', local测试执行记录: 'Issue note #101', 自测计划: '旧自由文本' }, assigneeUser: '@qa',
    });
    const acceptance = renderNodeComment({
      type: 'story', from: '测试中', to: '待发布',
      fields: { 测试计划版本: 'v3', test测试执行记录: 'Issue note #102' }, assigneeUser: '@dev',
    });
    expect(submission).toContain('- 测试计划版本：v3');
    expect(submission).toContain('- Apifox资产审计记录：Issue note #100');
    expect(submission).toContain('- local测试执行记录：Issue note #101');
    expect(submission).not.toContain('- 自测计划：旧自由文本');
    expect(acceptance).toContain('- test测试执行记录：Issue note #102');
  });

  it('渲染 测试环境/测试账号 进合并评论', () => {
    const md = renderNodeComment({
      type: 'story', from: '测试中', to: '待发布',
      fields: { 测试环境: 'test https://app.test.example', 测试账号: 'tester@example.test', 回归详情: '回归通过' },
      assigneeUser: '@dev',
    });
    expect(md).toContain('## 测试报告');
    expect(md).toContain('- 测试环境：test https://app.test.example');
    expect(md).toContain('- 测试账号：tester@example.test');
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
        测试环境: 'test https://app.test.example',
        reportId与环境: '<报告 ID> | https://app.apifox.com/link/... | environmentName=test(test-report get 回读);场景页签为空,项目级报告为准',
        请求与断言统计: 'requests 25/25 passed, assertions 25/25 passed',
        Apifox资产状态: '场景/套件已归位(test 套件);矩阵未沉淀 test-data(散在场景+seed)',
        回归详情: '全场景回归通过',
      },
      assigneeUser: '@dev',
    });
    expect(md).toContain('- reportId与环境：<报告 ID>');
    expect(md).toContain('- 请求与断言统计：requests 25/25');
    expect(md).toContain('- Apifox资产状态：场景/套件已归位');
  });
  it('资产字段缺失时跳过(不卡流转)', () => {
    const md = renderNodeComment({ type: 'story', from: '测试中', to: '待发布', fields: { 回归详情: 'r' }, assigneeUser: '@dev' });
    expect(md).not.toContain('Apifox资产状态：');
    expect(md).not.toContain('reportId与环境：');
  });
});

describe('证据摘要块（DU 事实上传团队可见）', () => {
  const T = '2026-09-01T00:00:00Z';
  const basePayload = (du?: Payload['du']): Payload => ({
    type: 'story', from: '开发中', to: '测试中',
    fields: { 提测日期: '2026-09-01', 研发Assignee: '@dev', 测试说明: 's' },
    assigneeUser: '@qa',
    ...(du ? { du } : {}),
  });

  it('DU 传入时自动追加证据摘要（执行/审计结论 + 报告指针）', () => {
    let du = initDu({ iid: 88, type: 'story', now: T });
    du = recordEvidence(du, { kind: 'asset-audit', environment: 'local', planVersion: 'v3', outcome: 'v3-audit', recordedAt: T }, T);
    du = recordEvidence(du, { kind: 'test-run', environment: 'local', planVersion: 'v3', outcome: 'passed', recordedAt: T, detailRef: 'api=report:101' }, T);
    du = registerResource(du, { id: 'TMP-88-export', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    du = recordMetric(du, { at: T, kind: 'confirm' });
    du = recordMetric(du, { at: T, kind: 'confirm' });
    const md = renderNodeComment(basePayload(du));
    expect(md).toContain('## 证据摘要');
    expect(md).toContain('- local：执行 v3 / passed / api=report:101；审计 v3 / v3-audit');
    expect(md).toContain('- 资源登记：1 项在册');
    expect(md).toContain('- 指标：确认 2 次 / 流转 0 次');
  });

  it('无 DU 时不含证据摘要（存量 Issue 行为不变）', () => {
    const md = renderNodeComment(basePayload());
    expect(md).not.toContain('## 证据摘要');
  });

  it('DU 无任何事实/资源/指标时也不追加空摘要块', () => {
    const md = renderNodeComment(basePayload(initDu({ iid: 88, type: 'story', now: T })));
    expect(md).not.toContain('## 证据摘要');
  });

  it('gateSet 存在时摘要含门禁单行（冻结的门禁对团队可见）', () => {
    const gs = freezeGateSet(deriveGateSet(loadModel().gateMatrix!, ['api-contract']), T);
    const du = { ...initDu({ iid: 88, type: 'story', now: T }), gateSet: gs };
    const md = renderNodeComment(basePayload(du));
    expect(md).toContain('- 门禁单：api-contract（local/test，MR 评审要求，回归=full）');
  });
});

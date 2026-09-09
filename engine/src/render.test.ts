import { describe, it, expect } from 'vitest';
import { renderStatusChange, renderReturn, renderChangeRequest, renderTestIssue, renderCorrection, renderNodeComment, validatePublicComment, NODE_CONTENT } from './render.js';
import { loadModel } from './model.js';
import type { Payload } from './types.js';

describe('render', () => {
  it('renders a 状态变更 comment from structured fields', () => {
    const p: Payload = { type: 'story', from: '待评审', to: '已评审',
      fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
      assigneeUser: '@dev' };
    const md = renderStatusChange(p);
    expect(md).toContain('## 状态变更');
    expect(md).toContain('| 项目 | 内容 |');
    expect(md).toContain('| 变更 | `待评审` → `已评审` |');
    expect(md).toContain('`待评审` → `已评审`');
    expect(md).toContain('2026-07-28');
    expect(md).toContain('@pm');
    expect(md).not.toContain('glab-flow:field-index');
  });
  it('renders a 退回 comment with the 问题清单', () => {
    const md = renderReturn('草稿中', ['范围未明确', '验收标准缺失'], '@pm', '2026-07-28');
    expect(md).toContain('| 退回 | `草稿中` |');
    expect(md).toContain('范围未明确');
  });
  it('emits every field, including ones without a semantic label', () => {
    const p: Payload = { type: 'story', from: '已评审', to: '开发中',
      fields: { 实际开始日期: '2026-07-28', 研发Assignee: '@dev', 计划提测时间: '2026-08-10', 计划上线时间: '2026-08-20', 技术方案评审通过记录或免评审结论: '免评审' },
      assigneeUser: '@dev' };
    const md = renderStatusChange(p);
    expect(md).toContain('| 计划提测时间 | 2026-08-10 |');
    expect(md).toContain('| 计划上线时间 | 2026-08-20 |');
    expect(md).toContain('| 依据 | 免评审 |');
  });
});

describe('extra templates', () => {
  it('renders 需求变更申请', () => {
    const md = renderChangeRequest({ 提出人: '@pm', 变更原因: '范围扩大', 建议: '待重新评审' });
    expect(md).toContain('## 需求变更申请');
    expect(md).toContain('| 提出人 | @pm |');
    expect(md).toContain('| 变更原因 | 范围扩大 |');
    expect(md).toContain('| 建议 | 待重新评审 |');
  });
  it('renders 测试问题', () => {
    const md = renderTestIssue({ 发现人: '@qa', 是否阻塞发布: '是', 当前结论: '待处理' });
    expect(md).toContain('## 测试问题');
    expect(md).toContain('| 是否阻塞发布 | 是 |');
  });
  it('renders 补充/更正 and skips empty fields', () => {
    const md = renderCorrection({ 对应节点: '已评审', 更正内容: '验收标准补充' });
    expect(md).toContain('## 补充/更正');
    expect(md).toContain('| 对应节点 | 已评审 |');
    expect(md).not.toContain('原记录链接');
  });
});

describe('renderNodeComment — 合并评论(状态头 + 内容体)', () => {
  it('covers every canonical transition with a node comment template', () => {
    const model = loadModel();
    const canonical = [
      ...model.story.transitions.map((transition) => `story:${transition.from}:${transition.to}`),
      ...model.bug.transitions.map((transition) => `bug:${transition.from}:${transition.to}`),
      // GateSet skip projection can render the projected final target directly.
      'story:开发中:待发布',
      'bug:开发中:待发布',
    ];
    expect([...new Set(canonical)].filter((key) => !NODE_CONTENT[key])).toEqual([]);
  });

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
    expect(md).toContain('| 实际日期 | 2026-08-13 |');
    expect(md).toContain('| 依据 | 技评通过 |');
    expect(md).toContain('## 技术方案');
    expect(md).toContain('| 方案概述 | 部分扣减 |');
    expect(md).toContain('| 回滚方案 | down() |');
    expect(md).toContain('| 计划提测时间 | 2026-08-20 |');
  });

  it('内容字段缺失则跳过内容体(不卡流转)', () => {
    const md = renderNodeComment({ type: 'story', from: '已评审', to: '开发中', fields: { 实际开始日期: '2026-08-13' }, assigneeUser: '@dev' });
    expect(md).not.toContain('## 技术方案');
    expect(md).toContain('## 状态变更');
  });

  it('草稿中→待评审:需求提案要点', () => {
    const md = renderNodeComment({ type: 'story', from: '草稿中', to: '待评审', fields: { 背景: 'b', 目标: 'g' }, assigneeUser: '@pm' });
    expect(md).toContain('## 需求提案要点');
    expect(md).toContain('| 背景 | b |');
  });

  it('待评审→已评审:评审意见包含诉求理解、改进建议和提单人反馈', () => {
    const md = renderNodeComment({
      type: 'story',
      from: '待评审',
      to: '已评审',
      fields: {
        用户诉求理解: '减少审批人重复操作',
        评审要点: '范围、角色、验收均已确认',
        改进建议: '将批量催办作为配置项，默认关闭',
        交互优化建议: '列表页增加批量入口与二次确认',
        提单人反馈结论: '采纳交互优化，方案配置化暂缓',
      },
      assigneeUser: '@dev',
    });
    expect(md).toContain('## 评审意见');
    expect(md).toContain('| 用户诉求理解 | 减少审批人重复操作 |');
    expect(md).toContain('| 改进建议 | 将批量催办作为配置项，默认关闭 |');
    expect(md).toContain('| 交互优化建议 | 列表页增加批量入口与二次确认 |');
    expect(md).toContain('| 提单人反馈结论 | 采纳交互优化，方案配置化暂缓 |');
  });

  it('bug 已确认缺陷→开发中:缺陷复现与根因', () => {
    const md = renderNodeComment({ type: 'bug', from: '已确认缺陷', to: '开发中', fields: { 复现步骤: 's', 根因: 'r' }, assigneeUser: '@dev' });
    expect(md).toContain('## 缺陷复现与根因');
    expect(md).toContain('| 根因 | r |');
  });

});

describe('团队交接评论（内部证据隔离）', () => {
  it('renders a submission handoff with projects and branches, not execution receipts', () => {
    const md = renderNodeComment({
      type: 'story', from: '开发中', to: '测试中',
      fields: {
        涉及项目与开发分支: 'oa-platform:feature/leave-settlement；oa-frontend:feature/leave-page',
        本次改动: '完成离职补偿计算', 测试范围: '审批、权限与结算', 环境准备与配置: '完成初始化配置',
        测试重点: '边界与权限', 已知限制: '无阻塞限制', Apifox资产审计记录: 'internal-only',
      }, assigneeUser: '@qa',
    });
    expect(md).toContain('## 提测说明');
    expect(md).toContain('| 涉及项目与开发分支 | oa-platform:feature/leave-settlement；oa-frontend:feature/leave-page |');
    expect(md).toContain('## 下一步');
    expect(md).not.toContain('Apifox');
    expect(md).not.toContain('internal-only');
  });

  it('renders a readable test report and release plan without environment accounts or report IDs', () => {
    const md = renderNodeComment({
      type: 'story', from: '测试中', to: '待发布',
      fields: {
        涉及项目与开发分支: 'oa-platform:feature/leave-settlement；oa-frontend:feature/leave-page',
        回归范围或证据: 'TP-001 离职审批 API+E2E；TestRun v3/test passed',
        测试环境数据清单: 'TP-001：test：离职审批单 LZ-20260909-001，员工 E10086，来源 fixtures/离职审批.sql，preserve',
        业务覆盖范围: '离职审批、结算与权限', 缺陷处理结果: '阻塞问题已关闭', 遗留风险: '无阻塞遗留风险',
        上线步骤: '按发布计划执行', 配置清单: '完成后台配置', 回滚方案: '回滚版本与配置', 发布建议: '建议发布',
        测试账号: 'internal-user', reportId与环境: 'report:123',
      }, assigneeUser: '@dev',
    });
    expect(md).toContain('## 测试报告与上线方案');
    expect(md).toContain('| 涉及项目与开发分支 | oa-platform:feature/leave-settlement；oa-frontend:feature/leave-page |');
    expect(md).toContain('| 回归范围或证据 | TP-001 离职审批 API+E2E；TestRun v3/test passed |');
    expect(md).toContain('| 测试环境数据清单 | TP-001：test：离职审批单 LZ-20260909-001，员工 E10086，来源 fixtures/离职审批.sql，preserve |');
    expect(md).toContain('| 业务覆盖范围 | 离职审批、结算与权限 |');
    expect(md).not.toContain('测试账号');
    expect(md).not.toContain('report:123');
  });

  it('renders multiline structured fields as readable subsections instead of crowded table cells', () => {
    const regression = [
      '| 用例 | 场景 | 结论 |',
      '|---|---|---|',
      '| TC-001 | 离职交接候选范围 | passed |',
      '| TC-002 | 跨租户真实下属差集展示 | passed |',
    ].join('\n');
    const data = [
      '| 用例/场景 | 数据 | 关键业务键 | 来源 | 保留策略 |',
      '|---|---|---|---|---|',
      '| TC-001 | 离职审批单 | LZ-20260909-001 | seed/leave.sql | 保留至验收完成 |',
    ].join('\n');
    const md = renderNodeComment({
      type: 'story', from: '测试中', to: '待发布',
      fields: {
        测试完成日期: '2026-08-29',
        回归范围或证据: regression,
        测试环境数据清单: data,
      },
      assigneeUser: '@dev',
    });
    expect(md).toContain('### 回归范围或证据');
    expect(md).toContain('| 用例 | 场景 | 结论 |');
    expect(md).toContain('### 测试环境数据清单');
    expect(md).toContain('| 用例/场景 | 数据 | 关键业务键 | 来源 | 保留策略 |');
    expect(md).not.toContain('| 回归范围或证据 |');
  });

  it('renders complete production handoff and acceptance report sections', () => {
    const release = renderNodeComment({
      type: 'story', from: '待发布', to: '生产验收中', assigneeUser: '@pm',
      fields: {
        发布日期: '2026-08-28', 研发Assignee: '@dev',
        部署顺序: '先服务后前端', 数据迁移: '无', 配置清单: '生产开关已核对',
        上线后验证: '主流程与监控告警验证', 回滚方案: '回滚应用版本与配置',
      },
    });
    expect(release).toContain('## 上线操作手册');
    expect(release).toContain('| 部署顺序 | 先服务后前端 |');
    expect(release).toContain('| 上线后验证 | 主流程与监控告警验证 |');

    const acceptance = renderNodeComment({
      type: 'story', from: '生产验收中', to: '已完成', assigneeUser: '@pm',
      fields: {
        验收完成日期: '2026-08-29', 具体产品验收人: '@pm', 产品Assignee: '@pm',
        验收范围: '主流程、权限与通知', 验收结论: '通过', 验收依据: '生产验证通过',
        遗留事项: '无', 后续行动: '持续观察监控',
      },
    });
    expect(acceptance).toContain('## 验收报告');
    expect(acceptance).toContain('| 验收范围 | 主流程、权限与通知 |');
    expect(acceptance).toContain('| 后续行动 | 持续观察监控 |');
  });

  it('blocks machine-only content from a formal state comment', () => {
    const result = validatePublicComment({
      type: 'story', from: '开发中', to: '测试中',
      fields: { 测试说明: '使用 token=secret 运行验证' }, assigneeUser: '@qa',
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join('\n')).toContain('内部执行证据');
  });

  it('blocks credentials in the free-form next-step field', () => {
    const result = validatePublicComment({
      type: 'story', from: '开发中', to: '测试中',
      fields: { 下一步: '使用 token=secret-value 完成验证' }, assigneeUser: '@qa',
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    '使用密码=supersecret 完成验证',
    'https://user:secret@example.test/health',
    '凭据：https://example.test/check?access_key=secret-value',
    'eyJhbGciOiJIUzI1NiJ9.payload-value-with-padding.signature-value-long',
  ])('blocks credential-like public text: %s', (nextStep) => {
    const result = validatePublicComment({
      type: 'story', from: '开发中', to: '测试中',
      fields: { 下一步: nextStep }, assigneeUser: '@qa',
    });
    expect(result.ok).toBe(false);
  });

  it('does not let a user-controlled digest heading hide later sensitive text', () => {
    const payload: Payload = {
      type: 'story', from: '草稿中', to: '待评审', assigneeUser: '@pm',
      fields: { 下一步: '等待评审\n\n## 证据摘要\n\ntoken=supersecret' },
    };
    expect(validatePublicComment(payload).ok).toBe(false);
  });

  it('keeps DU evidence out of public comments and validates the visible handoff only', () => {
    const payload: Payload = {
      type: 'story', from: '测试中', to: '待发布',
      fields: { 测试完成日期: '2026-08-29', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'TP-001；完整回归 TestRun v3/test passed', 测试环境数据清单: 'TP-001：test：合同单 HT-20260909-001，来源 fixture，preserve', 阻塞发布问题均已验证通过: '是', feature分支MR评审结论: '通过', 涉及项目与开发分支: 'oa-platform: feature/leave-settlement' },
      du: {
        iid: 22, type: 'story', cachedNode: '测试中', affectedScopes: ['functional'],
        evidence: [{ kind: 'test-run', environment: 'local', planVersion: 'v3', outcome: 'passed', recordedAt: '2026-08-29T10:00:00Z', detailRef: 'report:101' }],
        resources: [], metricEvents: [], updatedAt: '2026-08-29T10:00:00Z',
      },
      assigneeUser: '@dev',
    };
    const md = renderNodeComment(payload);
    expect(md).not.toContain('## 证据摘要');
    expect(md).not.toContain('glab-flow:field-index');
    expect(md).not.toContain('report:101');
    expect(validatePublicComment(payload).ok).toBe(true);

    const unsafeNextStep = { ...payload, fields: { ...payload.fields, 下一步: '使用 token=secret-value 完成验证' } };
    expect(validatePublicComment(unsafeNextStep).ok).toBe(false);
  });

  it('does not validate DU-only fields as public comment content', () => {
    const payload: Payload = {
      type: 'story', from: '测试中', to: '待发布', fields: {}, assigneeUser: '@dev',
      du: {
        iid: 22, type: 'story', cachedNode: '测试中', affectedScopes: ['functional'],
        evidence: [{ kind: 'test-run', environment: 'local', planVersion: 'token=supersecret', outcome: 'passed', recordedAt: '2026-08-29T10:00:00Z' }],
        resources: [], metricEvents: [], updatedAt: '2026-08-29T10:00:00Z',
      },
    };
    const result = validatePublicComment(payload);
    expect(result.ok).toBe(true);
  });

  it('accepts DU evidence when the rendered public comment itself is safe', () => {
    const payload: Payload = {
      type: 'story', from: '测试中', to: '待发布', fields: {}, assigneeUser: '@dev',
      du: {
        iid: 22, type: 'story', cachedNode: '测试中', affectedScopes: ['functional'],
        evidence: [{ kind: 'test-run', environment: 'local', planVersion: 'v3.1', outcome: 'passed', recordedAt: '2026-08-29T10:00:00Z' }],
        resources: [], metricEvents: [], updatedAt: '2026-08-29T10:00:00Z',
      },
    };
    expect(validatePublicComment(payload).ok).toBe(true);
  });

  it('ignores DU digest environments and GateSet scopes in public comment validation', () => {
    const payload: Payload = {
      type: 'story', from: '测试中', to: '待发布', fields: {}, assigneeUser: '@dev',
      du: {
        iid: 22, type: 'story', cachedNode: '测试中', affectedScopes: [],
        evidence: [{ kind: 'test-run', environment: '/tmp/secret', planVersion: 'v3', outcome: 'passed', recordedAt: '2026-08-29T10:00:00Z' }],
        resources: [], metricEvents: [], updatedAt: '2026-08-29T10:00:00Z',
        gateSet: {
          scopes: ['unknown'] as never[], skipStates: [], environments: ['local'],
          mrReview: true, regression: 'full', rollbackPlan: false, minUnitCases: 0, overrides: [],
        },
      },
    };
    expect(validatePublicComment(payload).ok).toBe(true);
  });

  it('renders every canonical required fact in the public handoff', () => {
    const md = renderNodeComment({
      type: 'story', from: '测试中', to: '待发布', assigneeUser: '@dev',
      fields: {
        测试完成日期: '2026-08-29', 测试Assignee: '@qa', 测试结论: '通过',
        回归范围或证据: 'TP-001；完整回归 TestRun v3/test passed',
        测试环境数据清单: 'TP-001：test：合同单 HT-20260909-001，来源 fixture，preserve',
        阻塞发布问题均已验证通过: '是',
        feature分支MR评审结论: '通过，无 HIGH 残留',
        涉及项目与开发分支: 'oa-platform: feature/leave-settlement',
      },
    });
    expect(md).toContain('| 测试完成日期 | 2026-08-29 |');
    expect(md).toContain('| 测试环境数据清单 | TP-001：test：合同单 HT-20260909-001，来源 fixture，preserve |');
    expect(md).toContain('| 阻塞发布问题均已验证通过 | 是 |');
    expect(md).toContain('| feature分支MR评审结论 | 通过，无 HIGH 残留 |');
    expect(md).toContain('| 涉及项目与开发分支 | oa-platform: feature/leave-settlement |');
  });
});

import type { Payload } from './types.js';
import { renderWeekPlan, validateWeekPlan } from './week-plan.js';
import { renderRequirementsReviewEvidence } from './review-evidence.js';

export function renderStatusChange(p: Payload): string {
  const f = p.fields;
  const lines = ['## 状态变更', '', `- 变更：\`${p.from}\` → \`${p.to}\``];
  const rendered = new Set<string>();

  const dateKey = Object.keys(f).find((k) => k.includes('日期'));
  if (dateKey) { lines.push(`- 实际日期：${f[dateKey]}`); rendered.add(dateKey); }

  const confirmerKeys = ['产品确认人', '测试Assignee', '研发Assignee', '具体产品验收人', '具体测试验证人', '测试验证人Assignee'];
  const confirmerKey = confirmerKeys.find((k) => f[k]);
  if (confirmerKey) { lines.push(`- 确认人：${f[confirmerKey]}`); rendered.add(confirmerKey); }

  const conclKeys = ['评审结论', '测试结论', '验收结论', '验证结论'];
  const conclKey = conclKeys.find((k) => f[k]);
  if (conclKey) { lines.push(`- 结论：${f[conclKey]}`); rendered.add(conclKey); }

  const evKeys = ['需求文档或评审记录', '回归范围或证据', '验收依据', '验证依据', '发布记录或回滚信息', '技术方案评审通过记录或免评审结论'];
  const evKey = evKeys.find((k) => f[k]);
  if (evKey) { lines.push(`- 依据：${f[evKey]}`); rendered.add(evKey); }

  for (const k of Object.keys(f)) {
    if (!rendered.has(k) && f[k]) lines.push(`- ${k}：${f[k]}`);
  }

  if (p.assigneeUser) lines.push(`- 目标节点 Assignee：${p.assigneeUser}`);
  return lines.join('\n');
}

export function renderReturn(target: string, issues: string[], confirmer: string, date: string): string {
  return ['## 状态变更（退回）', '',
    `- 退回：\`${target}\``, `- 实际日期：${date}`, `- 确认人：${confirmer}`,
    '', '### 问题清单（需修订）', ...issues.map((i, n) => `${n + 1}. ${i}`),
    '', '- 下一步：产品修订后重新进入待评审'].join('\n');
}

export function renderChangeRequest(f: Record<string, string>): string {
  const rows: [string, string | undefined][] = [
    ['提出人', f['提出人']], ['实际提出日期', f['实际提出日期']],
    ['变更原因', f['变更原因']], ['已评审内容', f['已评审内容']],
    ['变更后内容', f['变更后内容']], ['影响范围', f['影响范围']],
    ['排期影响', f['排期影响']], ['建议', f['建议']],
  ];
  return ['## 需求变更申请', '', ...rows.filter(([, v]) => v).map(([k, v]) => `- ${k}：${v}`)].join('\n');
}

export function renderTestIssue(f: Record<string, string>): string {
  const rows: [string, string | undefined][] = [
    ['发现人', f['发现人']], ['发现日期', f['发现日期']],
    ['实际结果', f['实际结果']], ['预期结果', f['预期结果']],
    ['复现步骤 / 证据', f['复现步骤 / 证据']], ['研发处理人', f['研发处理人']],
    ['是否阻塞发布', f['是否阻塞发布']], ['当前结论', f['当前结论']], ['验证结果', f['验证结果']],
  ];
  return ['## 测试问题', '', ...rows.filter(([, v]) => v).map(([k, v]) => `- ${k}：${v}`)].join('\n');
}

export function renderCorrection(f: Record<string, string>): string {
  const rows: [string, string | undefined][] = [
    ['对应节点', f['对应节点']], ['原记录链接', f['原记录链接']],
    ['更正内容', f['更正内容']], ['原因', f['原因']],
    ['提出人', f['提出人']], ['实际日期', f['实际日期']],
  ];
  return ['## 补充/更正', '', ...rows.filter(([, v]) => v).map(([k, v]) => `- ${k}：${v}`)].join('\n');
}

/**
 * 节点流转(type:from:to) → 内容体配置(标题 + 内容字段 key)。内容字段只渲染结构、Leader 填、
 * 不进 requiredFields(不卡流转)——门禁只卡确定事实(日期/确认人/结论/依据/Assignee)。
 */
const NODE_CONTENT: Record<string, { title: string; keys: string[] }> = {
  'story:草稿中:待评审': { title: '需求提案要点', keys: ['背景', '目标', '范围内', '范围外', '核心业务规则', '验收要点'] },
  'story:待评审:已评审': { title: '评审意见', keys: ['评审要点', '问题清单', '修订要求'] },
  'story:已评审:开发中': { title: '技术方案', keys: ['方案概述', '数据模型变更', 'API契约', '影响模块', '风险与对策', '回滚方案'] },
  'story:开发中:测试中': { title: '提测说明', keys: ['测试计划版本', 'Apifox资产审计记录', 'local测试执行记录', '测试范围', '改动点', '上线步骤A类', '上线步骤B类', '注意事项'] },
  'story:测试中:待发布': { title: '测试报告', keys: ['测试计划版本', 'Apifox资产审计记录', 'test测试执行记录', '测试环境', '测试账号', 'reportId与环境', '请求与断言统计', 'Apifox资产状态', '回归详情', '阻塞问题及验证', 'featureMR评审详情', '发布建议'] },
  'story:待发布:生产验收中': { title: '上线操作手册', keys: ['生产版本', '部署顺序', 'migration', '配置A类', '配置B类', '上线后验证', '回滚方案'] },
  'story:生产验收中:已完成': { title: '验收报告', keys: ['验收意见', '生产验证详情'] },
  'bug:已确认缺陷:开发中': { title: '缺陷复现与根因', keys: ['复现步骤', '根因', '影响范围', '修复方案'] },
  'bug:开发中:测试中': { title: '提测说明', keys: ['测试计划版本', 'Apifox资产审计记录', 'local测试执行记录', '测试范围', '改动点', '上线步骤A类', '上线步骤B类', '注意事项'] },
  'bug:测试中:待发布': { title: '测试报告', keys: ['测试计划版本', 'Apifox资产审计记录', 'test测试执行记录', '测试环境', '测试账号', 'reportId与环境', '请求与断言统计', 'Apifox资产状态', '回归详情', '阻塞问题及验证', 'featureMR评审详情', '发布建议'] },
  'bug:待发布:生产验证中': { title: '上线操作手册', keys: ['生产版本', '部署顺序', 'migration', '配置A类', '配置B类', '上线后验证', '回滚方案'] },
  'bug:生产验证中:已完成': { title: '验证报告', keys: ['验证意见', '生产验证详情'] },
};

/**
 * 合并评论 = 状态变更头(变更/实际日期/确认人/结论/依据/目标节点 Assignee) + 内容体(按节点类型) + 剩余字段兜底。
 * 状态头槽位与 `renderStatusChange` 一致;内容体字段只渲染、不卡流转;rendered 集合去重,头/体/兜底不重复。
 * 退回(G2 二值)不走本函数,仍用 `renderReturn`。
 */
export function renderNodeComment(p: Payload): string {
  const f = p.fields;
  const rendered = new Set<string>();
  const blocks: string[] = [];

  const head: string[] = ['## 状态变更', '', `- 变更：\`${p.from}\` → \`${p.to}\``];
  const dateKey = Object.keys(f).find((k) => /日期/.test(k));
  if (dateKey && f[dateKey]) { head.push(`- 实际日期：${f[dateKey]}`); rendered.add(dateKey); }
  const confirmerKeys = ['产品确认人', '测试Assignee', '研发Assignee', '具体产品验收人', '具体测试验证人', '测试验证人Assignee'];
  const confirmerKey = confirmerKeys.find((k) => f[k]);
  if (confirmerKey) { head.push(`- 确认人：${f[confirmerKey]}`); rendered.add(confirmerKey); }
  const conclKeys = ['评审结论', '测试结论', '验收结论', '验证结论'];
  const conclKey = conclKeys.find((k) => f[k]);
  if (conclKey) { head.push(`- 结论：${f[conclKey]}`); rendered.add(conclKey); }
  const evKeys = ['需求文档或评审记录', '回归范围或证据', '验收依据', '验证依据', '发布记录或回滚信息', '技术方案评审通过记录或免评审结论'];
  const evKey = evKeys.find((k) => f[k]);
  if (evKey) { head.push(`- 依据：${f[evKey]}`); rendered.add(evKey); }
  if (p.assigneeUser) head.push(`- 目标节点 Assignee：${p.assigneeUser}`);
  blocks.push(head.join('\n'));

  const content = NODE_CONTENT[`${p.type}:${p.from}:${p.to}`];
  if (content) {
    const rows = content.keys.filter((k) => f[k]).map((k) => `- ${k}：${f[k]}`);
    for (const k of content.keys) if (f[k]) rendered.add(k);
    if (rows.length) blocks.push(`## ${content.title}\n\n${rows.join('\n')}`);
  }

  // These historical free-text claims cannot stand in for a validated TestRun.
  // Keep them out of new handoff comments even when old callers still supply them.
  if (p.from === '开发中' && p.to === '测试中') {
    for (const key of ['自测计划', '接口自测结论', '接口自测覆盖', 'E2E结论']) rendered.add(key);
  }

  const tail: string[] = [];
  for (const k of Object.keys(f)) {
    if (!rendered.has(k) && f[k]) tail.push(`- ${k}：${f[k]}`);
  }
  if (tail.length) blocks.push(tail.join('\n'));

  // Only the Story review approval records a newly supplied schedule.  The
  // Validate at the rendering boundary so malformed runtime input can never
  // emit a partial Harness heading.
  if (p.type === 'story' && p.from === '待评审' && p.to === '已评审' && p.weekPlan) {
    const validation = validateWeekPlan(p.weekPlan);
    if (validation.ok) blocks.push(renderWeekPlan(validation.plan)!);
  }

  if (p.type === 'story' && p.from === '待评审' && p.to === '已评审' && p.reviewEvidence) {
    blocks.push(renderRequirementsReviewEvidence(p.reviewEvidence));
  }

  return blocks.join('\n\n');
}

import type { GuardResult, Payload } from './types.js';
import { renderWeekPlan, validateWeekPlan } from './week-plan.js';
import { renderRequirementsReviewEvidence } from './review-evidence.js';
import { latestEvidence } from './du.js';

/** 证据摘要里展示的环境顺序：local → test → 其余按出现序（稳定输出，团队可比对）。 */
const DIGEST_ENV_ORDER = ['local', 'test'];

/**
 * 从 DU 本地事实渲染团队可见的证据摘要块；明细留在本地 DU/云端报告，结论同步到 Issue。
 * 存量调用没有 DU 时不追加摘要，保持兼容。
 */
function renderEvidenceDigest(p: Payload): string | undefined {
  const du = p.du;
  if (!du) return undefined;

  const lines: string[] = [];
  const environments = [...DIGEST_ENV_ORDER, ...new Set(du.evidence.map((e) => e.environment).filter((e) => !DIGEST_ENV_ORDER.includes(e)))];
  for (const env of environments) {
    const run = latestEvidence(du, 'test-run', env);
    const audit = latestEvidence(du, 'asset-audit', env);
    if (!run && !audit) continue;
    const parts: string[] = [];
    if (run) parts.push(`执行 ${run.planVersion} / ${run.outcome}${run.detailRef ? ` / ${run.detailRef}` : ''}`);
    if (audit) parts.push(`审计 ${audit.planVersion} / ${audit.outcome}`);
    lines.push(`- ${env}：${parts.join('；')}`);
  }

  const undisposed = du.resources.filter((r) => !r.disposedAt);
  if (undisposed.length) lines.push(`- 资源登记：${undisposed.length} 项在册（终态出清理清单）`);
  if (du.gateSet) lines.push(`- 门禁单：${du.gateSet.scopes.join('、')}（${du.gateSet.environments.join('/')}，MR 评审${du.gateSet.mrReview ? '要求' : '豁免'}，回归=${du.gateSet.regression}）`);
  if (du.metricEvents.length) {
    const count = (kind: string): number => du.metricEvents.filter((e) => e.kind === kind).length;
    lines.push(`- 指标：确认 ${count('confirm')} 次 / 流转 ${count('transition')} 次 / 重测 ${count('rerun')} 次 / 返工 ${count('rework')} 次`);
  }

  if (!lines.length) return undefined;
  return ['## 证据摘要（引擎从 DU 生成；明细见云端报告与本地工作目录）', '', ...lines].join('\n');
}

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
/**
 * The only fields allowed into the reader-facing Issue timeline. Gate evidence
 * remains in the run-state ledger and is intentionally absent here.
 */
const NODE_CONTENT: Record<string, { title: string; keys: string[] }> = {
  'story:草稿中:待评审': { title: '需求提案要点', keys: ['背景', '目标', '范围内', '范围外', '核心业务规则', '验收要点'] },
  'story:待评审:已评审': { title: '评审意见', keys: ['评审要点', '问题清单', '修订要求'] },
  'story:已评审:开发中': { title: '技术方案', keys: ['技术方案版本', '方案概述', '影响模块', '数据模型变更', 'API契约', '前端页面与路由', '权限与安全', '迁移与配置', '测试计划摘要', '计划提测时间', '计划上线时间', '风险与对策', '回滚方案'] },
  'story:开发中:测试中': { title: '提测说明', keys: ['涉及项目与提测分支', '可测试版本', '本次改动', '测试范围', '环境准备与配置', '测试重点', '已知限制'] },
  'story:测试中:待发布': { title: '测试报告与上线方案', keys: ['业务覆盖范围', '缺陷处理结果', '遗留风险', '上线步骤', '配置清单', '回滚方案', '发布建议'] },
  'story:待发布:生产验收中': { title: '上线操作手册', keys: ['生产版本', '部署顺序', '数据迁移', '配置清单', '上线后验证', '回滚方案'] },
  'story:生产验收中:已完成': { title: '验收报告', keys: ['验收范围', '验收结论', '验收依据', '遗留事项', '后续行动'] },
  'bug:已确认缺陷:开发中': { title: '缺陷复现与根因', keys: ['复现步骤', '根因', '影响范围', '修复方案'] },
  'bug:开发中:测试中': { title: '提测说明', keys: ['涉及项目与提测分支', '可测试版本', '本次改动', '测试范围', '环境准备与配置', '测试重点', '已知限制'] },
  'bug:测试中:待发布': { title: '测试报告与上线方案', keys: ['业务覆盖范围', '缺陷处理结果', '遗留风险', '上线步骤', '配置清单', '回滚方案', '发布建议'] },
  'bug:待发布:生产验证中': { title: '上线操作手册', keys: ['生产版本', '部署顺序', '数据迁移', '配置清单', '上线后验证', '回滚方案'] },
  'bug:生产验证中:已完成': { title: '验证报告', keys: ['验证范围', '验证结论', '验证依据', '遗留事项', '后续行动'] },
};

/**
 * 合并评论 = 状态变更头 + 当前阶段的正式交付物 + 下一步。
 * 绝不追加未声明字段：本地环境、测试平台、报告链接及机器 marker
 * 属于内部证据账本，不得出现在团队阅读的 Issue 时间线上。
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

  const digest = renderEvidenceDigest(p);
  if (digest) blocks.push(digest);

  const next = f['下一步']?.trim() || `由 ${p.assigneeUser ?? '目标节点负责人'} 按「${p.to}」节点继续推进。`;
  blocks.push(`## 下一步\n\n- ${next}`);
  return blocks.join('\n\n');
}

const INTERNAL_COMMENT_CONTENT = [
  /apifox/i,
  /(?:^|[^a-z])local(?:$|[^a-z])/i,
  /本地(?:环境|路径|测试|执行|资产)/,
  /report\s*id/i,
  /<!--\s*glab-flow:/i,
  /(?:^|\s)\/(?:Users|private|tmp|home)\//,
  /\b[a-f0-9]{7,40}\b/i,
];

/** Reject machine-only material before a state comment can be written. */
export function validatePublicComment(p: Payload): GuardResult {
  const rendered = renderNodeComment(p);
  // The generated evidence digest is the approved public summary; validate handoff fields separately.
  const handoff = rendered.replace(/\n\n## 证据摘要[\s\S]*$/, '');
  const forbidden = INTERNAL_COMMENT_CONTENT.find((pattern) => pattern.test(handoff));
  if (!forbidden) return { ok: true, missing: [], reasons: [] };
  return {
    ok: false,
    missing: [],
    reasons: ['正式状态评论包含内部执行证据（测试平台、本地环境、报告 ID、路径、提交哈希或机器 marker）；请写入内部证据账本，并改为团队可读的交接说明'],
  };
}

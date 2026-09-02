import type { ChangeScope, GateSet, GuardResult, Payload } from './types.js';
import { renderWeekPlan, validateWeekPlan } from './week-plan.js';
import { renderRequirementsReviewEvidence } from './review-evidence.js';
import { latestEvidence } from './du.js';

/** 证据摘要里展示的环境顺序：local → test → 其余按出现序（稳定输出，团队可比对）。 */
const DIGEST_ENV_ORDER = ['local', 'test'];

/** Public digest accepts only identifiers and outcomes, never report/path/token material. */
const PUBLIC_ENVIRONMENTS = new Set(['local', 'test']);
const PUBLIC_SCOPES = new Set<ChangeScope>([
  'frontend-copy', 'functional', 'frontend-route', 'api-contract',
  'data-model', 'permission', 'schedule', 'release',
]);
const SAFE_PLAN_VERSION = /^v[0-9]+(?:\.[0-9]+)*$/i;
const SAFE_OUTCOME = /^(?:passed|failed|0|[1-9][0-9]*)$/;

function validDigestVersion(value: unknown): boolean {
  return typeof value === 'string' && SAFE_PLAN_VERSION.test(value.trim());
}

function validDigestOutcome(value: unknown): boolean {
  return typeof value === 'string' && SAFE_OUTCOME.test(value.trim());
}

function validateEvidenceDigest(p: Payload): GuardResult {
  const du = p.du;
  if (!du) return { ok: true, missing: [], reasons: [] };
  const reasons: string[] = [];
  const checkEvidence = (environment: string, planVersion: string, outcome: string): void => {
    if (!PUBLIC_ENVIRONMENTS.has(environment)) reasons.push(`证据摘要环境非法：${environment}`);
    if (!validDigestVersion(planVersion)) reasons.push('证据摘要计划版本必须是 vN 或 vN.N 格式');
    if (!validDigestOutcome(outcome)) reasons.push('证据摘要结论必须是 passed、failed 或非负整数');
  };
  for (const environment of new Set(du.evidence.map((entry) => entry.environment))) {
    const run = latestEvidence(du, 'test-run', environment);
    const audit = latestEvidence(du, 'asset-audit', environment);
    if (run) checkEvidence(environment, run.planVersion, run.outcome);
    if (audit) checkEvidence(environment, audit.planVersion, audit.outcome);
  }
  const gateSet = du.gateSet;
  if (gateSet) {
    if (gateSet.scopes.some((scope) => !PUBLIC_SCOPES.has(scope))) reasons.push('门禁摘要包含未支持的变更维度');
    if (gateSet.environments.some((environment) => !PUBLIC_ENVIRONMENTS.has(environment))) reasons.push('门禁摘要包含未支持的环境');
    if (!['affected-cases', 'full'].includes(gateSet.regression)) reasons.push('门禁摘要回归档位非法');
  }
  return reasons.length ? { ok: false, missing: ['publicEvidenceDigest'], reasons } : { ok: true, missing: [], reasons: [] };
}

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
    if (run) parts.push(`执行 ${run.planVersion} / ${run.outcome}`);
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
  'story:开发中:测试中': { title: '提测说明', keys: ['代码评审结论', '提测日期', '研发Assignee', '可测试版本或环境', '可测试版本', '测试说明', '涉及项目与提测分支', '本次改动', '测试范围', '环境准备与配置', '测试重点', '已知限制'] },
  'story:开发中:待发布': { title: '提测说明', keys: ['代码评审结论', '提测日期', '研发Assignee', '可测试版本或环境', '可测试版本', '测试说明', '涉及项目与提测分支', '本次改动', '测试范围', '环境准备与配置', '测试重点', '已知限制'] },
  'story:测试中:待发布': { title: '测试报告与上线方案', keys: ['测试完成日期', '测试Assignee', '测试结论', '回归范围或证据', '阻塞发布问题均已验证通过', 'feature分支MR评审结论', '业务覆盖范围', '缺陷处理结果', '遗留风险', '上线步骤', '配置清单', '回滚方案', '发布建议'] },
  'story:待发布:生产验收中': { title: '上线操作手册', keys: ['发布日期', '研发Assignee', '生产版本', '发布记录或回滚信息', '部署顺序', '数据迁移', '配置清单', '上线后验证', '回滚方案'] },
  'story:生产验收中:已完成': { title: '验收报告', keys: ['验收完成日期', '具体产品验收人', '产品Assignee', '验收范围', '验收结论', '验收依据', '遗留事项', '后续行动'] },
  'bug:已确认缺陷:开发中': { title: '缺陷复现与根因', keys: ['复现步骤', '根因', '影响范围', '修复方案'] },
  'bug:开发中:测试中': { title: '提测说明', keys: ['代码评审结论', '提测日期', '研发Assignee', '可测试版本或环境', '可测试版本', '测试说明', '涉及项目与提测分支', '本次改动', '测试范围', '环境准备与配置', '测试重点', '已知限制'] },
  'bug:开发中:待发布': { title: '提测说明', keys: ['代码评审结论', '提测日期', '研发Assignee', '可测试版本或环境', '可测试版本', '测试说明', '涉及项目与提测分支', '本次改动', '测试范围', '环境准备与配置', '测试重点', '已知限制'] },
  'bug:测试中:待发布': { title: '测试报告与上线方案', keys: ['测试完成日期', '测试Assignee', '测试结论', '回归范围或证据', '阻塞发布问题均已验证通过', 'feature分支MR评审结论', '业务覆盖范围', '缺陷处理结果', '遗留风险', '上线步骤', '配置清单', '回滚方案', '发布建议'] },
  'bug:待发布:生产验证中': { title: '上线操作手册', keys: ['发布日期', '研发Assignee', '生产版本', '发布记录或回滚信息', '部署顺序', '数据迁移', '配置清单', '上线后验证', '回滚方案'] },
  'bug:生产验证中:已完成': { title: '验证报告', keys: ['验证完成日期', '具体测试验证人', '测试验证人Assignee', '验证范围', '验证结论', '验证依据', '遗留事项', '后续行动'] },
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

  const contentEntries = [
    NODE_CONTENT[`${p.type}:${p.from}:${p.to}`],
    ...(p.renderTransitions ?? []).map((transition) => NODE_CONTENT[`${p.type}:${transition.from}:${transition.to}`]),
  ].filter((entry): entry is { title: string; keys: string[] } => !!entry);
  const contentKeys = [...new Set(contentEntries.flatMap((entry) => entry.keys))];
  const rows = contentKeys.filter((k) => f[k]).map((k) => `- ${k}：${f[k]}`);
  for (const k of contentKeys) if (f[k]) rendered.add(k);
  if (rows.length) {
    const titles = [...new Set(contentEntries.map((entry) => entry.title))];
    blocks.push(`## ${titles.join(' / ')}\n\n${rows.join('\n')}`);
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

  const next = f['下一步']?.trim() || `由 ${p.assigneeUser ?? '目标节点负责人'} 按「${p.to}」节点继续推进。`;
  blocks.push(`## 下一步\n\n- ${next}`);

  // Keep the approved DU summary last so public validation can remove only this
  // generated block while still checking every reader-facing handoff field.
  const digest = renderEvidenceDigest(p);
  if (digest) blocks.push(digest);
  return blocks.join('\n\n');
}

const INTERNAL_COMMENT_CONTENT = [
  /apifox/i,
  /(?:^|[^a-z])local(?:$|[^a-z])/i,
  /本地(?:环境|路径|测试|执行|资产)/,
  /report\s*id/i,
  /\b(?:password|passwd|token|secret|authorization|bearer|api[-_ ]?key|environment\s+variable|env\s+var)\b/i,
  /(?:密码|口令|令牌|密钥|凭据)/,
  /(?:https?|ssh):\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:password|passwd|token|secret|api[_-]?key|access[_-]?key|credential|密码|口令|令牌|密钥|凭据)=/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /<!--\s*glab-flow:/i,
  /\/(?:Users|private|tmp|home)\//,
];
const SUSPICIOUS_HASH = /\b[a-f0-9]{7,40}\b/i;
const SUSPICIOUS_JWT = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;

/** Validate one user-controlled value before embedding it in a public comment. */
export function validatePublicField(value: unknown): GuardResult {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    return { ok: false, missing: [], reasons: ['公共评论字段为空、过长或包含控制字符'] };
  }
  const forbidden = INTERNAL_COMMENT_CONTENT.find((pattern) => pattern.test(value));
  const hash = value.match(SUSPICIOUS_HASH)?.[0];
  const jwt = SUSPICIOUS_JWT.test(value);
  if (!forbidden && !jwt && !(hash && /[a-f]/i.test(hash))) return { ok: true, missing: [], reasons: [] };
  return {
    ok: false,
    missing: [],
    reasons: ['公共评论字段包含内部执行证据（测试平台、本地环境、凭证、报告 ID、路径、提交哈希或机器 marker）'],
  };
}

/** Reject machine-only material before a public Issue comment can be written. */
export function validatePublicText(rendered: string): GuardResult {
  const field = validatePublicField(rendered);
  if (field.ok) return field;
  return {
    ok: false,
    missing: [],
    reasons: ['正式状态评论包含内部执行证据（测试平台、本地环境、凭证、报告 ID、路径、提交哈希或机器 marker）；请写入内部证据账本，并改为团队可读的交接说明'],
  };
}

export function validatePublicComment(p: Payload): GuardResult {
  const rendered = renderNodeComment(p);
  // Strip only the exact digest generated from the DU, never a user-controlled heading.
  const digest = renderEvidenceDigest(p);
  const digestSuffix = digest ? `\n\n${digest}` : '';
  const handoff = digestSuffix && rendered.endsWith(digestSuffix)
    ? rendered.slice(0, -digestSuffix.length)
    : rendered;
  const handoffValidation = validatePublicText(handoff);
  const digestValidation = validateEvidenceDigest(p);
  if (handoffValidation.ok && digestValidation.ok) return { ok: true, missing: [], reasons: [] };
  return {
    ok: false,
    missing: [...handoffValidation.missing, ...digestValidation.missing],
    reasons: [...handoffValidation.reasons, ...digestValidation.reasons],
  };
}

import type { GuardResult, RequirementsReviewEvidence } from './types.js';

const REQUIRED_GRILLING_COVERAGE = ['目标与范围', '角色与权限', '业务规则与边界', '数据与兼容', '验收与多环境验证'];
const FRONTEND_SIGNAL = /前端|页面|菜单|路由|\burl\b|网址/i;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(([^\s)]+)(?:\s+['"][^)]*['"])?\)/g;
const HTML_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const IMPROVEMENT_AREAS = new Set(['solution', 'interaction', 'scope', 'risk', 'other']);
const IMPROVEMENT_DECISIONS = new Set(['accepted', 'rejected', 'deferred']);

/** Extract every distinct Issue image source; the Leader downloads these originals before OCR. */
export function extractIssueImageSources(body: string, notes: { body: string }[]): string[] {
  const sources = new Set<string>();
  for (const text of [body, ...notes.map((note) => note.body)]) {
    for (const match of text.matchAll(MARKDOWN_IMAGE)) if (match[1]) sources.add(match[1]);
    for (const match of text.matchAll(HTML_IMAGE)) if (match[1]) sources.add(match[1]);
  }
  return [...sources];
}

function fail(reasons: string[], missing: string[] = []): GuardResult {
  return { ok: false, reasons, missing };
}

/**
 * Validates evidence only; image download/OCR and code exploration remain
 * Leader-owned operations. Any missing or unreadable input stops approval.
 */
export function validateRequirementsReviewEvidence(
  body: string,
  notes: { body: string }[],
  evidence: RequirementsReviewEvidence | undefined,
): GuardResult {
  if (!evidence) return fail(['需求评审取证缺失：必须完成图片 OCR、前端路由核查和 grilling 决策账本'], ['reviewEvidence']);

  const reasons: string[] = [];
  const missing: string[] = [];
  const sources = extractIssueImageSources(body, notes);
  const bySource = new Map(evidence.images.map((image) => [image.source, image]));
  for (const source of sources) {
    const image = bySource.get(source);
    if (!image) {
      reasons.push(`Issue 图片未取证：${source}`);
      missing.push('reviewEvidence.images');
      continue;
    }
    if (!image.visualSummary.trim()) {
      reasons.push(`Issue 图片缺少视觉语义摘要：${source}`);
      missing.push('reviewEvidence.images');
    }
    if (image.ocrStatus === 'unreadable') {
      reasons.push(`Issue 图片 OCR 不可确认：${source}；必须在评审问题清单中请产品补充，不能跳过`);
      missing.push('reviewEvidence.images');
    }
    if (image.ocrStatus === 'verified' && !image.ocrText?.trim()) {
      reasons.push(`Issue 图片 OCR 标记为已识别但缺少文本：${source}`);
      missing.push('reviewEvidence.images');
    }
  }

  const frontendRequired = FRONTEND_SIGNAL.test([body, ...notes.map((note) => note.body)].join('\n'));
  if (frontendRequired && !evidence.frontend.applicable) {
    reasons.push('需求含前端页面/菜单/路由信号，但未提供页面地址代码核查；不得猜测页面地址');
    missing.push('reviewEvidence.frontend');
  }
  if (evidence.frontend.applicable) {
    if (!evidence.frontend.routes.length) {
      reasons.push('前端需求未找到已核实的页面地址；应在同一批评审问题中向产品确认，而不是猜测');
      missing.push('reviewEvidence.frontend.routes');
    }
    for (const route of evidence.frontend.routes) {
      if (!route.requestedLocation.trim() || !route.resolvedPath.trim() || !route.routeFile.trim() || !route.componentFiles.length || !route.branches.length) {
        reasons.push('前端路由取证不完整：每个页面必须记录用户位置、resolved path、路由文件、组件文件和分流条件');
        missing.push('reviewEvidence.frontend.routes');
        break;
      }
    }
  }

  const coverage = new Set(evidence.grilling.coverage);
  const absentCoverage = REQUIRED_GRILLING_COVERAGE.filter((item) => !coverage.has(item));
  if (absentCoverage.length) {
    reasons.push(`grilling 覆盖不足：缺少 ${absentCoverage.join('、')}`);
    missing.push('reviewEvidence.grilling.coverage');
  }
  if (evidence.grilling.unresolved.some((item) => item.trim())) {
    reasons.push(`仍有未决需求问题：${evidence.grilling.unresolved.filter((item) => item.trim()).join('；')}；必须先提问或形成条件默认裁定`);
    missing.push('reviewEvidence.grilling.unresolved');
  }
  if (evidence.grilling.decisions.some((decision) => !decision.question.trim() || !decision.recommendation.trim())) {
    reasons.push('grilling 决策账本存在无问题或无推荐答案的条目');
    missing.push('reviewEvidence.grilling.decisions');
  }

  for (const improvement of evidence.improvements ?? []) {
    if (!IMPROVEMENT_AREAS.has(improvement.area)) {
      reasons.push(`需求评审改进建议类型无效：${improvement.area}`);
      missing.push('reviewEvidence.improvements');
    }
    if (!improvement.suggestion.trim() || !improvement.rationale.trim()) {
      reasons.push('需求评审改进建议必须包含建议内容和依据');
      missing.push('reviewEvidence.improvements');
    }
    if (!IMPROVEMENT_DECISIONS.has(improvement.requesterDecision)) {
      reasons.push(`需求评审改进建议缺少提单人反馈结论：${improvement.requesterDecision}`);
      missing.push('reviewEvidence.improvements');
    }
  }

  return reasons.length ? fail(reasons, [...new Set(missing)]) : { ok: true, reasons: [], missing: [] };
}

/** Compact receipt safe for the immutable review comment; detailed OCR stays in proposal/review record. */
export function renderRequirementsReviewEvidence(evidence: RequirementsReviewEvidence): string {
  const verified = evidence.images.filter((image) => image.ocrStatus === 'verified').length;
  const noText = evidence.images.filter((image) => image.ocrStatus === 'no-text').length;
  const improvements = evidence.improvements ?? [];
  const accepted = improvements.filter((item) => item.requesterDecision === 'accepted').length;
  const rejected = improvements.filter((item) => item.requesterDecision === 'rejected').length;
  const deferred = improvements.filter((item) => item.requesterDecision === 'deferred').length;
  const routes = evidence.frontend.applicable
    ? evidence.frontend.routes.map((route) => `${route.requestedLocation} → ${route.resolvedPath}`).join('；')
    : '不适用（已核查）';
  const lines = [
    '## 需求评审取证',
    '',
    `- Issue 图片：${evidence.images.length} 张（OCR 已识别 ${verified}，无文本 ${noText}）`,
    `- 前端页面核查：${routes}`,
    `- Grilling 覆盖：${evidence.grilling.coverage.join('、')}`,
    `- 决策账本：${evidence.grilling.decisions.length} 条（未决 0）`,
  ];
  if (improvements.length) {
    lines.push(`- 改进建议：${improvements.length} 条（采纳 ${accepted} / 不采纳 ${rejected} / 暂缓 ${deferred}）`);
  }
  return lines.join('\n');
}

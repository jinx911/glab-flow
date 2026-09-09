import { describe, expect, it } from 'vitest';
import { extractIssueImageSources, renderRequirementsReviewEvidence, validateRequirementsReviewEvidence } from './review-evidence.js';
import type { RequirementsReviewEvidence } from './types.js';

const BASE: RequirementsReviewEvidence = {
  images: [],
  frontend: { applicable: false, routes: [] },
  grilling: { coverage: ['目标与范围', '角色与权限', '业务规则与边界', '数据与兼容', '验收与多环境验证'], decisions: [], unresolved: [] },
};

describe('requirements review evidence', () => {
  it('extracts markdown and HTML Issue images from the body and comments', () => {
    expect(extractIssueImageSources('![原型](/uploads/a.png)', [{ body: '<img src="https://git.example/b.png">' }]))
      .toEqual(['/uploads/a.png', 'https://git.example/b.png']);
  });

  it('blocks an Issue image that was skipped or OCR is unreadable', () => {
    const result = validateRequirementsReviewEvidence('![原型](/uploads/a.png)', [], BASE);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('Issue 图片未取证：/uploads/a.png');

    const unreadable = validateRequirementsReviewEvidence('![原型](/uploads/a.png)', [], {
      ...BASE,
      images: [{ source: '/uploads/a.png', ocrStatus: 'unreadable', visualSummary: '审批按钮布局' }],
    });
    expect(unreadable.reasons.join('\n')).toContain('不能跳过');
  });

  it('blocks a page requirement until route and branching evidence is supplied', () => {
    const missing = validateRequirementsReviewEvidence('前端页面新增催办入口', [], BASE);
    expect(missing.ok).toBe(false);
    expect(missing.reasons.join('\n')).toContain('不得猜测页面地址');

    const verified = validateRequirementsReviewEvidence('前端页面新增催办入口', [], {
      ...BASE,
      frontend: {
        applicable: true,
        routes: [{ requestedLocation: '审批详情页', resolvedPath: '/workflow/detail/:id', routeFile: 'src/router.tsx', componentFiles: ['src/pages/workflow/detail.tsx'], branches: ['tenant 路由'] }],
      },
    });
    expect(verified.ok).toBe(true);
  });

  it('blocks review approval while grilling has an uncovered branch or unresolved question', () => {
    const result = validateRequirementsReviewEvidence('', [], {
      ...BASE,
      grilling: { coverage: ['目标与范围'], decisions: [], unresolved: ['催办频率未确认'] },
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join('\n')).toContain('grilling 覆盖不足');
    expect(result.reasons.join('\n')).toContain('催办频率未确认');
  });

  it('renders only a compact, non-secret approval receipt', () => {
    const receipt = renderRequirementsReviewEvidence({
      ...BASE,
      images: [{ source: '/uploads/a.png', ocrStatus: 'verified', ocrText: '提交审批', visualSummary: '审批详情中的提交按钮' }],
      improvements: [{ area: 'interaction', suggestion: '把批量确认合并成一步', rationale: '减少重复点击', requesterDecision: 'accepted' }],
    });
    expect(receipt).toContain('## 需求评审取证');
    expect(receipt).toContain('OCR 已识别 1');
    expect(receipt).toContain('改进建议：1 条（采纳 1 / 不采纳 0 / 暂缓 0）');
    expect(receipt).not.toContain('提交审批');
    expect(receipt).not.toContain('批量确认');
  });

  it('validates optional improvement suggestions as requester decisions, not silent scope expansion', () => {
    const ok = validateRequirementsReviewEvidence('', [], {
      ...BASE,
      improvements: [
        { area: 'solution', suggestion: '改为配置驱动', rationale: '减少后续手动发布配置', requesterDecision: 'deferred' },
      ],
    });
    expect(ok.ok).toBe(true);

    const invalid = validateRequirementsReviewEvidence('', [], {
      ...BASE,
      improvements: [
        { area: 'interaction', suggestion: '', rationale: '减少返工', requesterDecision: 'accepted' },
        { area: 'bad', suggestion: '自动扩范围', rationale: '方便', requesterDecision: 'unknown' },
      ],
    } as unknown as RequirementsReviewEvidence);
    expect(invalid.ok).toBe(false);
    expect(invalid.missing).toContain('reviewEvidence.improvements');
    expect(invalid.reasons.join('\n')).toContain('缺少提单人反馈结论');
  });
});

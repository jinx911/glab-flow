import type { StateMachine, IssueFacts, IssueNote, Payload, GuardResult, WritePlan, WriteOp, TestRun, TestPlan, LatestTestRun, TestMethod, DuState, Transition, GateSet } from './types.js';
import { transitionFor } from './model.js';
import { parseAssigneeTable } from './parse.js';
import { STATUS_PREFIX, ROLES } from './constants.js';
import { parseLatestTestRun, parseTestPlan, validateTestRun } from './test-run.js';
import { validateRequirementsReviewEvidence } from './review-evidence.js';
import { validateChangeImpactClosure } from './change-impact.js';
import { gateSetValidationErrors, isWaivedByGateSet } from './gate-set.js';
import { chronologicalNotes } from './notes.js';
import { latestEvidence } from './du.js';

const ok = (): GuardResult => ({ ok: true, missing: [], reasons: [] });
const fail = (reasons: string[], missing: string[] = []): GuardResult => ({ ok: false, missing, reasons });
const unique = (values: string[]): string[] => [...new Set(values)];


/**
 * DU 本地证据 → TestRun 形状（评论瘦身，P2）。
 * cases/evidence 按当前计划推导填充（DU 明细在本地 detailRef，评论格式的
 * 回读锚点以中性占位满足结构）。outcome 非 passed 一律不合成
 * 通过形状，直接以 invalid-latest 带根因拒绝——fail-closed，用户看到
 * 「须重跑」而不是合成形状缺 case 的逐项噪音。
 */
function duTestRunFor(du: DuState | undefined, plan: TestPlan, environment: string): LatestTestRun | undefined {
  const entry = du ? latestEvidence(du, 'test-run', environment) : undefined;
  if (!entry) return undefined;
  if (entry.outcome !== 'passed') {
    return { kind: 'invalid-latest', errors: [`DU 记录 outcome=${entry.outcome}，须重跑后再记录`] };
  }
  const required = plan.cases.filter((item) => item.environments.includes(environment));
  const cases: Record<string, 'passed'> = {};
  for (const item of required) cases[item.id] = 'passed';
  const evidence: Partial<Record<TestMethod, string>> = {};
  for (const method of new Set(required.flatMap((item) => item.methods))) {
    evidence[method] = `ok:${entry.detailRef ?? 'du'}`;
  }
  const run: TestRun = {
    environment: entry.environment,
    planVersion: entry.planVersion,
    outcome: 'passed',
    cases,
    evidence,
  };
  return { kind: 'valid' as const, run };
}

/** Applies one versioned test plan to the local and test acceptance gates. */
export function validateTestRunTransition(payload: Payload, notes: IssueNote[] = []): GuardResult {
  const environment = payload.from === '开发中' && payload.to === '测试中'
    ? 'local'
    : payload.from === '测试中' && payload.to === '待发布'
      ? 'test'
      : undefined;
  if (!environment) return ok();
  if (payload.du?.gateSet && !payload.du.gateSet.environments.includes(environment)) return ok();

  const parsedPlan = parseTestPlan(payload.testPlan);
  if (!parsedPlan.ok) return fail([`测试计划缺失或无效：${parsedPlan.errors.join('；')}`], ['testPlan']);
  // Q4：GateSet 按维度要求的最少 unit 用例数（纯逻辑防线：数据模型/权限类改动的计算逻辑须有单测）。
  // 无 GateSet 的存量路径不要求（兼容）；frontend-copy 等轻量维度为 0。
  const minUnits = payload.du?.gateSet?.minUnitCases ?? 0;
  if (minUnits > 0) {
    const unitCases = parsedPlan.plan.cases.filter((c) => c.methods.includes('unit')).length;
    if (unitCases < minUnits) {
      return fail([`测试计划 unit 用例不足：当前门禁单要求 ≥${minUnits} 条（改动了计算/状态/数据逻辑），实际 ${unitCases} 条——纯逻辑分支需单测兜底（test-plan 的 case 行 methods 加 unit）`], ['testPlan']);
    }
  }
  // DU 优先：本地有该环境事实就不看评论（存量 Issue 无 DU 仍走评论兜底）。
  const parsedLatest = duTestRunFor(payload.du, parsedPlan.plan, environment) ?? parseLatestTestRun(notes, environment);
  const validation = validateTestRun(parsedPlan.plan, environment, parsedLatest);
  return validation.ok ? ok() : fail(validation.errors, [`${environment}TestRun`]);
}

/**
 * 阻塞发布问题「均已验证通过」的肯定判定（G11）。
 * 接受：精确同义集合，或「是 + 附注分隔」（如「是(无阻塞)」「是。详细说明…」）。
 * 拒绝：否定词 / 空 / 占位，以及「是否」「是吗」这类以「是」开头但表疑问的串
 *       （旧版 startsWith('是') 会把它们误放行）。
 */
const AFFIRMATIVE = new Set(['是', 'true', 'yes', '已验证', '已通过', '无阻塞', '通过', '同意', '确认']);
// 「是」后紧跟附注分隔符才算肯定续写；不含「是否」「是吗」。
const AFFIRMATIVE_NOTE_PREFIX = ['是(', '是（', '是。', '是,', '是，', '是/', '是、', '是 '];

export function isAffirmative(v: string | undefined): boolean {
  if (!v) return false;
  const raw = v.trim();
  if (!raw) return false;
  if (AFFIRMATIVE.has(raw.toLowerCase())) return true;
  return AFFIRMATIVE_NOTE_PREFIX.some((p) => raw.startsWith(p));
}

/** 验证结果/结论类字段的肯定判定：接受「通过」「已验证」开头或含「复测绿/复测通过」（G11 字段的 isAffirmative 不认「通过（附注）」，这里语义不同）。 */
function isVerifiedOutcome(v: string | undefined): boolean {
  if (!v) return false;
  const raw = v.trim();
  if (!raw) return false;
  if (/^(通过|已验证|已通过|复测通过|复测绿|是|true|yes|无需|不适用)/.test(raw)) return true;
  return /复测(通过|绿)/.test(raw);
}

/**
 * G11b（Q2）：从测试问题评论（renderTestIssue 产出的 `## 测试问题` 块）抽未验证的阻塞项。
 * 语义：**每个问题**以它的最新评论为准（后发的更正覆盖旧状态）——最新的「是否阻塞发布」
 * 仍为肯定 且 「验证结果」非肯定 → 该问题未闭环。全部问题的最新状态都核实才返回空。
 * 注意：一条评论只承载一个测试问题（renderTestIssue 契约），问题以 实际结果/当前结论 摘要区分。
 */
export function unverifiedBlockingTestIssues(notes: IssueNote[] = []): string[] {
  const field = (block: string, key: string): string | undefined => {
    const m = block.match(new RegExp(`^- ${key}：(.+)$`, 'm'));
    return m ? m[1]!.trim() : undefined;
  };
  // 按时间正序遍历，问题摘要 → 最新状态；后发覆盖先发。
  const latestByIssue = new Map<string, { blocking?: string; verified?: string; at: string }>();
  for (const note of chronologicalNotes(notes)) {
    const idx = note.body.indexOf('## 测试问题');
    if (idx < 0) continue;
    const block = note.body.slice(idx);
    const summary = (field(block, '实际结果') ?? field(block, '当前结论') ?? '未注明').slice(0, 30);
    latestByIssue.set(summary, {
      blocking: field(block, '是否阻塞发布'),
      verified: field(block, '验证结果'),
      at: note.created_at ?? '',
    });
  }
  const unverified: string[] = [];
  for (const [summary, state] of latestByIssue) {
    if (!isAffirmative(state.blocking)) continue;
    if (isVerifiedOutcome(state.verified)) continue;
    unverified.push(`${state.at} ${summary}`.trim());
  }
  return unverified;
}

/**
 * G1/G14 联合口径：转换必填字段中 GateSet 实际要求的部分（MR 评审字段在
 * GateSet 关闭 mrReview 时豁免）。guard 校验与 transition 缺口提示共用，
 * 避免「校验过、提示仍要补」的幽灵缺口（I3）。
 */
export function effectiveRequiredFields(t: Pick<Transition, 'requiredFields'>, gateSet: GateSet | undefined): string[] {
  return t.requiredFields.filter((f) => !isWaivedByGateSet(gateSet, f));
}

function validateGateSet(gateSet: GateSet | undefined): GuardResult {
  if (!gateSet) return ok();
  const errors = gateSetValidationErrors(gateSet);
  return errors.length ? fail(errors, ['gateSet']) : ok();
}

/** GateSet fields must be consumed as executable constraints, not presentation metadata. */
function validateGateSetRequirements(payload: Payload): GuardResult {
  const gateSet = payload.du?.gateSet;
  if (!gateSet) return ok();
  const reasons: string[] = [];
  const missing: string[] = [];
  const isProductionReleaseTransition = payload.from === '待发布'
    && (payload.to === '生产验收中' || payload.to === '生产验证中');
  if (gateSet.rollbackPlan && isProductionReleaseTransition
    && !payload.fields['回滚方案'] && !payload.fields['发布记录或回滚信息']) {
    missing.push('回滚方案');
    reasons.push('GateSet 要求回滚方案：填写「回滚方案」或「发布记录或回滚信息」');
  }
  if (gateSet.regression === 'full' && (payload.from === '开发中' || payload.from === '测试中')) {
    const evidence = payload.fields['回归范围或证据'] ?? '';
    const environment = payload.from === '开发中' ? 'local' : 'test';
    const duRun = payload.du ? latestEvidence(payload.du, 'test-run', environment) : undefined;
    const hasStructuredFullEvidence = duRun?.outcome === 'passed';
    if (!hasStructuredFullEvidence && !/全量|完整|full/i.test(evidence)) {
      missing.push('回归范围或证据');
      reasons.push('GateSet 要求 full 回归：提供通过的 DU TestRun，或明确记录全量/完整回归');
    }
  }
  return missing.length ? fail(reasons, missing) : ok();
}

function validateTestDataAlignment(payload: Payload): GuardResult {
  if (payload.from !== '测试中' || payload.to !== '待发布') return ok();
  const evidence = payload.fields['回归范围或证据'] ?? '';
  const dataList = payload.fields['测试环境数据清单'] ?? '';
  if (!dataList.trim()) return ok();
  const caseRefs = extractCaseRefs(evidence);
  if (caseRefs.length) {
    const normalizedDataList = dataList.toUpperCase();
    const missingRefs = caseRefs.filter((ref) => !normalizedDataList.includes(ref));
    if (missingRefs.length) {
      return fail([
        `测试环境数据清单必须与回归范围或证据逐行对齐，当前缺少用例/场景数据：${missingRefs.join('、')}。每个回归用例/场景必须列出测试数据、关键业务键、来源和保留/清理策略`,
      ], ['测试环境数据清单']);
    }
  }
  const hasScenarioOrCase = /用例|场景|case|TC-|TP-/i.test(dataList);
  const hasAuditableData = /数据|业务键|单号|单|记录|账号|租户|员工|id/i.test(dataList);
  if (hasScenarioOrCase && hasAuditableData) return ok();
  return fail([
    '测试环境数据清单必须与回归范围或证据中的测试场景/用例逐行对齐：至少包含用例/场景标识、测试数据、关键业务键、来源和保留/清理策略',
  ], ['测试环境数据清单']);
}

function extractCaseRefs(text: string): string[] {
  return unique((text.match(/\b(?:TC|TP|CASE)-[A-Za-z0-9._-]+\b/gi) ?? [])
    .map((x) => x.toUpperCase()));
}

export function validateTransition(model: StateMachine, facts: IssueFacts, payload: Payload, notes: IssueNote[] = []): GuardResult {
  const t = transitionFor(model, payload.type, payload.from, payload.to);
  if (!t) return fail([`transition ${payload.from}->${payload.to} not allowed`]);
  const gateSetShape = validateGateSet(payload.du?.gateSet);
  if (!gateSetShape.ok) return gateSetShape;

  const missing: string[] = [];
  const reasons: string[] = [];

  // G5 label uniqueness + clean state
  const prefix = STATUS_PREFIX[payload.type];
  const statusLabels = facts.labels.filter((l) => l.startsWith(prefix));
  if (statusLabels.length !== 1) return fail([`脏状态：期望 1 个 ${prefix}* 标签，实际 ${statusLabels.length} 个（人工修复后继续）`]);
  if (facts.labels.filter((l) => l.startsWith('type::')).length !== 1) return fail(['脏状态：期望 1 个 type::* 标签']);

  // G1 required fields (G9: no placeholder 待确认); G14 waives MR review per GateSet
  // （skipStates 含 测试中 的路线永远不触发 测试中→待发布 本转换）
  for (const f of effectiveRequiredFields(t, payload.du?.gateSet)) {
    const v = payload.fields[f];
    if (v === undefined || v === '' || v === '待确认') missing.push(f);
  }

  // G2 gate outcome binary
  if (t.gateOutcome && payload.gateOutcome !== '通过') {
    return fail([`gate ${t.gate} 结论为 ${payload.gateOutcome ?? '未定'}，需走退回路径`], missing);
  }

  // G3 hard gate
  if (t.hardGate && !payload.humanConfirmed) reasons.push(`hard-gate ${t.gate} 需人工确认：在 payload 加 humanConfirmed: true 才能流转（不可关闭的红线）`);

  // G4 review type matches gate
  if (t.gate && payload.reviewType && t.gate !== payload.reviewType) reasons.push(`reviewType ${payload.reviewType} 与门禁 ${t.gate} 不符`);

  // G6 assignee concrete user (must start with @, not a bare role)
  if (!payload.assigneeUser || !/^@.+$/.test(payload.assigneeUser) || ROLES.has(payload.assigneeUser)) {
    reasons.push('Assignee 必须是具体 GitLab 用户（@前缀；角色名不行——请填 @用户，或在 config 配 roles 默认由引擎兜底）');
  }

  // G6b role cross-check — only when a 交付协同 table is present in the issue body
  const assigneeTable = parseAssigneeTable(facts.body);
  if (assigneeTable.size > 0) {
    const expectedUser = assigneeTable.get(t.assigneeRole);
    if (!expectedUser) {
      reasons.push(`交付协同表缺少「${t.assigneeRole}」角色用户`);
    } else if (payload.assigneeUser && payload.assigneeUser !== expectedUser) {
      reasons.push(`Assignee ${payload.assigneeUser} 与交付协同表的「${t.assigneeRole}」(${expectedUser}) 不符`);
    }
  }

  // G10 date confirmation
  const hasDate = Object.keys(payload.fields).some((k) => /日期/.test(k));
  if (hasDate && !payload.datesConfirmed) reasons.push('日期需用户确认后才能落盘(datesConfirmed)');

  // G11 blocking test issues verified (affirmative set, not exact '是')
  if (payload.from === '测试中' && payload.to === '待发布') {
    if (!isAffirmative(payload.fields['阻塞发布问题均已验证通过'])) {
      reasons.push('存在未验证的阻塞发布问题，不得进入 待发布（字段「阻塞发布问题均已验证通过」填 是 / 已验证 / 无阻塞 / true / yes）');
    }
    // G11b（Q2）：交叉核对测试问题评论——自报字段不够，Issue 上挂着「阻塞=是且未验证」的问题时拒绝放行。
    const unverified = unverifiedBlockingTestIssues(notes);
    if (unverified.length) {
      reasons.push(`测试问题评论存在未验证的阻塞项（${unverified.join('、')}）：阻塞发布=是 且 验证结果≠通过 的问题必须先复测通过，不能只填汇总字段放行`);
    }
  }

  // G12 terminal atomicity
  if (t.terminal && !payload.closeIssue) reasons.push('终态需同一次操作关闭 Issue(closeIssue)');

  const gateSetRequirements = validateGateSetRequirements(payload);
  const reviewEvidenceGate = payload.type === 'story' && payload.from === '待评审' && payload.to === '已评审'
    ? validateRequirementsReviewEvidence(facts.body, notes, payload.reviewEvidence)
    : ok();
  const testRunGate = validateTestRunTransition(payload, notes);
  const changeImpactGate = validateChangeImpactClosure(notes);
  const testDataAlignmentGate = validateTestDataAlignment(payload);
  if (missing.length || reasons.length || !gateSetRequirements.ok || !reviewEvidenceGate.ok || !testRunGate.ok || !changeImpactGate.ok || !testDataAlignmentGate.ok) {
    return fail(
      unique([...reasons, ...gateSetRequirements.reasons, ...reviewEvidenceGate.reasons, ...testRunGate.reasons, ...changeImpactGate.reasons, ...testDataAlignmentGate.reasons]),
      unique([...missing, ...gateSetRequirements.missing, ...reviewEvidenceGate.missing, ...testRunGate.missing, ...changeImpactGate.missing, ...testDataAlignmentGate.missing]),
    );
  }
  return ok();
}

const ALLOWED_OPS = new Set<WriteOp['kind']>(['add_label', 'remove_label', 'set_assignee', 'add_comment', 'close_issue']);
const FORBIDDEN = new Set(['edit_comment', 'edit_issue_body', 'update_issue_body', 'create_jira', 'delete_comment']);

export function validateWritePlan(plan: WritePlan): GuardResult {
  const reasons: string[] = [];
  for (const op of plan.ops) {
    const k = (op as { kind: string }).kind;
    if (FORBIDDEN.has(k)) reasons.push(`禁止的操作 ${k}（G7/G8/G13：不改原文/不编评论/不建Jira）`);
    else if (!ALLOWED_OPS.has(k as WriteOp['kind'])) reasons.push(`未知操作 ${k}`);
  }
  return reasons.length ? fail(reasons) : ok();
}

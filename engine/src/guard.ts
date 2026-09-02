import type { StateMachine, IssueFacts, IssueNote, Payload, GuardResult, WritePlan, WriteOp, WeekPlanChangeInput, TestRun, TestPlan, ApifoxAssetAudit, ApifoxAssetRecord, LatestTestRun, LatestApifoxAssetAudit, TestMethod, DuState, Transition, GateSet } from './types.js';
import { transitionFor } from './model.js';
import { parseAssigneeTable } from './parse.js';
import { STATUS_PREFIX, ROLES } from './constants.js';
import { parseLatestWeekPlan, validateWeekPlan } from './week-plan.js';
import { parseLatestTestRun, parseTestPlan, validateTestRun } from './test-run.js';
import { parseLatestApifoxAssetAudit, validateApifoxAssetAudit } from './asset-audit.js';
import { validateRequirementsReviewEvidence } from './review-evidence.js';
import { validateChangeImpactClosure } from './change-impact.js';
import { isWaivedByGateSet } from './gate-set.js';
import { chronologicalNotes } from './notes.js';
import { latestEvidence } from './du.js';

const ok = (): GuardResult => ({ ok: true, missing: [], reasons: [] });
const fail = (reasons: string[], missing: string[] = []): GuardResult => ({ ok: false, missing, reasons });
const unique = (values: string[]): string[] => [...new Set(values)];

const WEEK_PLAN_INPUT_HINT = '提供 weekPlan: { startDate: YYYY-MM-DD, endDate: YYYY-MM-DD, autoRollover: true|false }';
const WEEK_PLAN_READBACK_HINT = '在 Issue 最新 ## 周排期 评论中补齐有效的开始、完成、覆盖周和自动 rollover 字段';

function isWeekPlanInput(value: unknown): value is NonNullable<Payload['weekPlan']> {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.startDate === 'string' && typeof plan.endDate === 'string' && typeof plan.autoRollover === 'boolean';
}

const CHANGE_FACTS = ['changeDate', 'originalPlan', 'reason', 'impact', 'nextStep', 'owner'] as const;

/** Validates the complete, comment-only schedule-change command payload. */
export function validateWeekPlanChange(input: unknown): GuardResult {
  if (!input || typeof input !== 'object') {
    return fail(['排期变更输入必须是对象'], ['iid', 'weekPlan', ...CHANGE_FACTS]);
  }

  const value = input as Partial<WeekPlanChangeInput>;
  const missing: string[] = [];
  const reasons: string[] = [];
  if (!Number.isInteger(value.iid) || value.iid! <= 0) missing.push('iid');

  for (const field of CHANGE_FACTS) {
    if (typeof value[field] !== 'string' || !value[field]!.trim()) missing.push(field);
  }

  if (!isWeekPlanInput(value.weekPlan)) {
    missing.push('weekPlan');
  } else {
    const validation = validateWeekPlan(value.weekPlan);
    if (!validation.ok) reasons.push(`周排期无效：${validation.errors.join('；')}`);
  }

  return missing.length || reasons.length ? fail(reasons, missing) : ok();
}

/** Applies the schedule contract to any forward entry point, including legacy CLI commands. */
export function validateWeekPlanTransition(payload: Payload, notes: IssueNote[] = []): GuardResult {
  if (payload.type !== 'story') return ok();
  if (payload.from === '待评审' && payload.to === '已评审') {
    if (!isWeekPlanInput(payload.weekPlan)) return fail([`周排期缺失：${WEEK_PLAN_INPUT_HINT}`], ['weekPlan']);
    const validation = validateWeekPlan(payload.weekPlan);
    return validation.ok ? ok() : fail([`周排期无效：${validation.errors.join('；')}`], ['weekPlan']);
  }
  if (payload.from === '已评审' && payload.to === '开发中') {
    const latest = parseLatestWeekPlan(notes);
    if (latest.kind === 'absent') return fail([`最新周排期缺失：${WEEK_PLAN_READBACK_HINT}`], ['latestWeekPlan']);
    if (latest.kind === 'invalid-latest') return fail([`最新周排期无效：${latest.errors.join('；')}`], ['latestWeekPlan']);
  }
  return ok();
}

/** 当前计划在该环境是否要求 v2 审计（presentation/auth-profile 证据 DU 尚无法承载）。 */
function planRequiresV2Audit(plan: TestPlan, environment: string): boolean {
  return plan.cases.some((item) => item.environments.includes(environment) && (item.presentations.length || item.authProfiles.length));
}

/**
 * DU 本地证据 → TestRun 形状（评论瘦身，P2）。
 * cases/evidence 按当前计划推导填充（DU 明细在本地 detailRef，评论格式的
 * 回读锚点以中性占位满足结构）；assetAudit 拼成 `${planVersion}/${environment}`
 * 与评论标记约定一致，让关联校验照常工作。outcome 非 passed 一律不合成
 * 通过形状，直接以 invalid-latest 带根因拒绝——fail-closed，用户看到
 * 「须重跑」而不是合成形状缺 case 的逐项噪音。
 */
function duTestRunFor(du: DuState | undefined, plan: TestPlan, environment: string): LatestTestRun | undefined {
  const entry = du ? latestEvidence(du, 'test-run', environment) : undefined;
  if (!entry) return undefined;
  if (entry.outcome !== 'passed') {
    return { kind: 'invalid-latest', errors: [`DU 记录 outcome=${entry.outcome}，须重跑后再记录`] };
  }
  // H1：版本占位符拒绝——旧 DU 无 version 或占位 'du' 时不再合成通过形状，
  // 要求带真实被测版本（cli du record 已强制新记录必填）后重记。
  if (!entry.version || !entry.version.trim() || entry.version.trim() === 'du') {
    return { kind: 'invalid-latest', errors: [`DU test-run 缺少真实被测版本（version 占位/缺失）：请以 cli du record 附 version（报告回读的运行版本）重记`] };
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
    version: entry.version,
    outcome: 'passed',
    assetAudit: `${entry.planVersion}/${entry.environment}`,
    cases,
    evidence,
  };
  return { kind: 'valid' as const, run };
}

/**
 * DU 本地证据 → ApifoxAssetAudit 形状（评论瘦身，P2）。
 * project/branch 是展示字段，DU 不登记（明细在本地 detailRef）；审计语义由
 * 「计划内资产全覆盖 + 计划版本一致 + 无未处置问题 + 有本地明细指针」表达。
 * outcome 即未处置问题数：非法值（空/非整数/负数）fail-closed 以
 * invalid-latest 拒绝，不静默归 0——主源不允许弱于兜底源。
 */
function duAssetAuditFor(du: DuState | undefined, plan: TestPlan, environment: string): LatestApifoxAssetAudit | undefined {
  const entry = du ? latestEvidence(du, 'asset-audit', environment) : undefined;
  if (!entry) return undefined;
  // DU 无法承载 presentation/auth-profile 证据，回落 Issue 评论（spec 留待后续阶段补齐）。
  if (planRequiresV2Audit(plan, environment)) return undefined;
  const raw = entry.outcome.trim();
  const unresolved = Number(raw);
  if (!raw || !Number.isInteger(unresolved) || unresolved < 0) {
    return { kind: 'invalid-latest', errors: [`DU asset-audit outcome 无效（须为非负整数）：${entry.outcome}`] };
  }
  const assets = plan.cases
    .filter((item) => item.environments.includes(environment))
    .flatMap((item) => item.assets.map((type): ApifoxAssetRecord => ({ caseId: item.id, type, id: entry.detailRef ?? 'du', action: 'reuse' })));
  const audit: ApifoxAssetAudit = {
    environment: entry.environment,
    planVersion: entry.planVersion,
    project: '',
    branch: '',
    unresolvedFindings: unresolved,
    evidence: entry.detailRef ?? 'du',
    assets,
  };
  return { kind: 'valid' as const, audit };
}

/** Applies one versioned test plan to the local and test acceptance gates. */
export function validateTestRunTransition(payload: Payload, notes: IssueNote[] = []): GuardResult {
  const environment = payload.from === '开发中' && payload.to === '测试中'
    ? 'local'
    : payload.from === '测试中' && payload.to === '待发布'
      ? 'test'
      : undefined;
  if (!environment) return ok();

  const parsedPlan = parseTestPlan(payload.testPlan);
  if (!parsedPlan.ok) return fail([`测试计划缺失或无效：${parsedPlan.errors.join('；')}`], ['testPlan']);
  // DU 优先：本地有该环境事实就不看评论（存量 Issue 无 DU 仍走评论兜底）。
  const parsedLatest = duTestRunFor(payload.du, parsedPlan.plan, environment) ?? parseLatestTestRun(notes, environment);
  const validation = validateTestRun(parsedPlan.plan, environment, parsedLatest);
  return validation.ok ? ok() : fail(validation.errors, [`${environment}TestRun`]);
}

/** Requires a current, read-back Apifox asset audit before each environment TestRun can pass. */
export function validateApifoxAssetAuditTransition(payload: Payload, notes: IssueNote[] = []): GuardResult {
  const environment = payload.from === '开发中' && payload.to === '测试中'
    ? 'local'
    : payload.from === '测试中' && payload.to === '待发布'
      ? 'test'
      : undefined;
  if (!environment) return ok();
  const parsedPlan = parseTestPlan(payload.testPlan);
  if (!parsedPlan.ok) return fail([`测试计划缺失或无效：${parsedPlan.errors.join('；')}`], ['testPlan']);
  // DU 优先（同上）：明细归 DU，Issue 评论仅兜底；计划要求 v2 审计时适配器
  // 自行回落评论（presentation/auth-profile 证据 DU 尚无法承载）。
  const parsedLatest = duAssetAuditFor(payload.du, parsedPlan.plan, environment) ?? parseLatestApifoxAssetAudit(notes, environment);
  const validation = validateApifoxAssetAudit(parsedPlan.plan, environment, parsedLatest);
  return validation.ok ? ok() : fail(validation.errors, [`${environment}AssetAudit`]);
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

export function validateTransition(model: StateMachine, facts: IssueFacts, payload: Payload, notes: IssueNote[] = []): GuardResult {
  const t = transitionFor(model, payload.type, payload.from, payload.to);
  if (!t) return fail([`transition ${payload.from}->${payload.to} not allowed`]);

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

  const weekPlanGate = validateWeekPlanTransition(payload, notes);
  const reviewEvidenceGate = payload.type === 'story' && payload.from === '待评审' && payload.to === '已评审'
    ? validateRequirementsReviewEvidence(facts.body, notes, payload.reviewEvidence)
    : ok();
  const assetAuditGate = validateApifoxAssetAuditTransition(payload, notes);
  const testRunGate = validateTestRunTransition(payload, notes);
  const changeImpactGate = validateChangeImpactClosure(notes);
  if (missing.length || reasons.length || !weekPlanGate.ok || !reviewEvidenceGate.ok || !assetAuditGate.ok || !testRunGate.ok || !changeImpactGate.ok) {
    return fail(
      unique([...reasons, ...weekPlanGate.reasons, ...reviewEvidenceGate.reasons, ...assetAuditGate.reasons, ...testRunGate.reasons, ...changeImpactGate.reasons]),
      unique([...missing, ...weekPlanGate.missing, ...reviewEvidenceGate.missing, ...assetAuditGate.missing, ...testRunGate.missing, ...changeImpactGate.missing]),
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

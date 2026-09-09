import type { ActionTier, StateMachine, TransitionInput, TransitionOutput, MissingItem, Payload, Transition, PlaybookStep, GateSet, GateEnvironment, GuardResult } from './types.js';
import { currentNode, transitionFor, allowedTransitions, progressStepsFor } from './model.js';
import { validateTransition, effectiveRequiredFields } from './guard.js';
import { deriveGateSet, gateScopeValidationErrors, gateSetConsistencyErrors, gateSetValidationErrors } from './gate-set.js';
import { classifyAction } from './action-policy.js';
import { parseAssigneeTable } from './parse.js';
import { buildForwardPlan } from './plan.js';
import { renderNodeComment, validatePublicComment } from './render.js';
import { STATUS_PREFIX, TERMINAL, ROLES } from './constants.js';
import { chronologicalNotes } from './notes.js';
import { reconcileLabels } from './reconcile.js';

/** 角色名不是用户；其余自动补 @ 前缀。 */
function ensureAt(user: string | undefined): string | undefined {
  if (!user) return undefined;
  const u = user.trim();
  if (!u || ROLES.has(u)) return undefined;
  return u.startsWith('@') ? u : `@${u}`;
}

/** 必填字段的来源/格式提示——给 Leader「去哪取 / 填什么」的可操作线索。 */
const FIELD_HINTS: Record<string, string> = {
  评审日期: '评审会议/决策日期',
  产品确认人: '@产品用户（交付协同表 / config.roles）',
  评审结论: '通过 / 退回',
  需求文档或评审记录: '需求文档链接或评审记录',
  技术方案评审通过记录或免评审结论: '技评通过记录，或免评审结论',
  实际开始日期: '开发实际开始日期',
  研发Assignee: '@研发用户',
  计划提测时间: '计划提测日期',
  计划上线时间: '计划上线日期',
  代码评审结论: '代码评审结论（通过/退回）',
  测试计划版本: 'test-plan.md 的 glab-flow:test-plan:v1 中 plan-version',
  Apifox资产审计记录: '刚回读的 glab-flow:apifox-asset-audit:v1 评论链接/摘要；引擎校验计划版本、资源回读、未处置问题与当前环境',
  local测试执行记录: '刚回读的 local glab-flow:test-run:v1 评论链接/摘要；引擎会校验，不以该文本本身取信',
  test测试执行记录: '刚回读的 test glab-flow:test-run:v1 评论链接/摘要；引擎会校验，不以该文本本身取信',
  提测日期: '本次提测日期',
  涉及项目与开发分支: '每个涉及项目及其开发分支（多项目用分号分隔）',
  测试说明: '测试说明 + 上线步骤与配置清单（A 随代码 / B 各环境手动）',
  测试完成日期: '测试完成日期',
  测试Assignee: '@测试用户',
  测试结论: '通过 / 退回',
  回归范围或证据: '本轮回归覆盖的测试用例/场景 + 执行证据链接或 TestRun 摘要；不能只写“已回归”',
  测试环境数据清单: 'test 环境本轮使用或产生的数据清单，必须按回归场景/用例逐行对齐；回归证据里有 TC-/TP-/CASE- 编号时，数据清单必须复用相同编号，并列测试数据、关键业务键/单号/账号、来源/seed、保留或清理策略，便于人工页面或查库核对',
  测试环境: '执行测试的环境名 + URL（来自 config 的 test_environments，如 test https://app.test.example）',
  测试账号: '测试使用的账号（来自 config 的 test_environments.<env>.account）',
  reportId与环境: '执行证据：云端 reportId + 链接 + test-report get 回读的 environmentName 与 saveDetailType=all（缺 --upload-report detail 的 none 报告页空、不算证据须重跑）',
  请求与断言统计: '执行证据：报告回读 stats（requests/passed/failed/assertions），与 CLI 输出核对',
  Apifox资产状态: '资产治理：场景/套件/测试数据是否归位、命名分组区分 local/test、页面展示与执行是否一致；不得混写「Apifox 已完整沉淀」',
  阻塞发布问题均已验证通过: '是 / 已验证 / 无阻塞（来自测试问题评论的验证结果）',
  feature分支MR评审结论: 'feature→master MR 代码评审结论（用 code-review sub-skill 跑全 MR diff）；填「通过，无 HIGH 残留」或退回',
  发布日期: '发布日期',
  发布记录或回滚信息: '发布记录 + 回滚方案（来自 release-check 产出）',
  验收完成日期: '验收完成日期',
  具体产品验收人: '@产品验收人',
  产品Assignee: '@产品用户',
  验收结论: '通过 / 退回',
  验收依据: '验收依据（E2E / DB 断言 / 业务确认）',
  验证完成日期: '验证完成日期',
  具体测试验证人: '@测试验证人',
  测试验证人Assignee: '@测试用户',
  验证结论: '通过 / 退回',
  验证依据: '生产验证依据',
};

function hintFor(field: string): string {
  return FIELD_HINTS[field] ?? '来自对应节点评论 / spec 文档';
}

/** 副作用动作 → 执行它的 sub-skill + 人类可读说明（Issue 写回由 buildPlaybook 追加到中间相位）。 */
const PLAYBOOK_ACTIONS: Record<string, { subskill?: string; desc: string }> = {
  commit_push_feature: { subskill: 'git-ops', desc: '提交并推送 feature 分支剩余改动' },
  merge_to_deploy_branch: { subskill: 'git-ops', desc: '合并 feature → deploy_branch（如 test）' },
  trigger_jenkins: { subskill: 'jenkins-deploy', desc: '交互询问 Jenkins 参数（job / 分支 / 环境类 test_version·DEPLOY_ENV / force_package·isForce 等）→ 展示部署清单确认 → 触发测试环境构建（参数确认独立于 run_mode，full-auto 也不跳过）' },
  open_release_mr_to_master: { subskill: 'git-ops', desc: '打开或确认 feature → master 发布 MR，标题=Issue 地址（含 iid）；此阶段只建 MR/更新 MR，不合并 master' },
  mr_review: { subskill: 'mr-review', desc: '评审 MR（推断需求/需求↔代码一致性/需求外改动/bug/回归）；无 HIGH 残留才放行，否则修复重评' },
  release_check: { subskill: 'release-check', desc: '产出上线步骤/配置清单/注意事项/回滚方案（引用 spec 上线清单 + 配置机制核查）' },
  deploy: { subskill: 'jenkins-deploy', desc: '执行生产部署——当前手动触发（你在 Jenkins/平台点击生产部署）；确认部署完成后推进 Issue。未来配了 prod job 可由 jenkins-deploy 驱动。' },
};

const REGRESSION_EDGES: ReadonlyMap<string, GateEnvironment> = new Map([
  ['开发中→测试中', 'local'],
  ['测试中→待发布', 'test'],
]);

function environmentForGate(tr: Transition): GateEnvironment | undefined {
  return REGRESSION_EDGES.get(`${tr.from}→${tr.to}`);
}

function isGateSetBindingTransition(type: TransitionInput['type'], current: string): boolean {
  return (type === 'story' && current === '已评审')
    || (type === 'bug' && current === '已确认缺陷');
}

function mergeValidation(...results: GuardResult[]): GuardResult {
  const missing = [...new Set(results.flatMap((result) => result.missing))];
  const reasons = [...results.flatMap((result) => result.reasons)];
  return { ok: results.every((result) => result.ok), missing, reasons };
}

function gateSetBindingValidation(
  model: StateMachine,
  input: TransitionInput,
  current: string,
  transition: Transition,
  proposedGateSet: GateSet | undefined,
): GuardResult {
  // Story keeps the historical optional proposal path; Bug development entry is
  // the hard binding boundary because a defect must carry its root-cause gates.
  if (input.type !== 'bug' || current !== '已确认缺陷' || transition.to !== '开发中') {
    return { ok: true, missing: [], reasons: [] };
  }
  if (input.du?.gateSet?.frozenAt) return { ok: true, missing: [], reasons: [] };
  if (!input.declaredScopes?.length) {
    return {
      ok: false,
      missing: ['gateSetBinding'],
      reasons: ['进入开发中前必须绑定并冻结 GateSet：提供非空 declaredScopes，或传入已有 frozen GateSet'],
    };
  }
  const scopeErrors = gateScopeValidationErrors(input.declaredScopes);
  if (scopeErrors.length) {
    return { ok: false, missing: ['gateSetBinding'], reasons: scopeErrors };
  }
  if (!model.gateMatrix || !proposedGateSet) {
    return {
      ok: false,
      missing: ['gateSetBinding'],
      reasons: ['无法从 declaredScopes 推导 GateSet：state-machine 必须声明 gateMatrix'],
    };
  }
  return {
    ok: false,
    missing: ['gateSetBinding'],
    reasons: ['GateSet 提案待绑定：Leader 必须先写入并冻结 DU，完成 Issue 写回/回读后重新运行 transition'],
  };
}

function modelGateSetValidationErrors(model: StateMachine, type: TransitionInput['type'], gateSet: GateSet): string[] {
  const errors: string[] = [];
  const permittedSkips = new Set(model.gateMatrix?.rules.flatMap((rule) => rule.skipStates ?? []) ?? []);
  for (const state of gateSet.skipStates) {
    if (!model[type].states.includes(state)) {
      errors.push(`GateSet.skipStates 包含未知节点：${state}`);
      continue;
    }
    if (!permittedSkips.has(state)) errors.push(`GateSet.skipStates 未经 gateMatrix 声明：${state}`);
    const outgoing = allowedTransitions(model, type, state);
    if (outgoing.length !== 1) errors.push(`GateSet.skipStates 节点 ${state} 必须恰好有一条后继转换`);
    if (outgoing[0]?.to === state) errors.push(`GateSet.skipStates 节点 ${state} 形成自循环`);
  }
  return errors;
}

function gateSetSteps(
  tr: Transition,
  gateSet: GateSet | undefined,
  validation: GuardResult,
  bindingGateSet?: GateSet,
): { before: PlaybookStep[]; after: PlaybookStep[] } {
  if (!gateSet && !bindingGateSet) return { before: [], after: [] };

  const before: PlaybookStep[] = [];
  const after: PlaybookStep[] = [];
  if (bindingGateSet) {
    before.push({
      action: 'bind_gateset',
      subskill: 'glab-flow',
      desc: `将 GateSet（${bindingGateSet.scopes.join('、')}）写入并冻结 DU，完成后重新运行 transition；通过校验后再执行 Issue 写回并回读`,
      phase: 'pre-writeback',
      isWriteback: false,
    });
  }
  if (tr.hardGate && tr.gate === '发布' && gateSet?.rollbackPlan) {
    before.push({
      action: 'verify_rollback_ready',
      subskill: 'release-check',
      desc: '核对已生成且已回读的生产回滚方案（GateSet 要求；不重新生成发布计划）',
      phase: 'pre-writeback',
      isWriteback: false,
    });
  }

  const environment = environmentForGate(tr);
  const evidenceGap = environment && gateSet?.environments.includes(environment)
    && (validation.missing.includes(`${environment}TestRun`)
      || validation.missing.includes(`${environment}AssetAudit`)
      || (gateSet.regression === 'full' && validation.reasons.some((reason) => reason.includes('full 回归'))));
  if (evidenceGap) {
    const regression = gateSet?.regression ?? 'affected-cases';
    const action = regression === 'full' ? 'run_full_regression' : 'run_affected_regression';
    const scope = regression === 'full' ? '全量' : '受影响用例';
    after.push({
      action,
      subskill: 'test-flow',
      environment,
      desc: `在 ${environment} 环境执行${scope}回归（GateSet）；记录 DU TestRun（声明 Apifox 资产时同时记录 AssetAudit）后重新运行 transition`,
      phase: 'pre-writeback',
      isWriteback: false,
    });
  }
  return { before, after };
}

const ACTION_TIER_RANK: Record<ActionTier, number> = { L1: 1, L2: 2, L3: 3 };

function classifyPathAction(transitions: Transition[]): { tier: ActionTier; batchTitle: string } {
  return transitions.reduce((selected, transition) => {
    const action = classifyAction(transition);
    return ACTION_TIER_RANK[action.tier] > ACTION_TIER_RANK[selected.tier] ? action : selected;
  }, classifyAction(transitions[0]!));
}

function conditionActive(when: string | undefined, config?: { deployBranch?: string; jenkins?: boolean }): boolean {
  if (when === 'config.deployBranch') return !!config?.deployBranch;
  if (when === 'config.jenkins') return !!config?.jenkins;
  return true;
}

/** 把转换声明与 GateSet runtime actions 按 config/GateSet 过滤，再追加 Issue 写回。 */
function buildPlaybook(
  transitions: Transition[],
  config: TransitionInput['config'],
  gateSet?: GateSet,
  validation: GuardResult = { ok: true, missing: [], reasons: [] },
  bindingGateSet?: GateSet,
  writebackAllowed = true,
): PlaybookStep[] {
  const steps: PlaybookStep[] = [];
  const seen = new Set<string>();
  for (const [index, tr] of transitions.entries()) {
    const gateSteps = gateSetSteps(
      tr,
      gateSet,
      validation,
      index === 0 ? bindingGateSet : undefined,
    );
    for (const generated of gateSteps.before) {
      const key = `${generated.action}:${generated.environment ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push(generated);
    }
    const appendGenerated = (generated: PlaybookStep): void => {
      const key = `${generated.action}:${generated.environment ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      steps.push(generated);
    };
    const regressionSteps = gateSteps.after;
    if (regressionSteps.length) {
      // Missing environment evidence is a remediation checkpoint, not permission
      // to run merge/MR/release actions against a stale validation snapshot.
      if (regressionSteps.some((step) => step.environment === 'local')) {
        const commit = tr.playbook?.find((decl) => decl.action === 'commit_push_feature');
        if (commit) {
          const meta = PLAYBOOK_ACTIONS[commit.action] ?? { desc: commit.action };
          steps.push({ action: commit.action, subskill: meta.subskill, when: commit.when, desc: meta.desc, phase: 'pre-writeback', isWriteback: false });
        }
      }
      for (const generated of regressionSteps) appendGenerated(generated);
      break;
    }
    for (const decl of tr.playbook ?? []) {
      if (!conditionActive(decl.when, config)) continue;
      if (gateSet && gateSet.mrReview === false && ['open_release_mr_to_master', 'mr_review'].includes(decl.action)) continue;
      const key = `${decl.action}:${decl.when ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = PLAYBOOK_ACTIONS[decl.action] ?? { desc: decl.action };
      steps.push({ action: decl.action, subskill: meta.subskill, when: decl.when, desc: meta.desc, phase: 'pre-writeback', isWriteback: false });
      // Local validation must happen after the feature commit but before merge or deployment actions.
      if (decl.action === 'commit_push_feature') {
        for (const generated of gateSteps.after.filter((step) => step.environment === 'local')) appendGenerated(generated);
      }
    }
    for (const generated of gateSteps.after.filter((step) => step.environment !== 'local')) appendGenerated(generated);
  }
  if (!bindingGateSet && writebackAllowed) {
    steps.push({ action: 'issue_writeback', desc: '应用 WritePlan 写回 Issue（标签 / Assignee / 评论 / 关闭）并最终回读', phase: 'issue-writeback', isWriteback: true });
  }
  return steps;
}

function unescapeMarkdownTableCell(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\\|/g, '|')
    .trim();
}

/**
 * 扫全部评论里的字段行，按精确 key 建字段→值映射。
 * 兼容旧格式「- 字段：值」和新格式「| 字段 | 内容 |」；同名字段后出现的覆盖先出现的。
 * `chronologicalNotes` 会先把 GitLab 默认 newest-first 的 API 回读归一为时间升序。
 */
function scanFieldsFromNotes(notes: TransitionInput['notes']): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of chronologicalNotes(notes)) {
    for (const line of n.body.split('\n')) {
      const bullet = line.match(/^-\s+(.+?)[：:](.+)$/);
      const table = line.match(/^\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*$/);
      const key = bullet?.[1]?.trim() ?? table?.[1]?.trim();
      const rawVal = bullet?.[2]?.trim() ?? table?.[2]?.trim();
      const val = rawVal ? unescapeMarkdownTableCell(rawVal) : undefined;
      if (key === '项目' || /^-+$/.test(key ?? '') || /^-+$/.test(val ?? '')) continue;
      if (key && val && val !== '待确认') map.set(key, val);
    }
  }
  return map;
}

/**
 * renderStatusChange 把字段归一化为「实际日期 / 确认人 / 结论 / 依据」语义槽位写入评论
 * （evidence 抽取契约，见 render.ts / evidence.ts）。下次预填若只按精确 key 匹配会漏掉
 * （评论里是槽位名，不是原字段名）。FIELD_TO_SLOT 把 requiredField 反查到它的语义槽位名，
 * 让预填也能从归一化评论回填。每类语义字段在每个转换的 requiredFields 中恰好唯一
 * （已对照 state-machine.yaml 核对），故无歧义。
 */
const SEMANTIC_SLOTS: Record<string, string[]> = {
  实际日期: ['评审日期', '实际开始日期', '提测日期', '测试完成日期', '发布日期', '验收完成日期', '验证完成日期'],
  确认人: ['产品确认人', '测试Assignee', '研发Assignee', '具体产品验收人', '具体测试验证人', '测试验证人Assignee'],
  结论: ['评审结论', '测试结论', '验收结论', '验证结论'],
  依据: ['需求文档或评审记录', '回归范围或证据', '验收依据', '验证依据', '发布记录或回滚信息', '技术方案评审通过记录或免评审结论'],
};
const FIELD_TO_SLOT: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [slot, fields] of Object.entries(SEMANTIC_SLOTS)) for (const f of fields) m.set(f, slot);
  return m;
})();

function previewText(from: string, to: string, payload: Payload, validateOk: boolean, missing: MissingItem[], hardGate: boolean, shouldConfirm: boolean, runMode: string, tier: ActionTier, playbook: PlaybookStep[], nodeProgress: string[]): string {
  const lines: string[] = [`状态变更：${from} → ${to}`];
  if (nodeProgress.length) lines.push(`当前节点子步骤：${nodeProgress.join(' / ')}`);
  const code = playbook.filter((s) => s.phase === 'pre-writeback');
  if (code.length) {
    lines.push(`动作包（代码侧，先于 Issue 写回）：\n${code.map((s, i) => `  ${i + 1}. ${s.desc}${s.subskill ? ` — ${s.subskill}` : ''}`).join('\n')}`);
  }
  lines.push(`标签：移除 ${STATUS_PREFIX[payload.type]}${from}，新增 ${STATUS_PREFIX[payload.type]}${to}`);
  lines.push(`Assignee：${payload.assigneeUser ?? '（未解析）'}`);
  lines.push(`评论：将发表合并评论（状态变更头 + 内容体，由 renderNodeComment 生成）`);
  lines.push(`关闭 Issue：${payload.closeIssue ? '是（终态原子）' : '否'}`);
  lines.push(`校验：${validateOk ? '✓ 通过' : '✗ 未通过（见 reasons）'}`);
  if (missing.length) lines.push(`缺口：\n${missing.map((m) => `  - ${m.field} — ${m.hint}`).join('\n')}`);
  if (hardGate) lines.push('hard_gate：必须人工确认（humanConfirmed），无论 run 模式');
  const postReadback = playbook.filter((s) => s.phase === 'post-readback');
  if (postReadback.length) {
    lines.push(`回读后动作（不得与状态写回并行）：\n${postReadback.map((s, i) => `  ${i + 1}. ${s.desc}`).join('\n')}`);
  }
  lines.push(`动作分层：${tier} → ${shouldConfirm ? '批量确认后写回（Jenkins 参数并入本次确认）' : '自动写回（可逆/非门禁流转）'}；run 模式 ${runMode} 仅作审计记录`);
  return lines.join('\n');
}

/** 一次调用编排：推导节点 → 脏检测 → 抽证据 → 查契约 → 解析 Assignee → 组装 → 校验 → 建计划 → 预览。纯计算，不应用。 */
export function runTransition(model: StateMachine, input: TransitionInput): TransitionOutput {
  const prefix = STATUS_PREFIX[input.type];
  const statusLabels = input.labels.filter((l) => l.startsWith(prefix));
  const node = statusLabels.length === 1 ? (currentNode(model, input.type, input.labels) ?? null) : null;

  // 脏检测：0/≥2 状态标签，或 closed 但非终态
  let dirtyReason: string | undefined;
  if (statusLabels.length !== 1) {
    dirtyReason = `脏状态：期望 1 个 ${prefix}* 标签，实际 ${statusLabels.length} 个（人工修标签后重跑）`;
  } else if (input.state === 'closed' && node && !TERMINAL.has(node)) {
    dirtyReason = `脏状态：Issue 已关闭但节点=${node} 非终态（${[...TERMINAL].join('/')}），疑似被提前关闭——reopen 或人工对账标签`;
  }

  if (dirtyReason) {
    return {
      node, next: null, dirty: true, dirtyReason, prefilled: {}, missing: [], playbook: [], nodeProgress: [],
      validate: { ok: false, missing: [], reasons: [dirtyReason] },      preview: dirtyReason, shouldConfirm: true, applied: false,
    };
  }

  if (input.du?.gateSet) {
    const gateSetErrors = gateSetValidationErrors(input.du.gateSet);
    const consistencyErrors = model.gateMatrix
      ? gateSetConsistencyErrors(model.gateMatrix, input.du.gateSet, input.du.affectedScopes)
      : ['GateSet 无法校验：state-machine 必须声明 gateMatrix'];
    const modelErrors = modelGateSetValidationErrors(model, input.type, input.du.gateSet);
    const allGateSetErrors = [...new Set([...gateSetErrors, ...consistencyErrors, ...modelErrors])];
    if (allGateSetErrors.length) {
      const reason = `GateSet 无效：${allGateSetErrors.join('；')}`;
      return {
        node, next: null, dirty: true, dirtyReason: reason, prefilled: {},
        missing: [{ field: 'gateSet', hint: '修复 DU GateSet 后重跑' }], playbook: [], nodeProgress: [],
        validate: { ok: false, missing: ['gateSet'], reasons: allGateSetErrors }, preview: reason, shouldConfirm: true, applied: false,
      };
    }
  }

  if (input.du) {
    const reconciliation = reconcileLabels(model, { type: input.type, labels: input.labels, state: input.state, du: input.du });
    if (reconciliation.kind !== 'in-sync') {
      const reason = `DU/Issue 对账未通过（${reconciliation.kind}）：${reconciliation.resolution}`;
      return {
        node, next: null, dirty: true, dirtyReason: reason, prefilled: {},
        missing: [{ field: 'duReconciliation', hint: reconciliation.resolution }], playbook: [], nodeProgress: [],
        validate: { ok: false, missing: ['duReconciliation'], reasons: [reason] }, preview: reason, shouldConfirm: true, applied: false,
      };
    }
  }

  const current = node as string;
  const target = input.to ?? allowedTransitions(model, input.type, current)[0]?.to;
  const tr = target ? transitionFor(model, input.type, current, target) : undefined;

  if (!tr) {
    const msg = `无可用转换（not allowed）：from=${current} to=${target ?? '(未指定且无默认下一节点)'}——检查 to 节点名或当前标签`;
    return {
      node: current, next: target ?? null, dirty: false, prefilled: {}, missing: [], playbook: [], nodeProgress: [],
      validate: { ok: false, missing: [], reasons: [msg] },      preview: msg, shouldConfirm: true, applied: false,
    };
  }

  // 跳状态投影（GateSet.skipStates）：被跳过的节点直接推进到其下一节点。只跳一层。
  // 原 edge 仍负责字段/证据门禁；目标 edge 负责投影后的 ownership 与副作用动作。
  const skip = input.du?.gateSet?.skipStates ?? [];
  const candidateProjection = skip.includes(tr.to)
    ? allowedTransitions(model, input.type, tr.to)[0]
    : undefined;
  const effectiveTarget = candidateProjection?.to ?? tr.to;
  const projected = !!candidateProjection;
  const ownershipTransition = candidateProjection ?? tr;

  // 解析 Assignee：交付协同表 → config.roles → 输入；自动补 @
  const table = parseAssigneeTable(input.body);
  const role = tr.assigneeRole as string;
  const projectedRole = ownershipTransition.assigneeRole as string;
  const resolveAssignee = (targetRole: string): string | undefined => ensureAt(
    targetRole === role ? input.assigneeUser ?? table.get(targetRole) ?? input.config?.roles?.[targetRole]
      : table.get(targetRole) ?? input.config?.roles?.[targetRole],
  );
  const assigneeUser = resolveAssignee(role);
  const projectedAssigneeUser = projected ? resolveAssignee(projectedRole) : assigneeUser;

  const prefilled: Record<string, string> = {};
  if (projectedAssigneeUser) {
    const src = input.assigneeUser ? '输入' : table.get(projectedRole) ? '交付协同表' : 'config.roles';
    prefilled.assigneeUser = `${projectedAssigneeUser}（来自${src}）`;
  }

  // 证据智能预填：扫评论「- 字段：值」，按精确 key 填必填字段（user 输入优先，最新值优先，标「请核实」）
  const evidenceFields = scanFieldsFromNotes(input.notes);
  const prefillFields: Record<string, string> = {};
  for (const f of tr.requiredFields) {
    const userVal = input.fields?.[f];
    if (userVal && userVal !== '待确认') continue; // 用户已给，不覆盖
    // 精确 key 优先；失败则按语义槽位（实际日期/确认人/结论/依据）回填——render 归一化评论的兼容
    const slot = FIELD_TO_SLOT.get(f);
    const evVal = evidenceFields.get(f) ?? (slot ? evidenceFields.get(slot) : undefined);
    if (evVal && evVal !== '待确认') {
      prefillFields[f] = evVal;
      prefilled[f] = `${evVal}（来自评论，请核实）`;
    }
  }

  const isBindingTransition = isGateSetBindingTransition(input.type, current)
    && tr.to === '开发中';
  const declaredScopeErrors = gateScopeValidationErrors(input.declaredScopes);
  const proposedGateSet = isBindingTransition && !input.du?.gateSet?.frozenAt
    && input.declaredScopes?.length && !declaredScopeErrors.length && model.gateMatrix
    ? deriveGateSet(model.gateMatrix, input.declaredScopes)
    : undefined;

  const payload: Payload = {
    type: input.type,
    from: current,
    to: tr.to,
    fields: { ...prefillFields, ...input.fields },
    ...(input.testPlan !== undefined ? { testPlan: input.testPlan } : {}),
    ...(input.du ? { du: input.du } : {}),
    ...(input.gateOutcome ? { gateOutcome: input.gateOutcome } : {}),
    ...(input.reviewType ? { reviewType: input.reviewType } : {}),
    ...(input.reviewEvidence ? { reviewEvidence: input.reviewEvidence } : {}),
    ...(assigneeUser ? { assigneeUser } : {}),
    ...(input.datesConfirmed !== undefined ? { datesConfirmed: input.datesConfirmed } : {}),
    ...(input.humanConfirmed !== undefined ? { humanConfirmed: input.humanConfirmed } : {}),
    ...(input.closeIssue !== undefined ? { closeIssue: input.closeIssue } : {}),
  };

  const facts = {
    labels: input.labels,
    body: input.body,
    state: input.state,
    hasJiraSourceLabel: input.labels.includes('source::jira'),
  };
  const transitionValidation = validateTransition(model, facts, payload, input.notes);
  // 跳状态时公共评论也按投影目标生成；原转换的门禁仍由上面的校验负责。
  const projectedPayload = projected
    ? {
      ...payload,
      to: effectiveTarget,
      renderTransitions: [tr, ownershipTransition],
      ...(projectedAssigneeUser ? { assigneeUser: projectedAssigneeUser } : {}),
    }
    : payload;
  const projectedGateValidation = projected
    ? validateTransition(model, facts, {
      ...projectedPayload,
      from: ownershipTransition.from,
      to: ownershipTransition.to,
    }, input.notes)
    : { ok: true, missing: [], reasons: [] };
  const pathValidation = mergeValidation(
    transitionValidation,
    projectedGateValidation,
    gateSetBindingValidation(model, input, current, tr, proposedGateSet),
  );
  const publicValidation = pathValidation.ok
    ? validatePublicComment(projectedPayload)
    : { ok: true, missing: [], reasons: [] };
  const validate = publicValidation.ok
    ? pathValidation
    : {
      ok: false,
      missing: [...pathValidation.missing, 'publicComment'],
      reasons: [...pathValidation.reasons, ...publicValidation.reasons],
    };
  // 缺口（必填未填）带 hint；豁免口径与 guard 一致（G14 按 GateSet），避免幽灵缺口（I3）
  const missing: MissingItem[] = [];
  if (!assigneeUser) {
    missing.push({ field: 'assigneeUser', hint: `@用户（角色=${role}）——来自交付协同表 / config.roles / 显式传入` });
  }
  if (validate.missing.includes('gateSetBinding')) {
    missing.push({ field: 'gateSetBinding', hint: '提供 declaredScopes 供引擎推导并冻结 GateSet，或先回读已有 frozen GateSet' });
  }
  const requiredTransitions = projected ? [tr, ownershipTransition] : [tr];
  for (const transition of requiredTransitions) {
    for (const f of effectiveRequiredFields(transition, input.du?.gateSet)) {
      const v = payload.fields[f];
      if ((v === undefined || v === '' || v === '待确认') && !missing.some((item) => item.field === f)) {
        missing.push({ field: f, hint: hintFor(f) });
      }
    }
  }
  if (projected && !projectedAssigneeUser) {
    missing.push({ field: 'assigneeUser', hint: `@用户（角色=${projectedRole}）——来自交付协同表 / config.roles / 显式传入` });
  }
  if (validate.missing.some((field) => field.startsWith('reviewEvidence'))) {
    missing.push({ field: 'reviewEvidence', hint: '补齐图片 OCR/视觉摘要、页面地址的路由代码证据和 grilling 决策账本；页面地址无法确认或存在未决问题时，先在同一批评审问题中向产品确认' });
  }
  if (validate.missing.includes('publicComment')) {
    missing.push({ field: 'publicComment', hint: '移除本地环境、测试平台、报告 ID、路径、提交哈希或机器 marker，仅保留团队可读交接信息' });
  }
  const playbookTransitions = projected ? [tr, candidateProjection!] : [tr];
  const playbook = buildPlaybook(
    playbookTransitions,
    input.config,
    input.du?.gateSet,
    pathValidation,
    proposedGateSet,
    validate.ok,
  );
  const runMode = input.runMode ?? 'semi-auto';
  const action = isBindingTransition && !input.du?.gateSet?.frozenAt
    ? { tier: 'L2' as ActionTier, batchTitle: '确认并绑定 GateSet 后进入开发' }
    : classifyPathAction(playbookTransitions);
  const shouldConfirm = !validate.ok || action.tier !== 'L1';
  // 跳状态时标签写回用 effectiveTarget（校验已按原转换完成，字段不放松）。
  const plan = validate.ok
    ? buildForwardPlan(projectedPayload, input.iid)
    : undefined;
  const nodeProgress = progressStepsFor(model, current);
  const preview = previewText(current, effectiveTarget, projectedPayload, validate.ok, missing, action.tier === 'L3', shouldConfirm, runMode, action.tier, playbook, nodeProgress);

  return {
    node: current,
    next: effectiveTarget,
    dirty: false,
    transition: tr,
    prefilled,
    missing,
    payload,
    projectedPayload,
    validate,
    // 评论头与标签写回都使用投影目标；内容体仍保留原转换的公共交付事实。
    comment: renderNodeComment(projectedPayload),
    plan,
    playbook,
    nodeProgress,
    preview,
    shouldConfirm,
    actionTier: action.tier,
    confirmBatchTitle: action.batchTitle,
    ...(proposedGateSet ? { proposedGateSet } : {}),
    applied: false,
  };
}

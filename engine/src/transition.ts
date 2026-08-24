import type { StateMachine, TransitionInput, TransitionOutput, MissingItem, Payload, Transition, PlaybookStep } from './types.js';
import { currentNode, transitionFor, allowedTransitions, progressStepsFor } from './model.js';
import { validateTransition } from './guard.js';
import { parseAssigneeTable } from './parse.js';
import { buildForwardPlan } from './plan.js';
import { renderNodeComment } from './render.js';
import { STATUS_PREFIX, TERMINAL, ROLES } from './constants.js';

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
  可测试版本或环境: '可测试版本号 / 环境（多仓分别列出）',
  测试说明: '测试说明 + 上线步骤与配置清单（A 随代码 / B 各环境手动）',
  测试完成日期: '测试完成日期',
  测试Assignee: '@测试用户',
  测试结论: '通过 / 退回',
  回归范围或证据: '回归范围或证据链接',
  测试环境: '执行测试的环境名 + url（来自 config 的 test_environments，如 stage https://stage-oa.kuainiu.io）',
  测试账号: '测试使用的账号（来自 config 的 test_environments.<env>.account）',
  reportId与环境: '执行证据：云端 reportId + 链接 + test-report get 回读的 environmentName 与 saveDetailType=all（缺 --upload-report detail 的 none 报告页空、不算证据须重跑）',
  请求与断言统计: '执行证据：报告回读 stats（requests/passed/failed/assertions），与 CLI 输出核对',
  Apifox资产状态: '资产治理：场景/套件/测试数据是否归位、命名分组区分 local/Stage、页面展示与执行是否一致；不得混写「Apifox 已完整沉淀」',
  阻塞发布问题均已验证通过: '是 / 已验证 / 无阻塞（来自测试问题评论的验证结果）',
  feature分支MR评审结论: 'feature→master MR 代码评审结论（用 code-review sub-skill 跑全 MR diff）；填「通过，无 HIGH 残留」或退回',
  发布日期: '发布日期',
  生产版本: '各仓部署版本号（多仓用分号分隔）',
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

/** 副作用动作 → 执行它的 sub-skill + 人类可读说明（Issue 写回由 buildPlaybook 末步追加）。 */
const PLAYBOOK_ACTIONS: Record<string, { subskill?: string; desc: string }> = {
  commit_push_feature: { subskill: 'git-ops', desc: '提交并推送 feature 分支剩余改动' },
  merge_to_deploy_branch: { subskill: 'git-ops', desc: '合并 feature → deploy_branch（如 test）' },
  trigger_jenkins: { subskill: 'jenkins-deploy', desc: '交互询问 Jenkins 参数（job / 分支 / 环境类 test_version·DEPLOY_ENV / force_package·isForce 等）→ 展示部署清单确认 → 触发测试环境构建（参数确认独立于 run_mode，full-auto 也不跳过）' },
  create_mr_to_master: { subskill: 'git-ops', desc: '提 PR feature → master，标题=Issue 地址（含 iid）' },
  mr_review: { subskill: 'mr-review', desc: '评审 MR（推断需求/需求↔代码一致性/需求外改动/bug/回归）；无 HIGH 残留才放行，否则修复重评' },
  release_check: { subskill: 'release-check', desc: '产出上线步骤/配置清单/注意事项/回滚方案（引用 spec 上线清单 + 配置机制核查）' },
  deploy: { subskill: 'jenkins-deploy', desc: '执行生产部署——当前手动触发（你在 Jenkins/平台点击生产部署），完成后把生产版本号告诉 Leader；未来配了 prod job 可由 jenkins-deploy 驱动。部署确认后才推进 Issue' },
};

function conditionActive(when: string | undefined, config?: { deployBranch?: string; jenkins?: boolean }): boolean {
  if (when === 'config.deployBranch') return !!config?.deployBranch;
  if (when === 'config.jenkins') return !!config?.jenkins;
  return true;
}

/** 把转换声明的 playbook（仅代码侧步骤）按 config 过滤，末尾追加 issue_writeback（官方状态变更，恒末步）。 */
function buildPlaybook(tr: Transition, config: TransitionInput['config']): PlaybookStep[] {
  const steps: PlaybookStep[] = [];
  for (const decl of tr.playbook ?? []) {
    if (!conditionActive(decl.when, config)) continue;
    const meta = PLAYBOOK_ACTIONS[decl.action] ?? { desc: decl.action };
    steps.push({ action: decl.action, subskill: meta.subskill, when: decl.when, desc: meta.desc, isWriteback: false });
  }
  steps.push({ action: 'issue_writeback', desc: '应用 WritePlan 写回 Issue（标签 / Assignee / 评论 / 关闭）', isWriteback: true });
  return steps;
}

/**
 * 扫全部评论里「- 字段：值」行（renderStatusChange / renderTestIssue 等产物格式），按精确 key 建字段→值映射。
 * 同名字段后出现的覆盖先出现的（GitLab notes 默认时间升序，后出现≈最新）。仅精确匹配，不做模糊推断。
 */
function scanFieldsFromNotes(notes: { body: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of notes) {
    for (const line of n.body.split('\n')) {
      const m = line.match(/^-\s+(.+?)[：:](.+)$/);
      if (!m) continue;
      const key = m[1]?.trim();
      const val = m[2]?.trim();
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

function previewText(from: string, to: string, payload: Payload, validateOk: boolean, missing: MissingItem[], hardGate: boolean, shouldConfirm: boolean, runMode: string, playbook: PlaybookStep[], nodeProgress: string[]): string {
  const lines: string[] = [`状态变更：${from} → ${to}`];
  if (nodeProgress.length) lines.push(`当前节点子步骤：${nodeProgress.join(' / ')}`);
  const code = playbook.filter((s) => !s.isWriteback);
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
  lines.push(`run 模式：${runMode} → ${shouldConfirm ? '需 AskUserQuestion 确认后再写回' : '护栏 ok 即可自动写回'}`);
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

  const current = node as string;
  const target = input.to ?? allowedTransitions(model, input.type, current)[0]?.to;
  const tr = target ? transitionFor(model, input.type, current, target) : undefined;

  if (!tr) {
    const msg = `无可用转换：from=${current} to=${target ?? '(未指定且无默认下一节点)'}——检查 to 节点名或当前标签`;
    return {
      node: current, next: target ?? null, dirty: false, prefilled: {}, missing: [], playbook: [], nodeProgress: [],
      validate: { ok: false, missing: [], reasons: [msg] },      preview: msg, shouldConfirm: true, applied: false,
    };
  }

  // 解析 Assignee：交付协同表 → config.roles → 输入；自动补 @
  const table = parseAssigneeTable(input.body);
  const role = tr.assigneeRole as string;
  const fromTable = table.get(role);
  const fromRoles = input.config?.roles?.[role];
  const rawAssignee = input.assigneeUser ?? fromTable ?? fromRoles;
  const assigneeUser = ensureAt(rawAssignee);

  const prefilled: Record<string, string> = {};
  if (assigneeUser) {
    const src = input.assigneeUser ? '输入' : fromTable ? '交付协同表' : 'config.roles';
    prefilled.assigneeUser = `${assigneeUser}（来自${src}）`;
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

  const payload: Payload = {
    type: input.type,
    from: current,
    to: tr.to,
    fields: { ...prefillFields, ...input.fields },
    ...(input.testPlan !== undefined ? { testPlan: input.testPlan } : {}),
    ...(input.gateOutcome ? { gateOutcome: input.gateOutcome } : {}),
    ...(input.reviewType ? { reviewType: input.reviewType } : {}),
    ...(assigneeUser ? { assigneeUser } : {}),
    ...(input.datesConfirmed !== undefined ? { datesConfirmed: input.datesConfirmed } : {}),
    ...(input.humanConfirmed !== undefined ? { humanConfirmed: input.humanConfirmed } : {}),
    ...(input.closeIssue !== undefined ? { closeIssue: input.closeIssue } : {}),
    ...(input.weekPlan ? { weekPlan: input.weekPlan } : {}),
  };

  const facts = {
    labels: input.labels,
    body: input.body,
    state: input.state,
    hasJiraSourceLabel: input.labels.includes('source::jira'),
  };
  const validate = validateTransition(model, facts, payload, input.notes);
  const playbook = buildPlaybook(tr, input.config);

  // 缺口（必填未填）带 hint
  const missing: MissingItem[] = [];
  if (!assigneeUser) {
    missing.push({ field: 'assigneeUser', hint: `@用户（角色=${role}）——来自交付协同表 / config.roles / 显式传入` });
  }
  for (const f of tr.requiredFields) {
    const v = payload.fields[f];
    if (v === undefined || v === '' || v === '待确认') missing.push({ field: f, hint: hintFor(f) });
  }
  if (validate.missing.includes('weekPlan')) {
    missing.push({ field: 'weekPlan', hint: '提供 weekPlan: { startDate: YYYY-MM-DD, endDate: YYYY-MM-DD, autoRollover: true|false }' });
  }
  if (validate.missing.includes('latestWeekPlan')) {
    missing.push({ field: 'latestWeekPlan', hint: '在 Issue 最新 ## 周排期 评论中补齐有效的开始、完成、覆盖周和自动 rollover 字段' });
  }
  const runMode = input.runMode ?? 'semi-auto';
  const plan = validate.ok ? buildForwardPlan(payload, input.iid) : undefined;
  const nodeProgress = progressStepsFor(model, current);
  const shouldConfirm = runMode === 'semi-auto' || !!tr.hardGate || !validate.ok;
  const preview = previewText(current, tr.to, payload, validate.ok, missing, !!tr.hardGate, shouldConfirm, runMode, playbook, nodeProgress);

  return {
    node: current,
    next: tr.to,
    dirty: false,
    transition: tr,
    prefilled,
    missing,
    payload,
    validate,
    comment: renderNodeComment(payload),
    plan,
    playbook,
    nodeProgress,
    preview,
    shouldConfirm,
    applied: false,
  };
}

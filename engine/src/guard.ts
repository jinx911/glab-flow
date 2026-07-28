import type { StateMachine, IssueFacts, Payload, GuardResult, WritePlan, WriteOp } from './types.js';
import { transitionFor } from './model.js';
import { parseAssigneeTable } from './parse.js';

const ok = (): GuardResult => ({ ok: true, missing: [], reasons: [] });
const fail = (reasons: string[], missing: string[] = []): GuardResult => ({ ok: false, missing, reasons });

export function validateTransition(model: StateMachine, facts: IssueFacts, payload: Payload): GuardResult {
  const t = transitionFor(model, payload.type, payload.from, payload.to);
  if (!t) return fail([`transition ${payload.from}->${payload.to} not allowed`]);

  const missing: string[] = [];
  const reasons: string[] = [];

  // G5 label uniqueness + clean state
  const prefix = payload.type === 'story' ? 'story-status::' : 'status::';
  const statusLabels = facts.labels.filter((l) => l.startsWith(prefix));
  if (statusLabels.length !== 1) return fail([`脏状态：期望 1 个 ${prefix}* 标签，实际 ${statusLabels.length} 个（人工修复后继续）`]);
  if (facts.labels.filter((l) => l.startsWith('type::')).length !== 1) return fail(['脏状态：期望 1 个 type::* 标签']);

  // G1 required fields (G9: no placeholder 待确认)
  for (const f of t.requiredFields) {
    const v = payload.fields[f];
    if (v === undefined || v === '' || v === '待确认') missing.push(f);
  }

  // G2 gate outcome binary
  if (t.gateOutcome && payload.gateOutcome !== '通过') {
    return fail([`gate ${t.gate} 结论为 ${payload.gateOutcome ?? '未定'}，需走退回路径`], missing);
  }

  // G3 hard gate
  if (t.hardGate && !payload.humanConfirmed) reasons.push(`hard-gate ${t.gate} 需人工确认证据(humanConfirmed)`);

  // G4 review type matches gate
  if (t.gate && payload.reviewType && t.gate !== payload.reviewType) reasons.push(`reviewType ${payload.reviewType} 与门禁 ${t.gate} 不符`);

  // G6 assignee concrete user (must start with @, not a bare role)
  const ROLES = ['产品', '研发', '测试'];
  if (!payload.assigneeUser || !/^@.+$/.test(payload.assigneeUser) || ROLES.includes(payload.assigneeUser)) {
    reasons.push('Assignee 必须是具体 GitLab 用户(@xxx)，不能是角色名');
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

  // G11 blocking test issues verified (field must be 是)
  if (payload.from === '测试中' && payload.to === '待发布') {
    if (payload.fields['阻塞发布问题均已验证通过'] !== '是') reasons.push('存在未验证的阻塞发布问题，不得进入 待发布');
  }

  // G12 terminal atomicity
  if (t.terminal && !payload.closeIssue) reasons.push('终态需同一次操作关闭 Issue(closeIssue)');

  if (missing.length || reasons.length) return fail(reasons, missing);
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

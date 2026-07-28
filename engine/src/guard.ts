import type { StateMachine, IssueFacts, Payload, GuardResult } from './types.js';
import { transitionFor } from './model.js';

const ok: GuardResult = { ok: true, missing: [], reasons: [] };
const fail = (reasons: string[], missing: string[] = []): GuardResult => ({ ok: false, missing, reasons });

export function validateTransition(model: StateMachine, facts: IssueFacts, payload: Payload): GuardResult {
  const t = transitionFor(model, payload.type, payload.from, payload.to);
  if (!t) return fail([`transition ${payload.from}->${payload.to} not allowed`]);

  const missing: string[] = [];
  const reasons: string[] = [];

  // G1 required fields (non-empty, not placeholder)
  for (const f of t.requiredFields) {
    const v = payload.fields[f];
    if (v === undefined || v === '' || v === '待确认') missing.push(f);
  }

  // G2 gate outcome binary (forward requires 通过)
  if (t.gateOutcome && payload.gateOutcome !== '通过') {
    return fail([`gate ${t.gate} 结论为 ${payload.gateOutcome ?? '未定'}，需走退回路径`], missing);
  }

  // G3 hard gate needs explicit human confirmation
  if (t.hardGate && !payload.humanConfirmed) {
    reasons.push(`hard-gate ${t.gate} 需人工确认证据(humanConfirmed)`);
  }

  // G4 review type must match the gate
  if (t.gate && payload.reviewType && t.gate !== payload.reviewType) {
    reasons.push(`reviewType ${payload.reviewType} 与门禁 ${t.gate} 不符`);
  }

  if (missing.length || reasons.length) return fail(reasons, missing);
  return ok;
}

import type {
  ApifoxAssetAction,
  ApifoxAssetAudit,
  ApifoxAssetAuditValidation,
  ApifoxAssetRecord,
  ApifoxAssetType,
  LatestApifoxAssetAudit,
  TestEnvironment,
  TestPlan,
} from './types.js';

const MARKER = '<!-- glab-flow:apifox-asset-audit:v1';
const ASSET_TYPES = new Set<ApifoxAssetType>(['scenario', 'suite-or-group', 'test-data', 'scenario-instance']);
const ACTIONS = new Set<ApifoxAssetAction>(['reuse', 'create', 'update', 'retire', 'cleanup']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]*$/;

type MarkerBlock = { body: string; closed: boolean };

function markerBlocks(text: string): MarkerBlock[] {
  const blocks: MarkerBlock[] = [];
  let offset = 0;
  while (true) {
    const start = text.indexOf(MARKER, offset);
    if (start < 0) return blocks;
    const bodyStart = start + MARKER.length;
    const end = text.indexOf('-->', bodyStart);
    if (end < 0) return [...blocks, { body: text.slice(bodyStart), closed: false }];
    blocks.push({ body: text.slice(bodyStart, end), closed: true });
    offset = end + 3;
  }
}

function nonEmpty(value: string | undefined): value is string {
  return !!value?.trim();
}

function parseAsset(value: string): ApifoxAssetRecord | string {
  const parts = value.split('|').map((part) => part.trim());
  if (parts.length !== 4 || !ID.test(parts[0] ?? '') || !ASSET_TYPES.has(parts[1] as ApifoxAssetType)
    || !ID.test(parts[2] ?? '') || !ACTIONS.has(parts[3] as ApifoxAssetAction)) return `asset 格式无效：${value}`;
  return { caseId: parts[0]!, type: parts[1] as ApifoxAssetType, id: parts[2]!, action: parts[3] as ApifoxAssetAction };
}

function parseBlock(block: MarkerBlock): { ok: true; audit: ApifoxAssetAudit } | { ok: false; errors: string[] } {
  if (!block.closed) return { ok: false, errors: ['Apifox 资产审计标记未闭合'] };
  const fields = new Map<string, string>();
  const assets: ApifoxAssetRecord[] = [];
  const errors: string[] = [];
  for (const rawLine of block.body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const field = line.match(/^([a-z-]+):[ \t]*(.*)$/);
    if (!field) { errors.push(`Apifox 资产审计存在无效行：${line}`); continue; }
    const [, key, value] = field;
    if (key === 'asset') {
      const parsed = parseAsset(value!);
      if (typeof parsed === 'string') errors.push(parsed);
      else assets.push(parsed);
      continue;
    }
    if (fields.has(key!)) { errors.push(`Apifox 资产审计字段重复：${key}`); continue; }
    fields.set(key!, value!.trim());
  }
  const known = new Set(['environment', 'plan-version', 'project', 'branch', 'unresolved-findings', 'evidence']);
  for (const key of fields.keys()) if (!known.has(key)) errors.push(`Apifox 资产审计含未知字段：${key}`);
  for (const key of known) if (!nonEmpty(fields.get(key))) errors.push(`Apifox 资产审计缺 ${key}`);
  const environment = fields.get('environment') ?? '';
  if (environment && !ENVIRONMENT.test(environment)) errors.push(`Apifox 资产审计环境无效：${environment}`);
  const unresolved = Number(fields.get('unresolved-findings'));
  if (!Number.isInteger(unresolved) || unresolved < 0) errors.push('Apifox 资产审计 unresolved-findings 必须为非负整数');
  if (!assets.length) errors.push('Apifox 资产审计至少需要一个 asset');
  const identities = new Set<string>();
  for (const asset of assets) {
    const identity = `${asset.caseId}/${asset.type}`;
    if (identities.has(identity)) errors.push(`Apifox 资产审计 asset 重复：${identity}`);
    identities.add(identity);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    audit: {
      environment,
      planVersion: fields.get('plan-version')!,
      project: fields.get('project')!,
      branch: fields.get('branch')!,
      unresolvedFindings: unresolved,
      evidence: fields.get('evidence')!,
      assets,
    },
  };
}

function declaredEnvironment(block: MarkerBlock): string | undefined {
  const matches = [...block.body.matchAll(/^environment:[ \t]*(.*)$/gm)].map((match) => match[1]?.trim() ?? '');
  return matches.length === 1 && matches[0] ? matches[0] : undefined;
}

/** Selects the newest audit for one environment without falling back past malformed evidence. */
export function parseLatestApifoxAssetAudit(notes: { body: string }[] = [], environment: TestEnvironment): LatestApifoxAssetAudit {
  let latest: MarkerBlock | undefined;
  for (const note of notes) {
    for (const block of markerBlocks(note.body)) {
      const declared = declaredEnvironment(block);
      if (!declared || declared === environment) latest = block;
    }
  }
  if (!latest) return { kind: 'absent' };
  const parsed = parseBlock(latest);
  if (!parsed.ok) return { kind: 'invalid-latest', errors: parsed.errors };
  if (parsed.audit.environment !== environment) return { kind: 'invalid-latest', errors: [`最新 Apifox 资产审计环境不是 ${environment}`] };
  return { kind: 'valid', audit: parsed.audit };
}

/** Verifies that every planned asset has a current, read-back, unresolved-free audit record. */
export function validateApifoxAssetAudit(plan: TestPlan, environment: TestEnvironment, latest: LatestApifoxAssetAudit): ApifoxAssetAuditValidation {
  if (latest.kind === 'absent') return { ok: false, errors: [`${environment} Apifox 资产审计缺失`] };
  if (latest.kind === 'invalid-latest') return { ok: false, errors: [`${environment} 最新 Apifox 资产审计无效：${latest.errors.join('；')}`] };
  const audit = latest.audit;
  const errors: string[] = [];
  if (audit.planVersion !== plan.version) errors.push(`${environment} Apifox 资产审计计划版本不匹配：当前 ${plan.version}，记录 ${audit.planVersion}`);
  if (audit.unresolvedFindings !== 0) errors.push(`${environment} Apifox 资产审计仍有 ${audit.unresolvedFindings} 个未处置问题`);
  if (!nonEmpty(audit.evidence)) errors.push(`${environment} Apifox 资产审计缺回读证据`);
  const required = plan.cases.filter((item) => item.environments.includes(environment)).flatMap((item) => item.assets.map((type) => `${item.id}/${type}`));
  const actual = new Set(audit.assets.map((asset) => `${asset.caseId}/${asset.type}`));
  for (const key of required) if (!actual.has(key)) errors.push(`${environment} Apifox 资产审计缺计划资产：${key}`);
  const validCases = new Set(plan.cases.filter((item) => item.environments.includes(environment)).map((item) => item.id));
  const allowed = new Set(required);
  for (const asset of audit.assets) {
    const key = `${asset.caseId}/${asset.type}`;
    if (!validCases.has(asset.caseId)) errors.push(`${environment} Apifox 资产审计含未知 case：${asset.caseId}`);
    else if (!allowed.has(key)) errors.push(`${environment} Apifox 资产审计含未声明资产：${key}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Renders an immutable, readable audit comment. It is a preview only; Leader writes it after Apifox readback. */
export function renderApifoxAssetAudit(audit: ApifoxAssetAudit): string {
  const assets = [...audit.assets].sort((a, b) => `${a.caseId}/${a.type}`.localeCompare(`${b.caseId}/${b.type}`));
  return [
    '## Apifox 资产审计', '',
    `- 环境：${audit.environment}`,
    `- 计划版本：${audit.planVersion}`,
    `- 项目/分支：${audit.project} / ${audit.branch}`,
    `- 未处置问题：${audit.unresolvedFindings}`,
    `- 回读证据：${audit.evidence}`,
    '', MARKER,
    `environment: ${audit.environment}`,
    `plan-version: ${audit.planVersion}`,
    `project: ${audit.project}`,
    `branch: ${audit.branch}`,
    `unresolved-findings: ${audit.unresolvedFindings}`,
    `evidence: ${audit.evidence}`,
    ...assets.map((asset) => `asset: ${asset.caseId} | ${asset.type} | ${asset.id} | ${asset.action}`),
    '-->',
  ].join('\n');
}

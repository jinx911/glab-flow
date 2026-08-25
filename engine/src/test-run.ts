import type { ApifoxAssetType, LatestTestRun, TestEnvironment, TestMethod, TestPlan, TestPlanCase, TestRun, TestRunValidation } from './types.js';

const PLAN_MARKER = '<!-- glab-flow:test-plan:v1';
const RUN_MARKER = '<!-- glab-flow:test-run:v1';
const METHODS = new Set<TestMethod>(['api', 'e2e', 'data', 'manual']);
const ASSET_TYPES = new Set<ApifoxAssetType>(['scenario', 'suite-or-group', 'test-data', 'scenario-instance']);
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]*$/;

type MarkerBlock = { body: string; closed: boolean };

function markerBlocks(text: string, marker: string): MarkerBlock[] {
  const blocks: MarkerBlock[] = [];
  let offset = 0;
  while (true) {
    const start = text.indexOf(marker, offset);
    if (start < 0) return blocks;
    const bodyStart = start + marker.length;
    const end = text.indexOf('-->', bodyStart);
    if (end < 0) {
      blocks.push({ body: text.slice(bodyStart), closed: false });
      return blocks;
    }
    blocks.push({ body: text.slice(bodyStart, end), closed: true });
    offset = end + 3;
  }
}

function nonEmpty(value: string | undefined): value is string {
  return !!value?.trim();
}

function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function parsePlanCase(value: string): TestPlanCase | string {
  const parts = value.split('|').map((part) => part.trim());
  if (parts.length !== 3 || !ID.test(parts[0] ?? '')) return `case 格式无效：${value}`;
  const environments = splitList(parts[1] ?? '');
  const methods = splitList(parts[2] ?? '');
  if (!environments.length || environments.some((environment) => !ENVIRONMENT.test(environment))) {
    return `case ${parts[0]} 缺有效环境`;
  }
  if (!methods.length || methods.some((method) => !METHODS.has(method as TestMethod))) {
    return `case ${parts[0]} 缺有效方法`;
  }
  if (new Set(environments).size !== environments.length || new Set(methods).size !== methods.length) {
    return `case ${parts[0]} 含重复环境或方法`;
  }
  return { id: parts[0]!, environments, methods: methods as TestMethod[], assets: [], presentations: [], authProfiles: [] };
}

function parsePlanAsset(value: string): { caseId: string; type: ApifoxAssetType } | string {
  const parts = value.split('|').map((part) => part.trim());
  if (parts.length !== 2 || !ID.test(parts[0] ?? '') || !ASSET_TYPES.has(parts[1] as ApifoxAssetType)) return `asset 格式无效：${value}`;
  return { caseId: parts[0]!, type: parts[1] as ApifoxAssetType };
}

function parsePlanAuthProfile(value: string): { caseId: string; profile: string } | string {
  const parts = value.split('|').map((part) => part.trim());
  if (parts.length !== 2 || !ID.test(parts[0] ?? '') || !ID.test(parts[1] ?? '')) return `auth-profile 格式无效：${value}`;
  return { caseId: parts[0]!, profile: parts[1]! };
}

/** Parses the one strict machine manifest inside a human-readable test-plan.md. */
export function parseTestPlan(text: string | undefined): { ok: true; plan: TestPlan } | { ok: false; errors: string[] } {
  if (!text) return { ok: false, errors: ['测试计划缺失'] };
  const blocks = markerBlocks(text, PLAN_MARKER);
  if (blocks.length !== 1) return { ok: false, errors: ['测试计划必须且只能包含一个 glab-flow:test-plan:v1 标记'] };
  const block = blocks[0]!;
  if (!block.closed) return { ok: false, errors: ['测试计划标记未闭合'] };

  const errors: string[] = [];
  let version: string | undefined;
  const cases: TestPlanCase[] = [];
  const assets: { caseId: string; type: ApifoxAssetType }[] = [];
  const presentations: { caseId: string; type: ApifoxAssetType }[] = [];
  const authProfiles: { caseId: string; profile: string }[] = [];
  for (const rawLine of block.body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const field = line.match(/^([a-z-]+):[ \t]*(.+)$/);
    if (!field) { errors.push(`测试计划存在无效行：${line}`); continue; }
    const [, key, value] = field;
    if (key === 'plan-version') {
      if (version !== undefined) errors.push('测试计划 plan-version 重复');
      else version = value!.trim();
      continue;
    }
    if (key === 'case') {
      const parsed = parsePlanCase(value!);
      if (typeof parsed === 'string') errors.push(parsed);
      else cases.push(parsed);
      continue;
    }
    if (key === 'asset') {
      const parsed = parsePlanAsset(value!);
      if (typeof parsed === 'string') errors.push(parsed);
      else assets.push(parsed);
      continue;
    }
    if (key === 'presentation') {
      const parsed = parsePlanAsset(value!);
      if (typeof parsed === 'string') errors.push(parsed.replace('asset', 'presentation'));
      else presentations.push(parsed);
      continue;
    }
    if (key === 'auth-profile') {
      const parsed = parsePlanAuthProfile(value!);
      if (typeof parsed === 'string') errors.push(parsed);
      else authProfiles.push(parsed);
      continue;
    }
    errors.push(`测试计划含未知字段：${key}`);
  }
  if (!nonEmpty(version)) errors.push('测试计划缺 plan-version');
  if (!cases.length) errors.push('测试计划至少需要一个 case');
  if (new Set(cases.map((item) => item.id)).size !== cases.length) errors.push('测试计划 case ID 重复');
  const byId = new Map(cases.map((item) => [item.id, item]));
  const seenAssets = new Set<string>();
  for (const asset of assets) {
    const testCase = byId.get(asset.caseId);
    const key = `${asset.caseId}/${asset.type}`;
    if (!testCase) errors.push(`asset 引用了未知 case：${asset.caseId}`);
    else if (seenAssets.has(key)) errors.push(`asset 重复：${key}`);
    else testCase.assets.push(asset.type);
    seenAssets.add(key);
  }
  const seenPresentations = new Set<string>();
  for (const presentation of presentations) {
    const testCase = byId.get(presentation.caseId);
    const key = `${presentation.caseId}/${presentation.type}`;
    if (!testCase) errors.push(`presentation 引用了未知 case：${presentation.caseId}`);
    else if (seenPresentations.has(key)) errors.push(`presentation 重复：${key}`);
    else if (!testCase.assets.includes(presentation.type)) errors.push(`presentation 必须引用已声明资产：${key}`);
    else testCase.presentations.push(presentation.type);
    seenPresentations.add(key);
  }
  const seenAuthProfiles = new Set<string>();
  for (const authProfile of authProfiles) {
    const testCase = byId.get(authProfile.caseId);
    const key = `${authProfile.caseId}/${authProfile.profile}`;
    if (!testCase) errors.push(`auth-profile 引用了未知 case：${authProfile.caseId}`);
    else if (seenAuthProfiles.has(key)) errors.push(`auth-profile 重复：${key}`);
    else if (!testCase.assets.includes('scenario')) errors.push(`auth-profile 必须引用 scenario 资产：${authProfile.caseId}`);
    else testCase.authProfiles.push(authProfile.profile);
    seenAuthProfiles.add(key);
  }
  for (const testCase of cases) {
    if (testCase.methods.includes('api') && !testCase.assets.includes('scenario')) errors.push(`case ${testCase.id} 的 API 测试必须声明 scenario 资产`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, plan: { version: version!, cases } };
}

function parsePairs(value: string, separator: string, label: string): { ok: true; values: Record<string, string> } | { ok: false; errors: string[] } {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  for (const entry of splitList(value)) {
    const index = entry.indexOf(separator);
    const key = index < 0 ? '' : entry.slice(0, index).trim();
    const pairValue = index < 0 ? '' : entry.slice(index + separator.length).trim();
    if (!key || !pairValue) { errors.push(`${label} 格式无效：${entry}`); continue; }
    if (values[key] !== undefined) { errors.push(`${label} 含重复键：${key}`); continue; }
    values[key] = pairValue;
  }
  return errors.length ? { ok: false, errors } : { ok: true, values };
}

function parseRunBlock(block: MarkerBlock): { ok: true; run: TestRun } | { ok: false; errors: string[] } {
  if (!block.closed) return { ok: false, errors: ['测试执行记录标记未闭合'] };
  const fields = new Map<string, string>();
  const errors: string[] = [];
  for (const rawLine of block.body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const field = line.match(/^([a-z-]+):[ \t]*(.*)$/);
    if (!field) { errors.push(`测试执行记录存在无效行：${line}`); continue; }
    const [, key, value] = field;
    if (fields.has(key!)) { errors.push(`测试执行记录字段重复：${key}`); continue; }
    fields.set(key!, value!.trim());
  }
  const known = new Set(['environment', 'plan-version', 'version', 'outcome', 'asset-audit', 'cases', 'evidence']);
  for (const key of fields.keys()) if (!known.has(key)) errors.push(`测试执行记录含未知字段：${key}`);
  for (const key of known) if (!nonEmpty(fields.get(key))) errors.push(`测试执行记录缺 ${key}`);
  const environment = fields.get('environment') ?? '';
  if (environment && !ENVIRONMENT.test(environment)) errors.push(`测试执行记录环境无效：${environment}`);
  if (fields.get('outcome') && fields.get('outcome') !== 'passed') errors.push('测试执行记录 outcome 必须为 passed');

  const casePairs = parsePairs(fields.get('cases') ?? '', '=', 'cases');
  const evidencePairs = parsePairs(fields.get('evidence') ?? '', '=', 'evidence');
  if (!casePairs.ok) errors.push(...casePairs.errors);
  if (!evidencePairs.ok) errors.push(...evidencePairs.errors);
  const cases = casePairs.ok ? casePairs.values : {};
  const evidence = evidencePairs.ok ? evidencePairs.values : {};
  for (const [id, outcome] of Object.entries(cases)) {
    if (!ID.test(id)) errors.push(`cases 含无效 case ID：${id}`);
    if (outcome !== 'passed') errors.push(`case ${id} 结果必须为 passed`);
  }
  for (const method of Object.keys(evidence)) if (!METHODS.has(method as TestMethod)) errors.push(`evidence 含未知方法：${method}`);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    run: {
      environment,
      planVersion: fields.get('plan-version')!,
      version: fields.get('version')!,
      outcome: 'passed',
      assetAudit: fields.get('asset-audit')!,
      cases: cases as Record<string, 'passed'>,
      evidence: evidence as Partial<Record<TestMethod, string>>,
    },
  };
}

function declaredEnvironment(block: MarkerBlock): string | undefined {
  const matches = [...block.body.matchAll(/^environment:[ \t]*(.*)$/gm)].map((match) => match[1]?.trim() ?? '');
  return matches.length === 1 && matches[0] ? matches[0] : undefined;
}

/** Selects the newest execution marker for an environment. Notes must be in GitLab readback order. */
export function parseLatestTestRun(notes: { body: string }[] = [], environment: TestEnvironment): LatestTestRun {
  let latest: MarkerBlock | undefined;
  for (const note of notes) {
    for (const block of markerBlocks(note.body, RUN_MARKER)) {
      const declared = declaredEnvironment(block);
      if (!declared || declared === environment) latest = block;
    }
  }
  if (!latest) return { kind: 'absent' };
  const parsed = parseRunBlock(latest);
  if (!parsed.ok) return { kind: 'invalid-latest', errors: parsed.errors };
  if (parsed.run.environment !== environment) return { kind: 'invalid-latest', errors: [`最新测试执行记录环境不是 ${environment}`] };
  return { kind: 'valid', run: parsed.run };
}

/** Validates that a newest immutable run proves every required case in the current plan. */
export function validateTestRun(plan: TestPlan, environment: TestEnvironment, latest: LatestTestRun): TestRunValidation {
  if (latest.kind === 'absent') return { ok: false, errors: [`${environment} 测试执行记录缺失`] };
  if (latest.kind === 'invalid-latest') return { ok: false, errors: [`${environment} 最新测试执行记录无效：${latest.errors.join('；')}`] };
  const run = latest.run;
  const errors: string[] = [];
  if (run.planVersion !== plan.version) errors.push(`${environment} 测试计划版本不匹配：当前 ${plan.version}，记录 ${run.planVersion}`);
  if (run.assetAudit !== `${plan.version}/${environment}`) errors.push(`${environment} 测试执行记录未关联当前资产审计：应为 ${plan.version}/${environment}`);
  if (!nonEmpty(run.version)) errors.push(`${environment} 被测版本缺失`);
  const required = plan.cases.filter((item) => item.environments.includes(environment));
  if (!required.length) errors.push(`测试计划没有要求 ${environment} 执行的 case`);
  const requiredIds = new Set(required.map((item) => item.id));
  for (const id of requiredIds) if (run.cases[id] !== 'passed') errors.push(`${environment} 缺通过 case：${id}`);
  for (const id of Object.keys(run.cases)) if (!requiredIds.has(id)) errors.push(`${environment} 记录含非本环境计划 case：${id}`);
  const methods = new Set(required.flatMap((item) => item.methods));
  for (const method of methods) if (!nonEmpty(run.evidence[method])) errors.push(`${environment} 缺 ${method} 执行证据`);
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Renders an immutable, human-readable Issue comment plus its strict machine receipt. */
export function renderTestRun(run: TestRun): string {
  const cases = Object.entries(run.cases).sort(([a], [b]) => a.localeCompare(b)).map(([id, outcome]) => `${id}=${outcome}`).join(',');
  const evidence = Object.entries(run.evidence).sort(([a], [b]) => a.localeCompare(b)).map(([method, value]) => `${method}=${value}`).join(',');
  return [
    '## 测试执行记录', '',
    `- 环境：${run.environment}`,
    `- 计划版本：${run.planVersion}`,
    `- 被测版本：${run.version}`,
    `- 资产审计：${run.assetAudit}`,
    `- 结论：${run.outcome === 'passed' ? '通过' : '未通过'}`,
    `- 用例结果：${cases}`,
    `- 执行证据：${evidence}`,
    '',
    `${RUN_MARKER}`,
    `environment: ${run.environment}`,
    `plan-version: ${run.planVersion}`,
    `version: ${run.version}`,
    `outcome: ${run.outcome}`,
    `asset-audit: ${run.assetAudit}`,
    `cases: ${cases}`,
    `evidence: ${evidence}`,
    '-->',
  ].join('\n');
}

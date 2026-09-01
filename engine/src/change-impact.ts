import type {
  ChangeArtifact,
  ChangeCloseInput,
  ChangeImpact,
  ChangeImpactInput,
  ChangeScope,
  ChangeSource,
  GuardResult,
  IssueNote,
  WritePlan,
} from './types.js';
import { parseTestPlan } from './test-run.js';
import { chronologicalNotes } from './notes.js';
import { classifyChangeTier, isLightTier } from './tier.js';

const SCOPES = new Set<ChangeScope>(['frontend-copy', 'functional', 'api-contract', 'data-model', 'permission', 'frontend-route', 'schedule', 'release']);
const SOURCES = new Set<ChangeSource>(['requirement', 'technical-design', 'implementation', 'test']);
const ARTIFACTS = new Set<ChangeArtifact>(['proposal', 'design', 'test-plan', 'apifox-assets', 'implementation', 'local-rerun', 'test-rerun', 'week-plan', 'release-check']);
const DEVELOPMENT_SCOPES = new Set<ChangeScope>(['functional', 'api-contract', 'data-model', 'permission', 'frontend-route']);

const ok = (): GuardResult => ({ ok: true, missing: [], reasons: [] });
const fail = (reasons: string[], missing: string[] = []): GuardResult => ({ ok: false, missing, reasons });
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Story nodes at/after 测试中 must repeat test verification when a product-facing change occurs. */
function hasEnteredTest(type: ChangeImpactInput['type'], node: string): boolean {
  const story = ['测试中', '待发布', '生产验收中', '已完成'];
  const bug = ['测试中', '待发布', '生产验证中', '已完成'];
  return (type === 'story' ? story : bug).includes(node);
}

function returnTarget(input: ChangeImpactInput): string | undefined {
  if (input.source === 'requirement') return input.type === 'story' ? '待评审' : '已确认缺陷';
  if (input.source === 'technical-design') return input.type === 'story' ? '已评审' : '开发中';
  if (input.source === 'implementation' || input.source === 'test') return '开发中';
  return undefined;
}

/** Derives the complete minimum change set. Callers cannot omit downstream artifacts. */
export function deriveChangeImpact(input: ChangeImpactInput): ChangeImpact {
  const required: ChangeArtifact[] = [];
  const needsDevelopmentSync = input.scopes.some((scope) => DEVELOPMENT_SCOPES.has(scope));

  if (input.source === 'requirement') required.push('proposal');
  if (input.source === 'technical-design') required.push('design');
  if (input.source === 'implementation' || input.source === 'test') required.push('implementation');
  if (needsDevelopmentSync) {
    required.push('design', 'test-plan', 'apifox-assets', 'local-rerun');
    if (hasEnteredTest(input.type, input.currentNode)) required.push('test-rerun');
  }
  if (input.scopes.includes('schedule')) required.push('week-plan');
  if (input.scopes.includes('release')) required.push('release-check');

  const parsedPlan = input.testPlan === undefined ? undefined : parseTestPlan(input.testPlan);
  return {
    iid: input.iid,
    changeId: input.changeId,
    source: input.source,
    currentNode: input.currentNode,
    scopes: unique(input.scopes),
    requiredArtifacts: unique(required),
    ...(returnTarget(input) ? { returnTarget: returnTarget(input) } : {}),
    ...(parsedPlan?.ok ? { previousPlanVersion: parsedPlan.plan.version } : {}),
  };
}

export function validateChangeImpactInput(input: unknown): GuardResult {
  if (!input || typeof input !== 'object') return fail(['变更影响输入必须是对象'], ['iid', 'type', 'currentNode', 'changeId', 'proposer', 'changeDate', 'source', 'reason', 'scopes']);
  const value = input as Partial<ChangeImpactInput>;
  const missing: string[] = [];
  if (!Number.isInteger(value.iid) || value.iid! <= 0) missing.push('iid');
  for (const field of ['currentNode', 'changeId', 'proposer', 'changeDate', 'reason'] as const) if (!nonEmpty(value[field])) missing.push(field);
  if (value.type !== 'story' && value.type !== 'bug') missing.push('type');
  if (!SOURCES.has(value.source as ChangeSource)) missing.push('source');
  if (!Array.isArray(value.scopes) || value.scopes.length === 0 || value.scopes.some((scope) => !SCOPES.has(scope))) missing.push('scopes');
  const reasons: string[] = [];
  if (value.testPlan !== undefined && !parseTestPlan(value.testPlan).ok) reasons.push('变更前 testPlan 无效；请传入当前完整 test-plan.md，或在尚未建立计划时省略该字段');
  return missing.length || reasons.length ? fail(reasons, missing) : ok();
}

export function renderChangeImpact(impact: ChangeImpact, input: Pick<ChangeImpactInput, 'proposer' | 'changeDate' | 'reason'>): string {
  const requires = impact.requiredArtifacts.join(',');
  return [
    '<!-- glab-flow:change-impact:v1',
    `change-id: ${impact.changeId}`,
    'status: open',
    `source: ${impact.source}`,
    `current-node: ${impact.currentNode}`,
    `scopes: ${impact.scopes.join(',')}`,
    `requires: ${requires}`,
    `return-target: ${impact.returnTarget ?? '保持当前节点'}`,
    `previous-plan-version: ${impact.previousPlanVersion ?? 'none'}`,
    '-->',
    '',
    '## 变更影响单',
    '',
    `- 变更编号：${impact.changeId}`,
    `- 提出人：${input.proposer}`,
    `- 提出日期：${input.changeDate}`,
    `- 变更来源：${impact.source}`,
    `- 变更原因：${input.reason}`,
    `- 影响维度：${impact.scopes.join('、')}`,
    `- 必须闭环：${impact.requiredArtifacts.join('、') || '仅记录，无下游产物'}`,
    `- 建议回退：${impact.returnTarget ?? '保持当前节点'}`,
    '',
    '### 闭环规则',
    '',
    '- 先按本单更新全部受影响产物；需要回退时用 plan-return，禁止直接改标签。',
    '- 测试计划受影响时必须递增 plan-version；旧环境测试证据随即失效。',
    '- 本单未关闭前，任何正向状态流转都会被阻断。',
  ].join('\n');
}

export function buildChangeImpactPlan(input: ChangeImpactInput): { impact: ChangeImpact; plan: WritePlan } {
  const impact = deriveChangeImpact(input);
  return {
    impact,
    plan: { issueIid: input.iid, ops: [{ kind: 'add_comment', body: renderChangeImpact(impact, input) }] },
  };
}

interface ChangeMarker {
  changeId: string;
  status: 'open' | 'closed';
  scopes: ChangeScope[];
  requiredArtifacts: ChangeArtifact[];
  previousPlanVersion?: string;
  index: number;
}

function markerFields(raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const match = line.match(/^([a-z-]+):\s*(.*)$/);
    if (match) fields.set(match[1]!, match[2]!.trim());
  }
  return fields;
}

/** Parses all immutable markers in chronological Issue notes; malformed marker blocks are explicit errors. */
function parseMarkers(notes: IssueNote[]): { markers: ChangeMarker[]; errors: string[] } {
  const markers: ChangeMarker[] = [];
  const errors: string[] = [];
  let index = 0;
  for (const note of chronologicalNotes(notes)) {
    const blocks = note.body.matchAll(/<!--\s*glab-flow:change-impact:v1\r?\n([\s\S]*?)-->/g);
    for (const block of blocks) {
      const fields = markerFields(block[1] ?? '');
      const changeId = fields.get('change-id');
      const status = fields.get('status');
      if (!changeId || (status !== 'open' && status !== 'closed')) {
        errors.push('检测到格式无效的 glab-flow:change-impact:v1 回执；请补发一条有效 open/closed 回执后再推进');
        continue;
      }
      const required = status === 'open' ? (fields.get('requires') ?? '').split(',').map((v) => v.trim()).filter(Boolean) : [];
      if (status === 'open' && required.some((artifact) => !ARTIFACTS.has(artifact as ChangeArtifact))) {
        errors.push(`变更单 ${changeId} 含未知 requires 项，不能安全推进`);
        continue;
      }
      // open 回执必须携带合法 scopes 行——关闭定级要靠它重推导，缺失/非法即无法收口。
      const scopes = status === 'open' ? (fields.get('scopes') ?? '').split(',').map((v) => v.trim()).filter(Boolean) : [];
      if (status === 'open' && (scopes.length === 0 || scopes.some((scope) => !SCOPES.has(scope as ChangeScope)))) {
        errors.push(`变更单 ${changeId} 的 open 回执缺少合法 scopes 声明，无法推导关闭定级`);
        continue;
      }
      markers.push({
        changeId,
        status,
        scopes: scopes as ChangeScope[],
        requiredArtifacts: required as ChangeArtifact[],
        ...(fields.get('previous-plan-version') && fields.get('previous-plan-version') !== 'none' ? { previousPlanVersion: fields.get('previous-plan-version') } : {}),
        index: index++,
      });
    }
  }
  return { markers, errors };
}

export function openChangeImpacts(notes: IssueNote[]): { open: ChangeMarker[]; errors: string[] } {
  const { markers, errors } = parseMarkers(notes);
  const latest = new Map<string, ChangeMarker>();
  for (const marker of markers) latest.set(marker.changeId, marker);
  return { open: [...latest.values()].filter((marker) => marker.status === 'open'), errors };
}

/** G16: no normal state transition may bypass an unclosed change impact receipt. */
export function validateChangeImpactClosure(notes: IssueNote[] = []): GuardResult {
  const { open, errors } = openChangeImpacts(notes);
  const reasons = [...errors];
  if (open.length) reasons.push(`存在未闭环变更影响单：${open.map((item) => item.changeId).join('、')}。先完成受影响产物、必要回退与环境重测，再执行 change-close 并回读评论`);
  return reasons.length ? fail(reasons, open.map((item) => `changeImpact:${item.changeId}`)) : ok();
}

function parseVersionOrdinal(version: string): number | undefined {
  const match = version.trim().match(/^v(\d+)$/i);
  return match ? Number(match[1]) : undefined;
}

export function validateChangeClose(input: unknown): GuardResult {
  if (!input || typeof input !== 'object') return fail(['变更闭环输入必须是对象'], ['iid', 'changeId', 'closer', 'closeDate', 'notes', 'completed']);
  const value = input as Partial<ChangeCloseInput>;
  const missing: string[] = [];
  if (!Number.isInteger(value.iid) || value.iid! <= 0) missing.push('iid');
  for (const field of ['changeId', 'closer', 'closeDate'] as const) if (!nonEmpty(value[field])) missing.push(field);
  if (!Array.isArray(value.notes)) missing.push('notes');
  if (!value.completed || typeof value.completed !== 'object') missing.push('completed');
  if (missing.length) return fail([], missing);

  const { open, errors } = openChangeImpacts(value.notes!);
  const target = open.find((item) => item.changeId === value.changeId);
  if (!target) return fail([...errors, `找不到仍处于 open 的变更影响单 ${value.changeId}；只可关闭已回读的 open 回执`], [`changeImpact:${value.changeId}`]);
  const incomplete = target.requiredArtifacts.filter((artifact) => !nonEmpty(value.completed?.[artifact]));
  if (incomplete.length) return fail([...errors, `变更单 ${value.changeId} 尚未提供完成证据：${incomplete.join('、')}`], incomplete);

  // 定级以 open 回执里冻结的 scopes 重推导为准（回读事实优先）；客户端 tier 仅交叉核对。
  // 放在 test-plan 分支之外：tier 若获得块外效果，谎报不得因无 test-plan 要求而免检。
  const derivedTier = classifyChangeTier(target.scopes);
  if (value.tier !== undefined && value.tier !== derivedTier) {
    return fail(
      [`close tier 与 open 单 scopes 推导不符：open 单 ${value.changeId} 按 scopes（${target.scopes.join('、')}）推导为 ${derivedTier}，收到 ${value.tier}`],
      ['tier'],
    );
  }
  if (target.requiredArtifacts.includes('test-plan')) {
    const parsed = parseTestPlan(value.testPlan);
    if (!parsed.ok) return fail([`变更单 ${value.changeId} 要求更新测试计划：${parsed.errors.join('；')}`], ['testPlan']);
    // 轻量关闭（spec §4.3）：T1/T2 无测试计划深度要求，跳过版本严格递增；未传 tier 按推导档执行。
    if (!isLightTier(derivedTier) && target.previousPlanVersion) {
      const before = parseVersionOrdinal(target.previousPlanVersion);
      const after = parseVersionOrdinal(parsed.plan.version);
      if (before === undefined || after === undefined || after <= before) {
        return fail([`测试计划版本必须高于变更前 ${target.previousPlanVersion}，实际为 ${parsed.plan.version}`], ['testPlan']);
      }
    }
  }
  return errors.length ? fail(errors) : ok();
}

export function buildChangeClosePlan(input: ChangeCloseInput): WritePlan {
  const { open } = openChangeImpacts(input.notes);
  const target = open.find((item) => item.changeId === input.changeId);
  if (!target) throw new Error(`change-close: open change ${input.changeId} not found`);
  const parsed = input.testPlan === undefined ? undefined : parseTestPlan(input.testPlan);
  const completed = target.requiredArtifacts.map((artifact) => `${artifact}=${input.completed[artifact]!.trim()}`).join('; ');
  const body = [
    '<!-- glab-flow:change-impact:v1',
    `change-id: ${input.changeId}`,
    'status: closed',
    `completed: ${completed}`,
    `test-plan-version: ${parsed?.ok ? parsed.plan.version : 'unchanged'}`,
    '-->',
    '',
    '## 变更闭环完成',
    '',
    `- 变更编号：${input.changeId}`,
    `- 关闭人：${input.closer}`,
    `- 关闭日期：${input.closeDate}`,
    `- 已完成证据：${completed}`,
    '- 结论：受影响产物已同步；后续状态流转仍按当前测试计划与环境门禁重新校验。',
  ].join('\n');
  return { issueIid: input.iid, ops: [{ kind: 'add_comment', body }] };
}

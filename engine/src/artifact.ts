import type { ArtifactKind, ArtifactManifest, ArtifactReceipt, ArtifactReceiptMetadata, ArtifactRequirement, ArtifactTarget, DataEvidenceProfile, MissingItem, ReceiptNote } from './types.js';

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'proposal', 'design', 'data-evidence', 'deployment-evidence', 'test-plan', 'mr-review', 'release-plan',
]);

export interface ArtifactValidationOptions {
  dataEvidenceProfile?: DataEvidenceProfile;
  jenkinsActive?: boolean;
  artifactManifest?: ArtifactManifest;
  /** 配置仓库全集(来自 config.repos);声明后启用 MR 覆盖性校验。 */
  repos?: string[];
  /** 明确无 MR 的仓库;与 mergeRequests 一起须覆盖 repos 全集。 */
  reposWithoutMr?: string[];
}

export interface ArtifactValidationResult {
  receipts: ArtifactReceipt[];
  missing: MissingItem[];
}

/** 回执解析失败记录:kind 合法但 metadata 不达标,或基础字段缺失。供 transition 融入 missing hint,避免静默丢弃(③)。 */
export interface ArtifactRejection {
  kind: ArtifactKind | 'unknown';
  noteId: string;
  reason: string;
}

export interface ArtifactParseResult {
  receipts: ArtifactReceipt[];
  rejections: ArtifactRejection[];
}

export type MergeRequestTarget = { projectPath: string; iid: number };

const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const GITLAB_NOTE_ID = /^\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;

function observedAtTimestamp(observedAt: string): number | undefined {
  if (!ISO_UTC_INSTANT.test(observedAt)) return undefined;
  const timestamp = Date.parse(observedAt);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function receiptMetadata(kind: ArtifactKind, fields: Map<string, string>): ArtifactReceiptMetadata | null | undefined {
  if (kind === 'deployment-evidence') {
    const mode = fields.get('mode');
    const environment = fields.get('environment');
    const verification = fields.get('verification');
    if (mode === 'automation') {
      const capability = fields.get('capability');
      const job = fields.get('job');
      const branch = fields.get('branch');
      const build = fields.get('build');
      const version = fields.get('version');
      if (!capability || !job || !branch || !environment || !build || !version || !verification) return null;
      return { mode, capability, job, branch, environment, build, version, verification };
    }
    if (mode === 'manual') {
      const unavailableReason = fields.get('unavailable-reason');
      const operator = fields.get('operator');
      const deployedVersion = fields.get('deployed-version');
      const performedAt = fields.get('performed-at');
      if (!unavailableReason || !operator || !deployedVersion || !environment || !verification || !performedAt || observedAtTimestamp(performedAt) === undefined) return null;
      return { mode, unavailableReason, operator, deployedVersion, environment, verification, performedAt };
    }
    return null;
  }
  if (kind === 'mr-review') {
    const outcome = fields.get('outcome');
    const method = fields.get('method');
    const highFindings = fields.get('high-findings');
    if (outcome !== 'passed' || (method !== 'mr-review-lite' && method !== 'code-review') || highFindings !== 'none') return null;
    return { outcome, method, highFindings };
  }
  return undefined;
}

function metadataRejectionReason(kind: ArtifactKind): string {
  if (kind === 'mr-review') return 'mr-review 回执未达标(outcome 须 passed、method 须 mr-review-lite|code-review、high-findings 须 none)';
  if (kind === 'deployment-evidence') return 'deployment-evidence 回执缺字段或 performed-at 非 UTC Z(automation 需 capability/job/branch/environment/build/version/verification;manual 需 unavailable-reason/operator/deployed-version/environment/verification/performed-at)';
  return 'metadata 无效';
}

/** Parses exact v1 receipt comment markers from Leader-provided readback notes.
 *  metadata 不达标的回执(kind 合法但 outcome/high-findings/字段不全)进 rejections 而非被静默丢弃(③)。 */
export function parseArtifactReceipts(notes: ReceiptNote[], target: ArtifactTarget): ArtifactParseResult {
  const receipts: ArtifactReceipt[] = [];
  const rejections: ArtifactRejection[] = [];
  const marker = /<!-- glab-flow:artifact-receipt:v1\r?\n([\s\S]*?)-->/g;

  for (const note of notes) {
    if (observedAtTimestamp(note.observedAt) === undefined || !GITLAB_NOTE_ID.test(note.id)) continue;
    for (const match of note.body.matchAll(marker)) {
      const fields = new Map<string, string>();
      const content = match[1];
      if (!content) continue;
      for (const line of content.split(/\r?\n/)) {
        const field = line.match(/^([a-z0-9-]+):\s*(.+?)\s*$/);
        const key = field?.[1];
        const value = field?.[2];
        if (key && value) fields.set(key, value);
      }
      const kind = fields.get('kind');
      const source = fields.get('source')?.trim();
      const sha256 = fields.get('sha256')?.trim();
      const knownKind = kind && ARTIFACT_KINDS.has(kind as ArtifactKind);
      if (!kind || !knownKind || !source || !sha256 || !SHA256.test(sha256)) {
        rejections.push({ kind: (knownKind ? kind : 'unknown') as ArtifactKind | 'unknown', noteId: note.id, reason: '回执缺基础字段或 kind/sha256 非法(kind/source/sha256 必填,sha256 须 64 位小写 hex)' });
        continue;
      }
      const metadata = receiptMetadata(kind as ArtifactKind, fields);
      if (metadata === null) {
        rejections.push({ kind: kind as ArtifactKind, noteId: note.id, reason: metadataRejectionReason(kind as ArtifactKind) });
        continue;
      }

      receipts.push({
        kind: kind as ArtifactKind,
        target,
        source,
        sha256,
        noteId: note.id,
        ...(note.url ? { noteUrl: note.url } : {}),
        observedAt: note.observedAt,
        ...(metadata ? { metadata } : {}),
      });
    }
  }
  return { receipts, rejections };
}

function targetKey(target: ArtifactTarget): string {
  return target.kind === 'issue' ? 'issue' : `mr:${target.projectPath}!${target.iid}`;
}

function receiptKey(receipt: ArtifactReceipt): string {
  return `${receipt.kind}:${targetKey(receipt.target)}`;
}

function isLater(receipt: ArtifactReceipt, previous: ArtifactReceipt): boolean {
  const observedAt = observedAtTimestamp(receipt.observedAt)!;
  const previousObservedAt = observedAtTimestamp(previous.observedAt)!;
  return observedAt > previousObservedAt || (observedAt === previousObservedAt && BigInt(receipt.noteId) > BigInt(previous.noteId));
}

function isActive(requirement: ArtifactRequirement, options: ArtifactValidationOptions): boolean {
  if (requirement.when === 'data-backed') return options.dataEvidenceProfile === 'data-backed';
  if (requirement.when === 'jenkins') return !!options.jenkinsActive;
  return true;
}

function missingIssue(kind: ArtifactKind): MissingItem {
  return { field: kind, hint: `在 Issue 评论追加 ${kind} 回执标记，并回读 Issue 确认回执` };
}

function missingMr(kind: ArtifactKind, target: MergeRequestTarget): MissingItem {
  const ref = `${target.projectPath}!${target.iid}`;
  return { field: `${kind}:${ref}`, hint: `在 MR ${ref} 评论追加 ${kind} 回执标记，并回读该 MR 确认回执` };
}

function missingManifest(kind: ArtifactKind, receipt?: ArtifactReceipt): MissingItem {
  const mismatch = receipt
    ? `当前回执 source=${receipt.source}、sha256=${receipt.sha256} 与本地产物不一致`
    : '未提供可验证的回执';
  return {
    field: `artifactManifest.${kind}`,
    hint: `Leader 计算当前 ${kind} 的 source 与 SHA-256 后写入 artifactContext.artifactManifest.${kind}；${mismatch}`,
  };
}

function matchesManifest(receipt: ArtifactReceipt, manifest: ArtifactManifest, kind: ArtifactKind): boolean {
  const expected = manifest[kind];
  return expected !== undefined && receipt.source === expected.source && receipt.sha256 === expected.sha256;
}

/** Resolves active requirements against only caller-provided, already-read-back receipts.
 *  rejections(来自 parseArtifactReceipts)用于在 missing hint 里点明「已发回执但无效」,避免静默丢弃(③)。 */
export function validateArtifactRequirements(
  requirements: ArtifactRequirement[],
  receipts: ArtifactReceipt[],
  mergeRequests: MergeRequestTarget[],
  options: ArtifactValidationOptions = {},
  rejections: ArtifactRejection[] = [],
): ArtifactValidationResult {
  const latest = new Map<string, ArtifactReceipt>();
  for (const receipt of receipts) {
    if (observedAtTimestamp(receipt.observedAt) === undefined || !GITLAB_NOTE_ID.test(receipt.noteId)) continue;
    const key = receiptKey(receipt);
    const previous = latest.get(key);
    if (!previous || isLater(receipt, previous)) latest.set(key, receipt);
  }

  // kind → 无效回执原因(已发但 metadata 不达标),用于增强 missing hint
  const rejectionByKind = new Map<ArtifactKind, string>();
  for (const rejection of rejections) if (rejection.kind !== 'unknown') rejectionByKind.set(rejection.kind, rejection.reason);
  const withRejection = (item: MissingItem): MissingItem => {
    const kind = item.field.split(':')[0] as ArtifactKind;
    const reason = rejectionByKind.get(kind);
    return reason ? { ...item, hint: `${item.hint}(已发回执但无效:${reason})` } : item;
  };

  const verified = new Map<string, ArtifactReceipt>();
  const missing: MissingItem[] = [];
  for (const requirement of requirements.filter((item) => isActive(item, options))) {
    if (requirement.target === 'issue') {
      const key = `${requirement.kind}:issue`;
      const receipt = latest.get(key);
      if (!options.artifactManifest?.[requirement.kind] || (receipt && !matchesManifest(receipt, options.artifactManifest, requirement.kind))) {
        missing.push(missingManifest(requirement.kind, receipt));
      }
      if (receipt && matchesManifest(receipt, options.artifactManifest ?? {}, requirement.kind)) verified.set(key, receipt);
      else if (!receipt) missing.push(withRejection(missingIssue(requirement.kind)));
      continue;
    }

    for (const mergeRequest of mergeRequests) {
      const key = `${requirement.kind}:mr:${mergeRequest.projectPath}!${mergeRequest.iid}`;
      const receipt = latest.get(key);
      if (!options.artifactManifest?.[requirement.kind] || (receipt && !matchesManifest(receipt, options.artifactManifest, requirement.kind))) {
        missing.push(missingManifest(requirement.kind, receipt));
      }
      if (receipt && matchesManifest(receipt, options.artifactManifest ?? {}, requirement.kind)) verified.set(key, receipt);
      else if (!receipt) missing.push(withRejection(missingMr(requirement.kind, mergeRequest)));
    }
    if (mergeRequests.length === 0) {
      missing.push(withRejection({ field: requirement.kind, hint: `提供需评审的 MR 目标；在每个 MR 评论追加 ${requirement.kind} 回执标记并回读确认` }));
    }
  }

  // MR 覆盖性:声明了配置仓库全集(options.repos)时,每个 repo 须显式表态(在 mergeRequests 或 reposWithoutMr),
  // 防 Leader 漏发现一个仓的 MR 导致 G14 漏评(未评审代码进 master)。
  const needsMrCoverage = requirements.some((r) => r.kind === 'mr-review' && r.target === 'each-mr' && isActive(r, options));
  if (needsMrCoverage && options.repos && options.repos.length > 0) {
    const withMr = new Set(mergeRequests.map((m) => m.projectPath));
    const withoutMr = new Set(options.reposWithoutMr ?? []);
    for (const repo of options.repos) {
      if (!withMr.has(repo) && !withoutMr.has(repo)) {
        missing.push({ field: `mrCoverage:${repo}`, hint: `仓库 ${repo} 的 MR 处置未声明:查 GitLab 后,若本需求改了它则放入 mergeRequests(附 mr-review 回执),若没改则放入 reposWithoutMr 显式声明` });
      }
    }
  }

  return { receipts: [...verified.values()], missing };
}

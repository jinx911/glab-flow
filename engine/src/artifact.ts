import type { ArtifactKind, ArtifactReceipt, ArtifactReceiptMetadata, ArtifactRequirement, ArtifactTarget, MissingItem, ReceiptNote } from './types.js';

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'proposal', 'design', 'data-evidence', 'deployment-evidence', 'test-plan', 'mr-review', 'release-plan',
]);

export interface ArtifactValidationOptions {
  dataEvidenceProfile?: 'standard' | 'data-backed';
  jenkinsActive?: boolean;
}

export interface ArtifactValidationResult {
  receipts: ArtifactReceipt[];
  missing: MissingItem[];
}

export type MergeRequestTarget = { projectPath: string; iid: number };

const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const GITLAB_NOTE_ID = /^\d+$/;

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

/** Parses exact v1 receipt comment markers from Leader-provided readback notes. */
export function parseArtifactReceipts(notes: ReceiptNote[], target: ArtifactTarget): ArtifactReceipt[] {
  const receipts: ArtifactReceipt[] = [];
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
      if (!kind || !ARTIFACT_KINDS.has(kind as ArtifactKind) || !source || !sha256) continue;
      const metadata = receiptMetadata(kind as ArtifactKind, fields);
      if (metadata === null) continue;

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
  return receipts;
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

/** Resolves active requirements against only caller-provided, already-read-back receipts. */
export function validateArtifactRequirements(
  requirements: ArtifactRequirement[],
  receipts: ArtifactReceipt[],
  mergeRequests: MergeRequestTarget[],
  options: ArtifactValidationOptions = {},
): ArtifactValidationResult {
  const latest = new Map<string, ArtifactReceipt>();
  for (const receipt of receipts) {
    if (observedAtTimestamp(receipt.observedAt) === undefined || !GITLAB_NOTE_ID.test(receipt.noteId)) continue;
    const key = receiptKey(receipt);
    const previous = latest.get(key);
    if (!previous || isLater(receipt, previous)) latest.set(key, receipt);
  }

  const verified = new Map<string, ArtifactReceipt>();
  const missing: MissingItem[] = [];
  for (const requirement of requirements.filter((item) => isActive(item, options))) {
    if (requirement.target === 'issue') {
      const key = `${requirement.kind}:issue`;
      const receipt = latest.get(key);
      if (receipt) verified.set(key, receipt);
      else missing.push(missingIssue(requirement.kind));
      continue;
    }

    for (const mergeRequest of mergeRequests) {
      const key = `${requirement.kind}:mr:${mergeRequest.projectPath}!${mergeRequest.iid}`;
      const receipt = latest.get(key);
      if (receipt) verified.set(key, receipt);
      else missing.push(missingMr(requirement.kind, mergeRequest));
    }
    if (mergeRequests.length === 0) {
      missing.push({ field: requirement.kind, hint: `提供需评审的 MR 目标；在每个 MR 评论追加 ${requirement.kind} 回执标记并回读确认` });
    }
  }

  return { receipts: [...verified.values()], missing };
}

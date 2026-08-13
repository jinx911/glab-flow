import { describe, expect, it } from 'vitest';
import { parseArtifactReceipts, validateArtifactRequirements } from './artifact.js';
import type { ArtifactTarget, ReceiptNote } from './types.js';

const SHA256 = 'a'.repeat(64);

function evidenceLines(kind: string): string[] {
  if (kind === 'deployment-evidence') return ['mode: automation', 'capability: jenkins-deploy', 'job: oa-service', 'branch: feature/42', 'environment: test', 'build: 123', 'version: test-v1', 'verification: smoke-pass'];
  if (kind === 'mr-review') return ['outcome: passed', 'method: mr-review-lite', 'high-findings: none'];
  return [];
}

const receipt = (kind = 'design', evidence = evidenceLines(kind)) => ({
  id: '99', observedAt: '2026-08-12T10:00:00Z',
  body: `<!-- glab-flow:artifact-receipt:v1
kind: ${kind}
source: .glab-flow/42/spec/${kind}.md
sha256: ${SHA256}
${evidence.join('\n')}
-->`,
});

const issueTarget = { kind: 'issue', projectId: '3915', iid: 42 } as const;
const manifestFor = (...kinds: string[]) => Object.fromEntries(kinds.map((kind) => [kind, {
  source: `.glab-flow/42/spec/${kind}.md`, sha256: SHA256,
}]));

/** 仅取成功回执(便于多数断言)。 */
const parsed = (notes: ReceiptNote[], target: ArtifactTarget) => parseArtifactReceipts(notes, target).receipts;

describe('artifact receipts', () => {
  it('rejects a receipt whose SHA-256 is not 64 lowercase hexadecimal characters', () => {
    expect(parsed([{
      ...receipt(),
      body: receipt().body.replace(SHA256, 'abc123'),
    }], issueTarget)).toEqual([]);
  });

  it('parses a complete versioned receipt marker', () => {
    expect(parsed([receipt()], issueTarget)).toMatchObject([
      { kind: 'design', target: issueTarget, noteId: '99', sha256: SHA256 },
    ]);
  });

  it('rejects markers missing source or sha256', () => {
    expect(parsed([
      { id: '1', observedAt: '2026-08-12T10:00:00Z', body: '<!-- glab-flow:artifact-receipt:v1\nkind: design\n-->' },
    ], issueTarget)).toEqual([]);
  });

  it('rejects a marker with an unsupported version header', () => {
    expect(parsed([{
      ...receipt(), body: `<!-- glab-flow:artifact-receipt:v2
kind: design
source: .glab-flow/42/spec/design.md
sha256: ${SHA256}
-->`,
    }], issueTarget)).toEqual([]);
  });

  it('rejects a marker with an unsupported kind', () => {
    expect(parsed([receipt('unrecognized-artifact')], issueTarget)).toEqual([]);
  });

  it('rejects deployment evidence that misses automation or manual contract fields', () => {
    expect(parsed([receipt('deployment-evidence', ['mode: automation', 'capability: jenkins-deploy', 'job: oa-service', 'branch: feature/42', 'environment: test', 'build: 123', 'version: test-v1'])], issueTarget)).toEqual([]);
    expect(parsed([receipt('deployment-evidence', ['mode: manual', 'unavailable-reason: no job', 'operator: @dev', 'deployed-version: v1', 'environment: production'])], issueTarget)).toEqual([]);
    expect(parsed([receipt('deployment-evidence', ['mode: manual', 'unavailable-reason: no job', 'operator: @dev', 'deployed-version: v1', 'environment: production', 'verification: smoke-pass'])], issueTarget)).toEqual([]);
    // performed-at 必须是有效 UTC(Z 或 ±HH:MM);无时区指示则拒
    expect(parsed([receipt('deployment-evidence', ['mode: manual', 'unavailable-reason: no job', 'operator: @dev', 'deployed-version: v1', 'environment: production', 'verification: smoke-pass', 'performed-at: 2026-08-12T10:00:00'])], issueTarget)).toEqual([]);
  });

  it('rejects MR review evidence with a failed outcome or incomplete strict fields', () => {
    const target = { kind: 'mr', projectPath: 'group/api', iid: 1 } as const;
    expect(parsed([receipt('mr-review', ['outcome: failed', 'method: mr-review-lite', 'high-findings: none'])], target)).toEqual([]);
    expect(parsed([receipt('mr-review', ['outcome: passed', 'method: full-diff', 'high-findings: none'])], target)).toEqual([]);
    expect(parsed([receipt('mr-review', ['outcome: passed', 'method: code-review'])], target)).toEqual([]);
  });

  it('rejects a receipt with an invalid observed timestamp', () => {
    expect(parsed([{ ...receipt(), observedAt: 'not-a-timestamp' }], issueTarget)).toEqual([]);
    // 无时区指示无效;Z 与 ±HH:MM 偏移均有效(见下)
    expect(parsed([{ ...receipt(), observedAt: '2026-08-12T10:00:00' }], issueTarget)).toEqual([]);
  });

  it('accepts observed timestamps with Z or explicit UTC offset (④)', () => {
    expect(parsed([{ ...receipt(), observedAt: '2026-08-12T10:00:00Z' }], issueTarget)).toHaveLength(1);
    expect(parsed([{ ...receipt(), observedAt: '2026-08-12T10:00:00+00:00' }], issueTarget)).toHaveLength(1);
    expect(parsed([{ ...receipt(), observedAt: '2026-08-12T10:00:00.123+00:00' }], issueTarget)).toHaveLength(1);
  });

  it('rejects opaque note IDs and parses a complete manual deployment contract', () => {
    expect(parsed([{ ...receipt(), id: 'note-99' }], issueTarget)).toEqual([]);
    expect(parsed([receipt('deployment-evidence', [
      'mode: manual', 'unavailable-reason: no Jenkins job', 'operator: @dev', 'deployed-version: v1', 'environment: production', 'verification: smoke-pass', 'performed-at: 2026-08-12T09:30:00Z',
    ])], issueTarget)).toMatchObject([{
      metadata: { mode: 'manual', deployedVersion: 'v1', verification: 'smoke-pass', performedAt: '2026-08-12T09:30:00Z' },
    }]);
  });

  it('collects rejected receipts with reasons instead of dropping silently (③)', () => {
    const mr = parseArtifactReceipts([receipt('mr-review', ['outcome: failed', 'method: mr-review-lite', 'high-findings: 1'])], { kind: 'mr', projectPath: 'g/a', iid: 1 } as const);
    expect(mr.receipts).toEqual([]);
    expect(mr.rejections).toMatchObject([{ kind: 'mr-review', reason: expect.stringMatching(/mr-review 回执未达标/) }]);
    const badSha = parseArtifactReceipts([{ ...receipt(), body: receipt().body.replace(SHA256, 'abc') }], issueTarget);
    expect(badSha.rejections).toMatchObject([{ kind: 'design', reason: expect.stringMatching(/基础字段/) }]);
  });

  it('surfaces rejection reason in missing hint when a required artifact has an invalid receipt (③)', () => {
    const mr = parseArtifactReceipts([receipt('mr-review', ['outcome: failed', 'method: mr-review-lite', 'high-findings: 1'])], { kind: 'mr', projectPath: 'g/a', iid: 1 } as const);
    const result = validateArtifactRequirements(
      [{ kind: 'mr-review', target: 'each-mr' }],
      mr.receipts,
      [{ projectPath: 'g/a', iid: 1 }],
      { artifactManifest: manifestFor('mr-review') },
      mr.rejections,
    );
    const hint = result.missing.find((m) => m.field.startsWith('mr-review'))?.hint ?? '';
    expect(hint).toMatch(/已发回执但无效:.*mr-review 回执未达标/);
  });

  it('requires an mr-review receipt for every supplied MR target', () => {
    const result = validateArtifactRequirements(
      [{ kind: 'mr-review', target: 'each-mr' }],
      [],
      [{ projectPath: 'group/a', iid: 1 }, { projectPath: 'group/b', iid: 2 }],
      { artifactManifest: manifestFor('mr-review') },
    );
    expect(result.missing.map((x) => x.field)).toEqual(['mr-review:group/a!1', 'mr-review:group/b!2']);
  });

  it('uses only the latest receipt for each target and kind', () => {
    const target = issueTarget;
    const result = validateArtifactRequirements(
      [{ kind: 'design', target: 'issue' }],
      [
        ...parsed([{ ...receipt(), id: '9', observedAt: '2026-08-12T09:00:00Z' }], target),
        ...parsed([{ ...receipt(), id: '10', observedAt: '2026-08-12T11:00:00Z' }], target),
      ],
      [],
      { artifactManifest: manifestFor('design') },
    );
    expect(result.receipts).toMatchObject([{ noteId: '10' }]);
  });

  it('breaks same-timestamp ties by numeric noteId regardless of input order', () => {
    const target = issueTarget;
    const p = parseArtifactReceipts([
      { ...receipt(), id: '9', observedAt: '2026-08-12T10:00:00Z' },
      { ...receipt(), id: '10', observedAt: '2026-08-12T10:00:00Z' },
    ], target).receipts;
    const requirements = [{ kind: 'design' as const, target: 'issue' as const }];
    expect(validateArtifactRequirements(requirements, p, [], { artifactManifest: manifestFor('design') }).receipts[0]?.noteId).toBe('10');
    expect(validateArtifactRequirements(requirements, [...p].reverse(), [], { artifactManifest: manifestFor('design') }).receipts[0]?.noteId).toBe('10');
  });

  it('activates conditional requirements only for their matching profiles', () => {
    const requirements = [
      { kind: 'data-evidence' as const, target: 'issue' as const, when: 'data-backed' as const },
      { kind: 'deployment-evidence' as const, target: 'issue' as const, when: 'jenkins' as const },
    ];
    expect(validateArtifactRequirements(requirements, [], [], {
      dataEvidenceProfile: 'standard', jenkinsActive: false,
    }).missing).toEqual([]);
    expect(validateArtifactRequirements(requirements, [], [], {
      dataEvidenceProfile: 'data-backed', jenkinsActive: true,
      artifactManifest: manifestFor('data-evidence', 'deployment-evidence'),
    }).missing.map((item) => item.field)).toEqual(['data-evidence', 'deployment-evidence']);
  });

  it('requires a manifest entry and rejects a stale receipt source or hash', () => {
    const requirements = [{ kind: 'design' as const, target: 'issue' as const }];
    const p = parseArtifactReceipts([receipt()], issueTarget).receipts;
    expect(validateArtifactRequirements(requirements, p, [], {
      artifactManifest: { design: { source: '.glab-flow/42/spec/design.md', sha256: SHA256 } },
    }).receipts).toHaveLength(1);
    expect(validateArtifactRequirements(requirements, p, [], {
      artifactManifest: { design: { source: '.glab-flow/42/spec/old-design.md', sha256: 'b'.repeat(64) } },
    }).missing).toContainEqual(expect.objectContaining({ field: 'artifactManifest.design' }));
    expect(validateArtifactRequirements(requirements, p, []).missing)
      .toContainEqual(expect.objectContaining({ field: 'artifactManifest.design' }));
  });
});

describe('MR coverage guard (mrCoverage)', () => {
  const mrReviewReq = [{ kind: 'mr-review' as const, target: 'each-mr' as const }];
  it('flags a repo missing from both mergeRequests and reposWithoutMr', () => {
    const result = validateArtifactRequirements(
      mrReviewReq, [],
      [{ projectPath: 'oa/oa-service', iid: 1 }],
      { artifactManifest: manifestFor('mr-review'), repos: ['oa/oa-service', 'oa/oa-frontend'] },
    );
    expect(result.missing.map((m) => m.field)).toContain('mrCoverage:oa/oa-frontend');
  });
  it('passes coverage when every repo has Mr or is declared without Mr', () => {
    const result = validateArtifactRequirements(
      mrReviewReq, [],
      [{ projectPath: 'oa/oa-service', iid: 1 }],
      { artifactManifest: manifestFor('mr-review'), repos: ['oa/oa-service', 'oa/oa-frontend'], reposWithoutMr: ['oa/oa-frontend'] },
    );
    expect(result.missing.some((m) => m.field.startsWith('mrCoverage:'))).toBe(false);
  });
  it('skips coverage check when repos not declared (back-compat)', () => {
    const result = validateArtifactRequirements(
      mrReviewReq, [],
      [{ projectPath: 'oa/oa-service', iid: 1 }],
      { artifactManifest: manifestFor('mr-review') },
    );
    expect(result.missing.some((m) => m.field.startsWith('mrCoverage:'))).toBe(false);
  });
});

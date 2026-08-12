import { describe, expect, it } from 'vitest';
import { parseArtifactReceipts, validateArtifactRequirements } from './artifact.js';

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

describe('artifact receipts', () => {
  it('rejects a receipt whose SHA-256 is not 64 lowercase hexadecimal characters', () => {
    expect(parseArtifactReceipts([{
      ...receipt(),
      body: receipt().body.replace(SHA256, 'abc123'),
    }], issueTarget)).toEqual([]);
  });

  it('parses a complete versioned receipt marker', () => {
    expect(parseArtifactReceipts([receipt()], issueTarget)).toMatchObject([
      { kind: 'design', target: issueTarget, noteId: '99', sha256: SHA256 },
    ]);
  });

  it('rejects markers missing source or sha256', () => {
    expect(parseArtifactReceipts([
      { id: '1', observedAt: '2026-08-12T10:00:00Z', body: '<!-- glab-flow:artifact-receipt:v1\nkind: design\n-->' },
    ], issueTarget)).toEqual([]);
  });

  it('rejects a marker with an unsupported version header', () => {
    expect(parseArtifactReceipts([{
      ...receipt(), body: `<!-- glab-flow:artifact-receipt:v2
kind: design
source: .glab-flow/42/spec/design.md
sha256: ${SHA256}
-->`,
    }], issueTarget)).toEqual([]);
  });

  it('rejects a marker with an unsupported kind', () => {
    expect(parseArtifactReceipts([receipt('unrecognized-artifact')], issueTarget)).toEqual([]);
  });

  it('rejects deployment evidence that misses automation or manual contract fields', () => {
    expect(parseArtifactReceipts([receipt('deployment-evidence', ['mode: automation', 'capability: jenkins-deploy', 'job: oa-service', 'branch: feature/42', 'environment: test', 'build: 123', 'version: test-v1'])], issueTarget)).toEqual([]);
    expect(parseArtifactReceipts([receipt('deployment-evidence', ['mode: manual', 'unavailable-reason: no job', 'operator: @dev', 'deployed-version: v1', 'environment: production'])], issueTarget)).toEqual([]);
    expect(parseArtifactReceipts([receipt('deployment-evidence', ['mode: manual', 'unavailable-reason: no job', 'operator: @dev', 'deployed-version: v1', 'environment: production', 'verification: smoke-pass'])], issueTarget)).toEqual([]);
    expect(parseArtifactReceipts([receipt('deployment-evidence', ['mode: manual', 'unavailable-reason: no job', 'operator: @dev', 'deployed-version: v1', 'environment: production', 'verification: smoke-pass', 'performed-at: 2026-08-12T10:00:00+00:00'])], issueTarget)).toEqual([]);
  });

  it('rejects MR review evidence with a failed outcome or incomplete strict fields', () => {
    const target = { kind: 'mr', projectPath: 'group/api', iid: 1 } as const;
    expect(parseArtifactReceipts([receipt('mr-review', ['outcome: failed', 'method: mr-review-lite', 'high-findings: none'])], target)).toEqual([]);
    expect(parseArtifactReceipts([receipt('mr-review', ['outcome: passed', 'method: full-diff', 'high-findings: none'])], target)).toEqual([]);
    expect(parseArtifactReceipts([receipt('mr-review', ['outcome: passed', 'method: code-review'])], target)).toEqual([]);
  });

  it('rejects a receipt with an invalid observed timestamp', () => {
    expect(parseArtifactReceipts([{ ...receipt(), observedAt: 'not-a-timestamp' }], issueTarget)).toEqual([]);
    expect(parseArtifactReceipts([{ ...receipt(), observedAt: '2026-08-12T10:00:00+00:00' }], issueTarget)).toEqual([]);
  });

  it('rejects opaque note IDs and parses a complete manual deployment contract', () => {
    expect(parseArtifactReceipts([{ ...receipt(), id: 'note-99' }], issueTarget)).toEqual([]);
    expect(parseArtifactReceipts([receipt('deployment-evidence', [
      'mode: manual', 'unavailable-reason: no Jenkins job', 'operator: @dev', 'deployed-version: v1', 'environment: production', 'verification: smoke-pass', 'performed-at: 2026-08-12T09:30:00Z',
    ])], issueTarget)).toMatchObject([{
      metadata: { mode: 'manual', deployedVersion: 'v1', verification: 'smoke-pass', performedAt: '2026-08-12T09:30:00Z' },
    }]);
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
        ...parseArtifactReceipts([{ ...receipt(), id: '9', observedAt: '2026-08-12T09:00:00Z' }], target),
        ...parseArtifactReceipts([{ ...receipt(), id: '10', observedAt: '2026-08-12T11:00:00Z' }], target),
      ],
      [],
      { artifactManifest: manifestFor('design') },
    );
    expect(result.receipts).toMatchObject([{ noteId: '10' }]);
  });

  it('breaks same-timestamp ties by numeric noteId regardless of input order', () => {
    const target = issueTarget;
    const parsed = parseArtifactReceipts([
      { ...receipt(), id: '9', observedAt: '2026-08-12T10:00:00Z' },
      { ...receipt(), id: '10', observedAt: '2026-08-12T10:00:00Z' },
    ], target);
    const requirements = [{ kind: 'design' as const, target: 'issue' as const }];
    expect(validateArtifactRequirements(requirements, parsed, [], { artifactManifest: manifestFor('design') }).receipts[0]?.noteId).toBe('10');
    expect(validateArtifactRequirements(requirements, [...parsed].reverse(), [], { artifactManifest: manifestFor('design') }).receipts[0]?.noteId).toBe('10');
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
    const parsed = parseArtifactReceipts([receipt()], issueTarget);
    expect(validateArtifactRequirements(requirements, parsed, [], {
      artifactManifest: { design: { source: '.glab-flow/42/spec/design.md', sha256: SHA256 } },
    }).receipts).toHaveLength(1);
    expect(validateArtifactRequirements(requirements, parsed, [], {
      artifactManifest: { design: { source: '.glab-flow/42/spec/old-design.md', sha256: 'b'.repeat(64) } },
    }).missing).toContainEqual(expect.objectContaining({ field: 'artifactManifest.design' }));
    expect(validateArtifactRequirements(requirements, parsed, []).missing)
      .toContainEqual(expect.objectContaining({ field: 'artifactManifest.design' }));
  });
});

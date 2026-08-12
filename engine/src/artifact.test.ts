import { describe, expect, it } from 'vitest';
import { parseArtifactReceipts, validateArtifactRequirements } from './artifact.js';

function evidenceLines(kind: string): string[] {
  if (kind === 'deployment-evidence') return ['mode: automation', 'deployment: test-v1', 'verification: smoke-pass'];
  if (kind === 'mr-review') return ['outcome: approved', 'method: full-diff', 'high-findings: none'];
  return [];
}

const receipt = (kind = 'design', evidence = evidenceLines(kind)) => ({
  id: '99', observedAt: '2026-08-12T10:00:00Z',
  body: `<!-- glab-flow:artifact-receipt:v1
kind: ${kind}
source: .glab-flow/42/spec/design.md
sha256: abc123
${evidence.join('\n')}
-->`,
});

describe('artifact receipts', () => {
  it('parses a complete versioned receipt marker', () => {
    expect(parseArtifactReceipts([receipt()], { kind: 'issue' })).toMatchObject([
      { kind: 'design', target: { kind: 'issue' }, noteId: '99', sha256: 'abc123' },
    ]);
  });

  it('rejects markers missing source or sha256', () => {
    expect(parseArtifactReceipts([
      { id: '1', observedAt: 't', body: '<!-- glab-flow:artifact-receipt:v1\nkind: design\n-->' },
    ], { kind: 'issue' })).toEqual([]);
  });

  it('rejects a marker with an unsupported version header', () => {
    expect(parseArtifactReceipts([{
      ...receipt(), body: `<!-- glab-flow:artifact-receipt:v2
kind: design
source: .glab-flow/42/spec/design.md
sha256: abc123
-->`,
    }], { kind: 'issue' })).toEqual([]);
  });

  it('rejects a marker with an unsupported kind', () => {
    expect(parseArtifactReceipts([receipt('unrecognized-artifact')], { kind: 'issue' })).toEqual([]);
  });

  it('rejects incomplete deployment and MR review receipt evidence', () => {
    expect(parseArtifactReceipts([receipt('deployment-evidence', ['mode: automation'])], { kind: 'issue' })).toEqual([]);
    expect(parseArtifactReceipts([receipt('mr-review', ['outcome: approved', 'method: full-diff'])], { kind: 'mr', projectPath: 'group/api', iid: 1 })).toEqual([]);
  });

  it('rejects a receipt with an invalid observed timestamp', () => {
    expect(parseArtifactReceipts([{ ...receipt(), observedAt: 'not-a-timestamp' }], { kind: 'issue' })).toEqual([]);
  });

  it('requires an mr-review receipt for every supplied MR target', () => {
    const result = validateArtifactRequirements(
      [{ kind: 'mr-review', target: 'each-mr' }],
      [],
      [{ projectPath: 'group/a', iid: 1 }, { projectPath: 'group/b', iid: 2 }],
    );
    expect(result.missing.map((x) => x.field)).toEqual(['mr-review:group/a!1', 'mr-review:group/b!2']);
  });

  it('uses only the latest receipt for each target and kind', () => {
    const target = { kind: 'issue' } as const;
    const result = validateArtifactRequirements(
      [{ kind: 'design', target: 'issue' }],
      [
        ...parseArtifactReceipts([{ ...receipt(), id: 'old', observedAt: '2026-08-12T09:00:00Z' }], target),
        ...parseArtifactReceipts([{ ...receipt(), id: 'new', observedAt: '2026-08-12T11:00:00Z' }], target),
      ],
      [],
    );
    expect(result.receipts).toMatchObject([{ noteId: 'new' }]);
  });

  it('breaks same-timestamp ties by noteId regardless of input order', () => {
    const target = { kind: 'issue' } as const;
    const parsed = parseArtifactReceipts([
      { ...receipt(), id: 'a', observedAt: '2026-08-12T10:00:00Z' },
      { ...receipt(), id: 'b', observedAt: '2026-08-12T10:00:00Z' },
    ], target);
    const requirements = [{ kind: 'design' as const, target: 'issue' as const }];
    expect(validateArtifactRequirements(requirements, parsed, []).receipts[0]?.noteId).toBe('b');
    expect(validateArtifactRequirements(requirements, [...parsed].reverse(), []).receipts[0]?.noteId).toBe('b');
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
    }).missing.map((item) => item.field)).toEqual(['data-evidence', 'deployment-evidence']);
  });
});

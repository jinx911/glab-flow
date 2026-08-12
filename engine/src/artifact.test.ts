import { describe, expect, it } from 'vitest';
import { parseArtifactReceipts, validateArtifactRequirements } from './artifact.js';

const receipt = (kind = 'design') => ({
  id: '99', observedAt: '2026-08-12T10:00:00Z',
  body: `<!-- glab-flow:artifact-receipt:v1
kind: ${kind}
source: .glab-flow/42/spec/design.md
sha256: abc123
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

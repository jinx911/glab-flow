# Artifact Receipt Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block state progression and node-step completion until every applicable formal artifact has an append-only GitLab/MR receipt that the Leader has read back and verified.

**Architecture:** The state machine declares required artifact kinds and targets. A pure receipt parser/validator consumes only Leader-provided Issue/MR readback data; `transition` combines receipt gaps with existing guard failures before creating a `WritePlan`. Pure state helpers retain verified receipts and serial writeback audit events; the Leader documentation owns all GitLab I/O, recovery, tool discovery, and fallback behavior.

**Tech Stack:** TypeScript, YAML state machine, Vitest, existing `pnpm cli` pure commands, Markdown skill pack.

---

## File structure

- Create: `engine/src/artifact.ts` — receipt marker parser, requirement resolver, and pure validation.
- Create: `engine/src/artifact.test.ts` — parser and validation TDD coverage.
- Modify: `engine/src/types.ts` — artifact declarations, receipt input/output, and state-compatible audit types.
- Modify: `engine/state-machine.yaml` — transition-local artifact requirements.
- Modify: `engine/src/transition.ts` — combine normal guards and receipt validation before planning; show receipts/gaps in preview.
- Modify: `engine/src/transition.test.ts` — transition-level receipt and each-MR replay cases.
- Modify: `engine/src/state.ts` — verified receipt cache, data-evidence profile, writeback audit, and receipt-aware progress update.
- Modify: `engine/src/state.test.ts` — audit/recovery and progress gating tests.
- Modify: `engine/src/cli.ts` — pure `state-receipt`, `state-writeback`, and receipt-aware `progress` inputs.
- Modify: `skills/glab-flow/{SKILL,gate,learn,nodes,tools}.md` — Leader protocol and structured lessons.
- Modify: `skills/glab-flow/sub-skills/{spec-author,mr-review,jenkins-deploy,test-design}.md` — artifact-specific write/readback rules.
- Modify: `engine/src/process-contract.test.ts` — assert reusable docs keep the engine/Leader boundary and require receipts.

## Task 1: Define artifact declarations and pure receipt validation

**Files:**
- Create: `engine/src/artifact.ts`
- Create: `engine/src/artifact.test.ts`
- Modify: `engine/src/types.ts`
- Modify: `engine/state-machine.yaml`
- Test: `engine/src/artifact.test.ts`

- [ ] **Step 1: Write failing parser tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseArtifactReceipts, validateArtifactRequirements } from './artifact.js';

const receipt = (kind = 'design') => ({
  id: '99', observedAt: '2026-08-12T10:00:00Z',
  body: `<!-- glab-flow:artifact-receipt:v1\nkind: ${kind}\nsource: .glab-flow/42/spec/design.md\nsha256: abc123\n-->`,
});

it('parses a complete versioned receipt marker', () => {
  expect(parseArtifactReceipts([receipt()], { kind: 'issue' })).toMatchObject([
    { kind: 'design', target: { kind: 'issue' }, noteId: '99', sha256: 'abc123' },
  ]);
});

it('rejects markers missing source or sha256', () => {
  expect(parseArtifactReceipts([{ id: '1', observedAt: 't', body: '<!-- glab-flow:artifact-receipt:v1\nkind: design\n-->' }], { kind: 'issue' })).toEqual([]);
});

it('requires an mr-review receipt for every supplied MR target', () => {
  const result = validateArtifactRequirements(
    [{ kind: 'mr-review', target: 'each-mr' }],
    [],
    [{ projectPath: 'group/a', iid: 1 }, { projectPath: 'group/b', iid: 2 }],
  );
  expect(result.missing.map((x) => x.field)).toEqual(['mr-review:group/a!1', 'mr-review:group/b!2']);
});
```

- [ ] **Step 2: Verify the test fails for the intended missing module**

Run: `pnpm test engine/src/artifact.test.ts`

Expected: FAIL because `./artifact.js` does not exist.

- [ ] **Step 3: Add the closed artifact types and state-machine declarations**

Add to `engine/src/types.ts`:

```ts
export type ArtifactKind = 'proposal' | 'design' | 'data-evidence' | 'deployment-evidence' | 'test-plan' | 'mr-review' | 'release-plan';
export type ArtifactTarget = { kind: 'issue' } | { kind: 'mr'; projectPath: string; iid: number };
export type ArtifactRequirement = { kind: ArtifactKind; target: 'issue' | 'each-mr'; when?: 'data-backed' | 'jenkins' };
export interface ReceiptNote { id: string; body: string; observedAt: string; url?: string }
export interface ArtifactReceipt { kind: ArtifactKind; target: ArtifactTarget; source: string; sha256: string; noteId: string; noteUrl?: string; observedAt: string }
```

Extend `Transition` with `requiredArtifacts?: ArtifactRequirement[]`. Add the following YAML declarations:

```yaml
# 草稿中 -> 待评审
requiredArtifacts: [{kind: proposal, target: issue}]
# 已评审 -> 开发中
requiredArtifacts: [{kind: design, target: issue}, {kind: data-evidence, target: issue, when: data-backed}]
# 开发中 -> 测试中
requiredArtifacts: [{kind: deployment-evidence, target: issue, when: jenkins}]
# 测试中 -> 待发布
requiredArtifacts: [{kind: test-plan, target: issue}, {kind: mr-review, target: each-mr}]
# 待发布 -> production-validation node
requiredArtifacts: [{kind: release-plan, target: issue}]
```

Use the same declarations on Story and Bug transitions where the transition exists.

- [ ] **Step 4: Implement pure marker parsing and requirement validation**

Implement `parseArtifactReceipts(notes, target)` in `engine/src/artifact.ts`. It accepts only markers with exact header `glab-flow:artifact-receipt:v1`, a valid closed-union `kind`, non-empty `source`, and non-empty `sha256`; it carries the caller-provided target and note metadata into `ArtifactReceipt`.

Implement `validateArtifactRequirements(requirements, receipts, mergeRequests)` with this behavior:

```ts
const active = requirements.filter((r) => r.when !== 'data-backed' || dataEvidenceProfile === 'data-backed')
  .filter((r) => r.when !== 'jenkins' || jenkinsActive);
// issue requirement: any matching kind/issue receipt succeeds
// each-mr requirement: mergeRequests must be non-empty and every projectPath+iid has matching kind/MR receipt
// return { receipts: latestByTargetAndKind, missing: MissingItem[] }
```

The missing hints must tell the Leader exactly where to append and read back the receipt. No filesystem, GitLab, shell, or network API is introduced.

- [ ] **Step 5: Verify parser and requirement tests pass**

Run: `pnpm test engine/src/artifact.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the isolated artifact validation layer**

```bash
git add engine/src/{artifact.ts,artifact.test.ts,types.ts} engine/state-machine.yaml
git commit -m "feat(engine): validate artifact receipts"
```

## Task 2: Make transition planning receipt-aware

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/transition.ts`
- Modify: `engine/src/transition.test.ts`
- Test: `engine/src/transition.test.ts`

- [ ] **Step 1: Write failing transition tests**

Add helpers that construct marker notes, then add these cases:

```ts
it('blocks 已评审 -> 开发中 when design exists locally but has no Issue receipt', () => {
  const r = runTransition(model, baseInput({
    labels: ['type::story', 'story-status::已评审'], body: TABLE_BODY,
    fields: { 技术方案评审通过记录或免评审结论: '通过', 实际开始日期: '2026-08-12', 研发Assignee: '@dev', 计划提测时间: '2026-08-14', 计划上线时间: '2026-08-16' },
    datesConfirmed: true,
  }));
  expect(r.validate.ok).toBe(false);
  expect(r.plan).toBeUndefined();
  expect(r.missing.some((x) => x.field === 'design')).toBe(true);
});

it('allows 测试中 -> 待发布 only after test-plan and every MR review receipt are read back', () => {
  const r = runTransition(model, baseInput({
    labels: ['type::story', 'story-status::测试中'], body: TABLE_BODY, fields: TEST_DONE_FIELDS, datesConfirmed: true,
    artifactContext: { issueNotes: [marker('test-plan')], mergeRequests: [mr('group/a', 1, [marker('mr-review')]), mr('group/b', 2, [marker('mr-review')])] },
  }));
  expect(r.validate.ok).toBe(true);
  expect(r.plan).toBeDefined();
});
```

Add cases for missing one MR receipt, `data-backed` without `data-evidence`, standard profile without that requirement, active Jenkins without `deployment-evidence`, and an `mr-review` requirement with no MR list.

- [ ] **Step 2: Verify the tests fail because transition ignores receipts**

Run: `pnpm test engine/src/transition.test.ts`

Expected: new tests fail: the current implementation incorrectly yields `validate.ok === true` or lacks receipt-specific missing items.

- [ ] **Step 3: Extend transition input/output and compose receipt validation**

Add to `TransitionInput`:

```ts
artifactContext?: {
  dataEvidenceProfile?: 'standard' | 'data-backed';
  issueNotes?: ReceiptNote[];
  mergeRequests?: Array<{ projectPath: string; iid: number; notes: ReceiptNote[] }>;
};
```

Add `verifiedReceipts: ArtifactReceipt[]` to `TransitionOutput`. In `runTransition`, derive `jenkinsActive` from the active playbook, parse Issue and MR notes, resolve `tr.requiredArtifacts`, and merge receipt gaps with the normal `GuardResult`:

```ts
const baseValidation = validateTransition(model, facts, payload);
const artifactValidation = validateArtifactRequirements(/* transition requirements + parsed readback */);
const validate = {
  ok: baseValidation.ok && artifactValidation.missing.length === 0,
  missing: [...baseValidation.missing, ...artifactValidation.missing.map((m) => m.field)],
  reasons: [...baseValidation.reasons, ...artifactValidation.missing.map((m) => `缺少产物回执：${m.hint}`)],
};
const plan = validate.ok ? buildForwardPlan(payload, input.iid) : undefined;
```

Append verified receipt summaries and precise receipt gaps to `previewText`. Preserve existing no-receipt behavior for transitions without declarations.

- [ ] **Step 4: Verify transition tests pass**

Run: `pnpm test engine/src/transition.test.ts`

Expected: PASS, including the new blocked/local-only and all-MR readback cases.

- [ ] **Step 5: Commit receipt-aware transition planning**

```bash
git add engine/src/{types.ts,transition.ts,transition.test.ts}
git commit -m "feat(engine): gate transitions on artifact receipts"
```

## Task 3: Persist verified receipts and serial writeback audit state

**Files:**
- Modify: `engine/src/state.ts`
- Modify: `engine/src/state.test.ts`
- Modify: `engine/src/cli.ts`
- Test: `engine/src/state.test.ts`

- [ ] **Step 1: Write failing state tests**

```ts
it('records a verified receipt idempotently after GitLab readback', () => {
  const once = recordVerifiedReceipt(base, { kind: 'design', target: { kind: 'issue' }, source: 'x', sha256: 'a', noteId: '9', observedAt: 't1' }, 't1');
  expect(once.artifactReceipts).toHaveLength(1);
  expect(recordVerifiedReceipt(once, once.artifactReceipts[0]!, 't2')).toBe(once);
});

it('rejects marking a governed progress step done without its verified receipt', () => {
  const r = markProgressDone(atDesignNode, '技术方案', 't2', []);
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('design');
});

it('retains successful writeback stages before a later failure for recovery', () => {
  const s = recordWritebackAudit(recordWritebackAudit(base, metadataSuccess, 't1'), commentFailure, 't2');
  expect(s.writebackAudit.map((x) => x.status)).toEqual(['succeeded', 'failed']);
});
```

- [ ] **Step 2: Verify state tests fail**

Run: `pnpm test engine/src/state.test.ts`

Expected: FAIL because the receipt/audit helpers and fields do not exist.

- [ ] **Step 3: Implement typed state helpers and CLI plumbing**

Add to `RunState`:

```ts
artifactReceipts: ArtifactReceipt[];
dataEvidenceProfile?: 'standard' | 'data-backed';
writebackAudit: Array<{ target: 'issue' | `mr:${string}!${number}`; stage: 'artifact-comment' | 'metadata' | 'state-comment' | 'readback'; status: 'succeeded' | 'failed'; at: string; detail: string }>;
```

Initialize empty arrays. Implement pure `recordVerifiedReceipt`, `setDataEvidenceProfile`, and `recordWritebackAudit` with immutable, idempotent updates. Replace the bare `markProgressDone` result with a discriminated result that refuses `技术方案`, `测试计划`, `发布计划就绪`, and `上线前确认` unless the caller supplies matching verified receipts; leave ungated steps unchanged.

Extend CLI with pure JSON-in/JSON-out commands:

```text
state-receipt    {state, receipt, now} -> RunState
state-writeback  {state, audit, now} -> RunState
progress         {state, step?, resetToNode?, verifiedReceipts?, now} -> ProgressResult
```

No command reads or writes `.glab-flow`; the Leader continues to persist returned JSON.

- [ ] **Step 4: Verify state tests pass**

Run: `pnpm test engine/src/state.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the recovery cache changes**

```bash
git add engine/src/{state.ts,state.test.ts,cli.ts}
git commit -m "feat(engine): audit artifact writeback recovery"
```

## Task 4: Make the Leader protocol and sub-skills agent-independent

**Files:**
- Modify: `skills/glab-flow/SKILL.md`
- Modify: `skills/glab-flow/gate.md`
- Modify: `skills/glab-flow/resume.md`
- Modify: `skills/glab-flow/learn.md`
- Modify: `skills/glab-flow/nodes.md`
- Modify: `skills/glab-flow/tools.md`
- Modify: `skills/glab-flow/sub-skills/spec-author.md`
- Modify: `skills/glab-flow/sub-skills/mr-review.md`
- Modify: `skills/glab-flow/sub-skills/jenkins-deploy.md`
- Modify: `skills/glab-flow/sub-skills/test-design.md`
- Test: `engine/src/process-contract.test.ts`

- [ ] **Step 1: Write failing documentation contract assertions**

Add assertions requiring the combined skill docs to contain: `artifact-receipt`, readback/回读, serial `标签/Assignee → 评论 → 回读`, `data-backed`, MR-local review comments, and `manual` deployment evidence. Also assert no new forbidden I/O term appears in engine production code.

- [ ] **Step 2: Run contract test to confirm it fails**

Run: `pnpm test engine/src/process-contract.test.ts`

Expected: FAIL because the reusable protocol has not yet documented receipt markers and serial recovery.

- [ ] **Step 3: Document the fixed Leader sequence**

In `gate.md` and `SKILL.md`, require this sequence before a node is marked complete or an Issue plan is applied:

```text
produce artifact -> append artifact receipt -> read target -> parse receipt -> update state cache -> mark progress done
all code/artifact steps pass -> labels/Assignee -> state-change comment -> final Issue readback
```

Document that any failure stops later writes and that resume rereads GitLab before retrying the first missing stage. Add the data profile decision at draft review, MR-local review receipt requirements, and Jenkins tool discovery/manual fallback. Update `resume.md` to use `artifactReceipts` and `writebackAudit` as cache-only recovery data.

In the sub-skills, require the exact artifact and target: proposal/design/test plan/release plan to parent Issue; each MR review to its own MR. Require a receipt marker plus a concise human summary, not only a local file path.

Update `learn.md` JSONL schema with optional `trigger`, `impact`, `resolution`, and `recurrence`; state that old records remain valid and these fields never affect gates.

- [ ] **Step 4: Verify documentation contracts pass**

Run: `pnpm test engine/src/process-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit agent-independent Leader protocol documentation**

```bash
git add skills/glab-flow engine/src/process-contract.test.ts
git commit -m "docs(skill): require artifact receipt readback"
```

## Task 5: Add end-to-end receipt replays and run the final gate

**Files:**
- Modify: `engine/src/e2e.test.ts`
- Test: all `engine/src/*.test.ts`

- [ ] **Step 1: Write failing replay tests**

Add two pure replay tests:

```ts
it('blocks a story with local-only design, then permits it after Issue receipt readback', () => {
  // same labels/payload before and after a parsed design receipt
  // first output has no plan; second output has a plan
});

it('blocks a multi-repository release gate until every MR review and deployment fallback receipt is read back', () => {
  // one MR receipt missing -> no plan; all MR receipts plus manual deployment evidence -> plan
});
```

Also cover a Bug release path with `release-plan`, proving state-machine declarations apply only to transitions that exist.

- [ ] **Step 2: Run replay tests and observe the expected failure**

Run: `pnpm test engine/src/e2e.test.ts`

Expected: new assertions fail until tasks 1–4 are complete; once implementing this task after them, any failure identifies a gap in the composed behavior.

- [ ] **Step 3: Implement only fixes required by replay failures**

Adjust receipt parsing, transition composition, or state-machine declarations without adding any new side-effecting code. Keep engine production files free of `glab`, HTTP, filesystem-write, or shell execution terms.

- [ ] **Step 4: Verify the complete suite**

Run:

```bash
pnpm test
pnpm typecheck
git diff --check
```

Expected: all tests pass, typecheck succeeds, and no whitespace errors exist.

- [ ] **Step 5: Commit replay coverage and final verification changes**

```bash
git add engine/src/e2e.test.ts engine/src/{artifact.ts,transition.ts,state.ts} engine/state-machine.yaml
git commit -m "test: replay artifact receipt gates"
```

## Self-review

- All six design acceptance criteria map to Tasks 1–5.
- Every production behavior is test-first: parser/validator, transition composition, state/audit, documentation contract, then end-to-end replay.
- Engine changes only parse stdin/readback objects and produce deterministic output; Leader docs own GitLab comments, readback, Jenkins discovery, and persistence.
- No task depends on issue-specific identifiers, local user mappings, or a live GitLab connection.

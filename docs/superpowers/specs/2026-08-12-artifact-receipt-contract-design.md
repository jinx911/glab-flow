# Artifact Receipt Contract Design

## Goal

Make every formal glab-flow deliverable visible and verifiable in GitLab before its node step can be marked complete or the Issue can advance. This closes the observed gap where an agent writes only the state-change comment while leaving the technical design, test plan, review, or release plan solely in the local `.glab-flow` workspace.

The design also turns the recent production lessons into enforceable execution rules: serial state writeback with readback, conditional data-evidence collection, deployment capability discovery with a manual fallback, MR-local review evidence, and structured lesson metadata.

## Non-goals

- The engine will not call GitLab, write files, create MRs, deploy, or invoke MCP tools. It remains deterministic and pure.
- Existing Issue descriptions and posted comments remain immutable (G7/G8).
- This does not automatically infer business scope from prose. The Leader must explicitly classify whether a requirement needs data evidence.
- This does not replace the current state machine or the existing hard gates.

## Architecture

The implementation has three layers.

1. **State-machine declarations** state which artifact receipts are required by a transition, their target (`issue` or `each-mr`), and any condition that activates them.
2. **Engine receipt validation** consumes only Leader-read evidence and returns missing receipts alongside normal guard failures. A transition has no `plan` while any required receipt is absent or unverified.
3. **Leader execution and cache** writes one structured, append-only GitLab comment for every artifact, reads it back, supplies the readback evidence to the engine, and stores a non-authoritative audit cache for recovery.

GitLab remains the truth source. The local state cache only records a receipt after the relevant Issue or MR comment has been read back successfully.

## Receipt contract

Every formal artifact has one GitLab receipt comment. The comment starts with a versioned, machine-readable marker and follows it with a human-readable summary:

```markdown
<!-- glab-flow:artifact-receipt:v1
kind: design
source: .glab-flow/<iid>/spec/design.md
sha256: <content-sha256>
-->
## 产物回执：技术方案

- 本地文件：`.glab-flow/<iid>/spec/design.md`
- 摘要：<non-empty summary of decisions, scope, and acceptance impact>
- 生成时间：<ISO-8601 timestamp>
```

The `kind`, source path, and SHA-256 make the receipt stable enough to match after a resumed run. The summary lets GitLab users review the result without opening the local workspace. The Leader must add comments only; it never edits an existing receipt.

The readback payload retained by the engine and state cache is:

```ts
type ReceiptTarget =
  | { kind: 'issue' }
  | { kind: 'mr'; projectPath: string; iid: number };

interface ArtifactReceipt {
  kind: ArtifactKind;
  target: ReceiptTarget;
  source: string;
  sha256: string;
  noteId: string;
  noteUrl?: string;
  observedAt: string;
}
```

`ArtifactKind` is a closed union: `proposal`, `design`, `data-evidence`, `deployment-evidence`, `test-plan`, `mr-review`, and `release-plan`.

## Required artifacts and activation

Requirements attach to the transition that leaves the node which produced the artifact. This keeps “done” and “can advance” equivalent.

| Transition | Required receipt | Target | Activation |
| --- | --- | --- | --- |
| 草稿中 → 待评审 | `proposal` | parent Issue | always |
| 已评审 → 开发中 | `design` | parent Issue | always |
| 已评审 → 开发中 | `data-evidence` | parent Issue | only when the triage profile is `data-backed` |
| 开发中 → 测试中 | `deployment-evidence` | parent Issue | only when the active playbook includes Jenkins deployment |
| 测试中 → 待发布 | `test-plan` | parent Issue | always |
| 测试中 → 待发布 | `mr-review` | every affected feature-to-master MR | always |
| 待发布 → 生产验收中 / 生产验证中 | `release-plan` | parent Issue | always |

For a Bug, only transitions that exist in the Bug state machine receive the same applicable requirements. `mr-review` is complete only if every MR passed to the transition input has one verified receipt. An empty affected-MR list is invalid for a transition that requires `mr-review`.

### Data-evidence profile

At `草稿中 → 待评审`, the Leader must explicitly select one profile and persist it in `RunState`:

- `standard`: no data-evidence receipt is required.
- `data-backed`: before technical-plan approval, a `data-evidence` receipt must summarize the code data flow, the data-source decision, and (when production was requested) the read-only production evidence plus the routing/authorization constraint used.

The explicit profile prevents agents from silently treating a historical-data or source-of-truth question as a normal text-only review. It is a declared decision, not an attempt to infer intent from keywords.

### Deployment evidence

Before a Jenkins-backed test deployment, the Leader performs capability discovery. The `deployment-evidence` receipt records one of two valid modes:

- `automation`: discovered callable Jenkins capability, selected job/branch/environment parameters, and the returned build/version evidence.
- `manual`: discovery result and reason it was unavailable, the human-confirmed deployment operator/time, deployed version/environment, and a readback or test-environment verification result.

A static list of installed skills is not evidence of a callable capability. Both modes remain subject to the existing Jenkins parameter confirmation rule.

## Engine interfaces and behavior

`Transition` gains optional `requiredArtifacts` declarations. `TransitionInput` gains only read evidence and explicit context:

```ts
interface ArtifactContext {
  dataEvidenceProfile?: 'standard' | 'data-backed';
  issueNotes: ReceiptNote[];
  mergeRequests?: Array<{ projectPath: string; iid: number; notes: ReceiptNote[] }>;
}
```

`ReceiptNote` contains the note id, body, optional URL, and observed timestamp. The engine parses receipt markers, validates their required keys, filters them by target, and exposes verified `ArtifactReceipt` values in `TransitionOutput`.

The receipt validator runs after the normal payload/guard validation but before `buildForwardPlan`. It appends actionable `MissingItem`s (for example, “write and read back a `design` receipt on the parent Issue”) and combines them with the existing `GuardResult`. If normal guards or artifact requirements fail, `validate.ok` is `false`, `plan` is absent, and `shouldConfirm` remains `true`.

`progress` will reject an attempt to mark a receipt-governed step complete unless the caller provides matching verified receipts. The engine has no knowledge of filesystem existence; a local file without a GitLab readback is intentionally insufficient.

## Leader writeback and recovery protocol

All state and artifact writebacks use this fixed, serial protocol:

1. Produce the local artifact and calculate its SHA-256.
2. Add the artifact receipt comment to its required target (parent Issue or one MR).
3. Read the same target again and parse the receipt by its marker, kind, source, and SHA-256.
4. Record the verified receipt locally; only then mark the associated node progress step done.
5. After all code-side actions and artifact receipts are verified, execute the existing Issue state writeback serially: labels/Assignee, state-change comment, then final Issue readback.

Each successful or failed stage is appended to a typed `writebackAudit` entry in `RunState`. A failed stage stops the pipeline; later stages do not run. On resume, the Leader rereads GitLab and reconciles receipts and the final state before retrying only the first unfinished stage. The cache must never be used to claim a comment was written without GitLab readback.

The state schema gains `artifactReceipts`, `dataEvidenceProfile`, and `writebackAudit`. The existing `lastActions` and `spawnedAgents` fields are updated in the same pure state helper path rather than remaining unused placeholders.

## MR review evidence

The formal `mr-review` conclusion is posted to every affected feature-to-master MR, then read back from that MR. A parent Issue comment may summarize all MR results but cannot substitute for an MR-local receipt. The receipt includes the MR project/path, MR IID, outcome, review method (`mr-review-lite` or fallback), and a statement that CRITICAL/HIGH findings have no unresolved items.

## Structured lessons

Raw lessons retain `node`, `signal`, `detail`, and `at`, and add optional fields:

```ts
interface LessonEntry {
  node: string;
  signal: LessonSignal;
  detail: string;
  at: string;
  trigger?: string;
  impact?: 'blocked' | 'partial-write' | 'manual-work' | 'quality-risk';
  resolution?: string;
  recurrence?: 'first-seen' | 'repeat';
}
```

The new fields are descriptive rather than gate inputs. Existing JSONL remains valid, while new captures make future distillation measurable by trigger, impact, resolution, and repeat rate.

## Error handling

- Malformed receipt marker, missing source/SHA, or target mismatch: treat it as absent; explain the expected receipt in `missing[]`.
- Duplicate matching receipts: use the newest readback evidence and expose it in the preview; do not edit or delete prior comments.
- Partial state writeback: retain successful audit entries, stop, report the exact completed stage, and rerun GitLab readback before any retry.
- Missing MR read access or unknown affected MR list: block G14 with an actionable reason; do not accept a parent-Issue-only conclusion.
- Jenkins unavailable: require a `manual` deployment receipt rather than bypassing deployment evidence.

## Test strategy

Unit tests cover marker parsing, malformed/mismatched receipts, conditional requirements, each-MR completeness, profile acknowledgement, deployment modes, and receipt-aware progress guards. State tests cover audit append/idempotency and recovery reconciliation inputs. Transition tests cover no-plan-on-missing-receipt behavior and previews that identify the exact target.

Replay-style tests cover a story and Bug through their applicable paths, including: a local design with no Issue receipt (blocked), successful Issue/MR receipt readback (allowed), a multi-repository MR set with one missing comment (blocked), a failed comment write after successful labels (no false local completion), and a manual Jenkins fallback with valid deployment evidence.

Documentation contract tests ensure the skill pack tells every Agent to write/read back artifacts and preserves the engine/Leader I/O boundary.

## Acceptance criteria

1. No required transition produces a forward `WritePlan` until every applicable artifact receipt has been read back from its declared GitLab target.
2. A technical design existing only under `.glab-flow/<iid>/spec/` blocks `已评审 → 开发中`.
3. Every affected feature-to-master MR has a read-back formal review receipt before `测试中 → 待发布`.
4. A partial writeback cannot cause state/progress cache to claim that an absent comment or receipt completed.
5. A data-backed profile and Jenkins deployment each produce the extra evidence specified above; standard/non-Jenkins flows remain unaffected.
6. The engine stays free of GitLab/network/filesystem side effects, and the full test suite and typecheck pass.

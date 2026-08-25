# 统一多环境测试执行 Implementation Plan

> **For agentic workers:** Execute inline in this worktree. Per user instruction, implement each task first, then add or update focused tests and run the relevant verification.

**Goal:** Make local and test environments run one versioned test plan, persist parseable execution records, and gate delivery transitions on verified records.

**Architecture:** `engine/src/test-run.ts` owns strict parsing, rendering, latest-record selection, and plan/run compatibility validation. `guard.ts` calls it for local and test gates through every transition entry point; the Leader remains responsible for actual Apifox/E2E execution and Issue writes. Markdown skills define the single plan, runtime authorization preflight, and post-implementation verification workflow without test-first steps.

**Tech Stack:** TypeScript, Vitest, YAML state-machine data, Markdown skills, Apifox CLI runtime integration.

---

## File structure

- Create `engine/src/test-run.ts` — pure test-plan/test-run marker parser, validator, renderer, latest-record selection.
- Create `engine/src/test-run.test.ts` — parser, invalid-latest, coverage, version and renderer verification.
- Modify `engine/src/types.ts` — typed plan/run contracts and transition input payloads.
- Modify `engine/src/guard.ts` — local/test execution record gates shared by `transition`, `validate`, and `plan`.
- Modify `engine/src/cli.ts` — expose `test-run` preview/validation command and accept `testPlan` on legacy commands.
- Modify `engine/src/transition.ts`, `engine/src/render.ts`, `engine/state-machine.yaml` — replace free-text self-test proof with run-record references in comments and required fields.
- Modify `engine/src/{guard,transition,cli,render,process-contract}.test.ts` — integration and process-contract coverage.
- Modify `skills/glab-flow/{SKILL,nodes,gate,tools,test-config.example}.md` and `skills/glab-flow/sub-skills/{test-design,test-flow-apifox,test-flow-e2e,code-review,mr-review}.md` — one plan/two environment runs and report-upload authorization.
- Delete the retired test-first sub-skill.

### Task 1: Add pure plan and execution-record contracts

**Files:**
- Create: `engine/src/test-run.ts`
- Create: `engine/src/test-run.test.ts`
- Modify: `engine/src/types.ts`

- [x] **Step 1: Define contracts in `types.ts`.**

  Add these declarations after Week Plan types:

  ```ts
  export type TestEnvironment = 'local' | 'test' | (string & {});
  export type TestMethod = 'api' | 'e2e' | 'data' | 'manual';
  export interface TestPlanCase {
    id: string;
    environments: TestEnvironment[];
    methods: TestMethod[];
  }
  export interface TestPlan { version: string; cases: TestPlanCase[]; }
  export interface TestRun {
    environment: TestEnvironment;
    planVersion: string;
    version: string;
    outcome: 'passed';
    cases: Record<string, 'passed'>;
    evidence: Partial<Record<TestMethod, string>>;
  }
  export type LatestTestRun =
    | { kind: 'absent' }
    | { kind: 'valid'; run: TestRun }
    | { kind: 'invalid-latest'; errors: string[] };
  ```

  Add `testPlan?: string` to `Payload` and `TransitionInput`; this is the current contents of `.glab-flow/<iid>/spec/test-plan.md`, read by the Leader before invoking the pure engine.

- [x] **Step 2: Implement strict marker parsing and rendering in `test-run.ts`.**

  Use only string/array operations. Recognize these exact blocks:

  ```markdown
  <!-- glab-flow:test-plan:v1
  plan-version: v3
  case: TP-001 | local,test | api,e2e
  -->

  <!-- glab-flow:test-run:v1
  environment: local
  plan-version: v3
  version: oa-service:abc123
  outcome: passed
  cases: TP-001=passed
  evidence: api=report:123,e2e=note:https://example.test/1
  -->
  ```

  Export `parseTestPlan(text)`, `parseLatestTestRun(notes, environment)`, `validateTestRun(plan, environment, latest)`, and `renderTestRun(run)`. Reject duplicate/missing keys, blank values, unknown methods, duplicate case IDs, a plan with no cases, wrong case syntax, failed/skipped outcomes, non-matching plan versions, missing required case results, unknown case results, and missing evidence for every method required by the environment's cases. Select the latest marker for the requested environment; a later malformed marker with the requested or absent environment is `invalid-latest` and must not fall back.

- [x] **Step 3: Add focused post-implementation tests in `test-run.test.ts`.**

  Cover a valid local record; missing local case; missing API/E2E evidence; stale plan version; newest failed/malformed local marker blocking an older pass; independent local/test selection; and `renderTestRun` round trip. Use a fixture with `TP-001` required in `local,test` and `TP-002` required only in `test`.

- [x] **Step 4: Verify Task 1.**

  Run `pnpm test -- engine/src/test-run.test.ts` and `pnpm typecheck`. Expected: all test-run cases pass and TypeScript has no errors.

### Task 2: Enforce local and test execution gates everywhere

**Files:**
- Modify: `engine/src/guard.ts`
- Modify: `engine/src/transition.ts`
- Modify: `engine/src/cli.ts`
- Modify: `engine/src/guard.test.ts`
- Modify: `engine/src/transition.test.ts`
- Modify: `engine/src/cli.test.ts`

- [x] **Step 1: Add a shared `validateTestRunTransition` guard.**

  In `guard.ts`, parse `payload.testPlan` and call the Task 1 functions. Require `local` for `开发中 → 测试中` and `test` for `测试中 → 待发布`; return actionable reasons such as `测试计划缺失或无效`, `local 测试执行记录缺失`, `test 最新测试执行记录无效`, and `测试计划版本不匹配`. Merge it with required-field, Week Plan, and blocking-issue results so any failure prevents a `WritePlan`.

- [x] **Step 2: Thread the plan through all entry points.**

  `runTransition` passes `input.testPlan` into its `Payload`. Legacy `validate` and `plan` JSON input accept `testPlan?: string` alongside `notes`, and pass both into `validateTransition`. Add a `test-run` CLI case that reads `{plan,run}`, parses the plan, validates the run for its environment, and prints `{validate,comment}` without GitLab I/O.

- [x] **Step 3: Add post-implementation integration tests.**

  Assert Story and Bug transitions reject without a plan, reject without a local run, accept a valid local run for `开发中 → 测试中`, then reject `测试中 → 待发布` until a valid test run exists. Assert stale records after plan version changes fail in `transition`, `validate`, and `plan`. Assert `test-run` CLI emits a parseable comment.

- [x] **Step 4: Verify Task 2.**

  Run `pnpm test -- engine/src/guard.test.ts engine/src/transition.test.ts engine/src/cli.test.ts` and `pnpm typecheck`. Expected: gate behavior is identical across all three entry points.

### Task 3: Align state comments and state-machine requirements

**Files:**
- Modify: `engine/state-machine.yaml`
- Modify: `engine/src/render.ts`
- Modify: `engine/src/transition.ts`
- Modify: `engine/src/render.test.ts`
- Modify: `engine/src/transition.test.ts`

- [x] **Step 1: Replace weak self-test fields.**

  For both Story and Bug `开发中 → 测试中`, remove `自测计划` and `接口自测结论` from `requiredFields`; retain review/assignee/date/version/test-description fields because they describe the handoff. The local TestRun guard replaces those two free-text proofs. For `测试中 → 待发布`, the test TestRun guard supplements existing acceptance/MR/blocking-problem requirements.

- [x] **Step 2: Render references instead of claims.**

  Add `测试计划版本` and `local测试执行记录` to the handoff content keys; add `测试计划版本` and `test测试执行记录` to the test-report content keys. In `FIELD_HINTS`, explain that values are references to freshly read, machine-validated Issue records rather than text that itself proves execution.

- [x] **Step 3: Add post-implementation rendering checks.**

  Verify both content bodies render the new reference fields and do not render removed self-test claims as required evidence. Verify successful transitions still produce the same serial `WritePlan` shape.

- [x] **Step 4: Verify Task 3.**

  Run `pnpm test -- engine/src/render.test.ts engine/src/transition.test.ts` and `pnpm typecheck`.

### Task 4: Document one process and strict upload authorization

**Files:**
- Modify: `skills/glab-flow/SKILL.md`
- Modify: `skills/glab-flow/nodes.md`
- Modify: `skills/glab-flow/gate.md`
- Modify: `skills/glab-flow/tools.md`
- Modify: `skills/glab-flow/test-config.example.md`
- Modify: `skills/glab-flow/sub-skills/test-design.md`
- Modify: `skills/glab-flow/sub-skills/test-flow-apifox.md`
- Modify: `skills/glab-flow/sub-skills/test-flow-e2e.md`
- Modify: `skills/glab-flow/sub-skills/code-review.md`
- Modify: `skills/glab-flow/sub-skills/mr-review.md`
- Delete: retired test-first sub-skill
- Modify: `engine/src/process-contract.test.ts`

- [x] **Step 1: Document the single-plan protocol.**

  Make test design occur after technical design and before local execution. Publish the exact plan marker and TestRun template from Task 1. State that local and test execute all environment-required cases in the same plan; URL, accounts, data prefix, deployment method, and Apifox environment ID are Profile values only. Require an explicit plan version increment after any test-plan change.

- [x] **Step 2: Add report-upload authorization preflight.**

  In the Apifox execution guidance, require the Leader to show target project/branch/environment/suite/data prefix and that `--upload-report detail` uploads request/response details. In Codex, request `require_escalated` with the narrow reusable `apifox test-suite run` prefix. On Apifox AI-permission denial, stop, direct the user to enable target-branch external AI editing or manually run the same suite, then require `test-report get` readback. Never remove the upload option silently or accept stdout as a substitute.

- [x] **Step 3: Remove the retired test-first flow.**

  Remove retired test-first references, remove the sub-skill from the vendor inventory, delete it, and replace development wording with `git-ops + codegraph + post-implementation verification`. Preserve mandatory post-implementation automated tests, integration tests, full regression, type checking, and code review.

- [x] **Step 4: Add process-contract assertions.**

  Assert that docs contain the two markers, both `local` and `test` gates, `require_escalated`/`apifox test-suite run`, and the no-silent-downgrade rule. Assert production skill/docs no longer contain retired test-first routes.

- [x] **Step 5: Verify Task 4.**

  Run `pnpm test -- engine/src/process-contract.test.ts` and `pnpm typecheck`.

### Task 5: Full verification and review

**Files:**
- Modify: all Task 1–4 files only

- [x] **Step 1: Run full checks.**

  Run `pnpm test`, `pnpm typecheck`, and `git diff --check`. If CLI subprocess tests require local IPC access, rerun the same full suite with the platform's scoped elevated permission and report that reason.

- [x] **Step 2: Review scope and contracts.**

  Inspect `git diff --name-only` and the final diff. Confirm no production engine I/O, no Apifox/GitLab credentials, no accidental report upload during tests, and no remaining test-first instructions.

- [x] **Step 3: Prepare handoff.**

  Report exact test totals, changed files, the local/test gate behavior, report-upload recovery behavior, and any external publication actions that still require user authorization.

## Plan self-review

- Specification coverage: Task 1 supplies strict records; Task 2 activates local/test gates; Task 3 makes Issue output truthful; Task 4 unifies docs and upload authorization; Task 5 verifies boundaries.
- Placeholder scan: no deferred behavior, generic validation instruction, or unnamed files remain.
- Type consistency: `TestPlan`, `TestRun`, `LatestTestRun`, `testPlan`, `parseTestPlan`, `parseLatestTestRun`, and `validateTestRun` are defined in Task 1 and used with those names throughout later tasks.

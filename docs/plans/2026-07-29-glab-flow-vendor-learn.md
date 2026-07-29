# glab-flow Content & Self-Iteration — Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor glab-flow's OA content-generation methodology as self-owned sub-skills and add the native learn loop (capture per-node → apply at start → upgrade at terminal with human-approved edits), completing full self-containment.

**Architecture:** glab-flow owns its methodology as markdown under `skills/glab-flow/sub-skills/`, consumed by inline-Read or `general-purpose` spawn (no global skill/agent registration → no name collision). Clean source skills (git-ops, jenkins-deploy, spec-author) are copied+adapted; team-pipeline sources (test-flow) are NOT copied — lean single-leader methodology is written fresh. apifox family / reviewer agents / codegraph remain documented runtime tools. The learn loop is native (`skills/glab-flow/learn.md`); data lives at runtime under `.glab-flow/`.

**Tech Stack:** Markdown skill pack; no engine changes (learn is Leader+markdown, like dev-flow's learn). Existing engine commands reused.

**Spec:** `docs/specs/2026-07-29-glab-flow-isolation-design.md` (§10 learn, §11 vendor, §5 structure). **Boundary (user-confirmed):** vendor core methodology + tools as runtime deps.

**Prerequisite:** Plan 1 done (branch `feat/glab-flow-isolation-infra`); SKILL.md already forward-references `sub-skills/`.

---

## File Structure

**Vendored sub-skills** (`skills/glab-flow/sub-skills/*.md`) — 7 files, matching SKILL.md's existing references:
- `spec-author.md` — copy+adapt source `~/.claude/skills/spec-author/` (rewrite `.dev-flow/`→`.glab-flow/<iid>/spec/`, strip dev-flow/superpowers).
- `git-ops.md` — copy+adapt source `~/.claude/skills/git-ops/` (clean; light adapt to glab-flow context).
- `jenkins-deploy.md` — copy+adapt source `~/.claude/skills/jenkins-deploy/` (clean; light adapt).
- `tdd-guide.md` — TDD methodology, written fresh (fold discipline from `~/.claude/agents/tdd-guide.md`); single-leader, no team refs.
- `code-review.md` — review methodology + checklists; invokes `*-reviewer` agents as runtime tools.
- `test-design.md` — lean test-plan design, written fresh (source is team pipeline / empty).
- `test-flow-apifox.md` — lean API-test execution via apifox runtime tools; written fresh (source test-flow is a team pipeline — do NOT copy).

**Native learn:** `skills/glab-flow/learn.md` — capture/apply/upgrade ritual.

**Doc:** `skills/glab-flow/tools.md` — runtime tool dependencies (apifox family, reviewer agents, codegraph, glab, MySQL MCP).

**Wire:** modify `skills/glab-flow/SKILL.md` — point 内容生成 at the 7 sub-skills (concrete), add learn wiring (terminal→upgrade, per-node→capture, start→apply), add learn.md/tools.md references.

**Conventions:** each sub-skill is markdown with frontmatter (`name: glab-flow-<x>`, `description:`). glab-flow-owned, GitLab-native, zero dev-flow/jira-flow/quick-dev-flow references. Outputs land under `<workspace.root>/.glab-flow/<iid>/spec/`. One commit per task.

---

### Task 1: Vendor `git-ops.md` (clean copy + adapt)

**Files:** Create `skills/glab-flow/sub-skills/git-ops.md`

- [ ] **Step 1: Read source + copy**
Read `~/.claude/skills/git-ops/SKILL.md` (and any sibling files in that skill dir). Copy its content into `skills/glab-flow/sub-skills/git-ops.md`.

- [ ] **Step 2: Adapt**
- Frontmatter: `name: glab-flow-git-ops`, `description:` updated to glab-flow context (GitLab-native, used at 开发中 node).
- Remove any dev-flow / jira-flow / quick-dev-flow / Atlassian references (git-ops is clean per scan, but verify).
- Ensure branch naming aligns with glab-flow config (`branch_naming.format`, default `{type}/{iid}`) — if the source hardcodes a Jira-key format, replace with config-driven `{iid}`.
- Add a one-line header note: "glab-flow 自有子 skill（vendor 自 ~/.claude/skills/git-ops）。本节点（开发中）由 Leader Read 本文件内联执行，或 spawn general-purpose 以其为 prompt。"

- [ ] **Step 3: Verify + commit**
```bash
cd /Users/eliojin/IdeaProjects/glab-flow
grep -ni 'dev-flow\|jira-flow\|quick-dev-flow\|atlassian\|/browse/' skills/glab-flow/sub-skills/git-ops.md   # expect 0
git add skills/glab-flow/sub-skills/git-ops.md
git commit -m "feat(sub-skill): vendor git-ops (glab-flow-owned, adapted)"
```

---

### Task 2: Vendor `jenkins-deploy.md` (clean copy + adapt)

**Files:** Create `skills/glab-flow/sub-skills/jenkins-deploy.md`

- [ ] **Step 1: Read source + copy** — `~/.claude/skills/jenkins-deploy/SKILL.md` → `skills/glab-flow/sub-skills/jenkins-deploy.md`.
- [ ] **Step 2: Adapt** — frontmatter `name: glab-flow-jenkins-deploy`; strip any dev-flow/jira refs (source clean, verify); ensure Jenkins params align with glab-flow config (`jenkins.job_name` / `branch_param` / `default_params`); add the glab-flow-owned header note (same template as Task 1).
- [ ] **Step 3: Verify + commit**
```bash
grep -ni 'dev-flow\|jira-flow\|quick-dev-flow' skills/glab-flow/sub-skills/jenkins-deploy.md   # expect 0
git add skills/glab-flow/sub-skills/jenkins-deploy.md
git commit -m "feat(sub-skill): vendor jenkins-deploy (glab-flow-owned, adapted)"
```

---

### Task 3: Vendor `spec-author.md` (copy + heavy adapt)

**Files:** Create `skills/glab-flow/sub-skills/spec-author.md`

- [ ] **Step 1: Read source + copy** — read all files in `~/.claude/skills/spec-author/` (4 files, 142 lines). Consolidate into `skills/glab-flow/sub-skills/spec-author.md` (merge referenced sub-docs inline if the source splits them; keep it one cohesive doc).

- [ ] **Step 2: Adapt (this source has dev-flow coupling — adapt thoroughly)**
- Frontmatter: `name: glab-flow-spec-author`, `description:` glab-flow context.
- **Rewrite all output paths**: `{root_path}/.dev-flow/{issue_key}/spec/proposal.md` → `<workspace.root>/.glab-flow/<iid>/spec/proposal.md`; same for `design.md` and any other spec outputs. (Source line 23-24 hardcode `.dev-flow`.)
- **Strip dev-flow / jira / superpowers / openspec references**: replace `.dev-flow` machinery with glab-flow's; remove Atlassian/Jira transitions; remove `openspec/changes` path mentions or repoint to `.glab-flow/<iid>/spec/`.
- Keep the methodology (六清楚, proposal+design structure, adaptive engineering sections, acceptance-criteria→test mapping) — that's the value being vendored.
- Add the glab-flow-owned header note.

- [ ] **Step 3: Verify + commit**
```bash
grep -ni 'dev-flow\|jira\|superpowers\|openspec\|\.dev-flow\|{issue_key}\|{root_path}' skills/glab-flow/sub-skills/spec-author.md   # expect 0
grep -n '.glab-flow/<iid>/spec' skills/glab-flow/sub-skills/spec-author.md   # expect ≥1
git add skills/glab-flow/sub-skills/spec-author.md
git commit -m "feat(sub-skill): vendor spec-author (rewrite paths to .glab-flow, strip dev-flow)"
```

---

### Task 4: Write `tdd-guide.md` (TDD methodology, fresh + lean)

**Files:** Create `skills/glab-flow/sub-skills/tdd-guide.md`

- [ ] **Step 1: Write** — fresh, single-leader TDD methodology. Read `~/.claude/agents/tdd-guide.md` (250 lines) for discipline content to fold, but DO NOT copy its agent-registration framing. Required sections:
1. Frontmatter `name: glab-flow-tdd-guide`, `description: 开发中节点的 TDD 方法论（RED→GREEN→REFACTOR，测试优先，80%+ 覆盖）。glab-flow 自有，单 Leader 内联执行。`
2. **TDD 三步** — RED (写失败测试) → GREEN (最小实现) → REFACTOR (重构保绿). AAA pattern (Arrange/Act/Assert).
3. **覆盖率** — 80%+；unit/integration/e2e 三类；命名描述行为。
4. **测试证据** — 完成报告必须含三项（命令 / 计数 `Tests: X passed, Y failed, Z skipped` / 失败列表）；不接受口头 pass（对齐 glab-flow Gate 2 精神与 gate.md）。
5. **工具** — 用 codegraph 导航符号（运行时 MCP 依赖，见 tools.md）；语言相关框架（vitest/jest/phpunit/junit/pytest）。
6. **glab-flow 上下文** — 本文件由 Leader 在「开发中」节点 Read 内联执行，或 spawn general-purpose 以其为 prompt；产出代码 + 测试落到对应代码仓；不依赖 dev-loop 团队管道。

- [ ] **Step 2: Verify + commit**
```bash
grep -ni 'dev-flow\|jira\|dev-loop\|create-team' skills/glab-flow/sub-skills/tdd-guide.md   # expect 0
git add skills/glab-flow/sub-skills/tdd-guide.md
git commit -m "feat(sub-skill): add tdd-guide methodology (single-leader, glab-flow-owned)"
```

---

### Task 5: Write `code-review.md` (review methodology + runtime reviewer tools)

**Files:** Create `skills/glab-flow/sub-skills/code-review.md`

- [ ] **Step 1: Write** — review methodology. Required sections:
1. Frontmatter `name: glab-flow-code-review`, `description: 开发中节点代码评审方法论 + 严重度分级；调用 *-reviewer agent（运行时工具）。`
2. **评审维度** — correctness / security / performance / stack-best-practices.
3. **严重度** — CRITICAL(BLOCK) / HIGH(WARN) / MEDIUM(INFO) / LOW(NOTE)（对齐用户 code-review 规则）。
4. **运行时 reviewer 工具** — 按技术栈 spawn 对应只读 reviewer agent（php-reviewer / typescript-reviewer / java-reviewer / security-reviewer / database-reviewer），这些是 `~/.claude/agents/` 下的运行时工具（见 tools.md），非 glab-flow 自带；用 `run_in_background: false` 同步调用拿结果。
5. **通过门槛** — 无 CRITICAL、无未解决 HIGH 才能进 测试中（对齐 gate.md / guards.md）。
6. **glab-flow 上下文** — 单 Leader；评审意见可挂父需求评论或落 spec 文档。

- [ ] **Step 2: Verify + commit**
```bash
grep -ni 'dev-flow\|jira\|create-team' skills/glab-flow/sub-skills/code-review.md   # expect 0
git add skills/glab-flow/sub-skills/code-review.md
git commit -m "feat(sub-skill): add code-review methodology (reviewer agents as runtime tools)"
```

---

### Task 6: Write `test-design.md` (lean test-plan design, fresh)

**Files:** Create `skills/glab-flow/sub-skills/test-design.md`

- [ ] **Step 1: Write** — fresh, lean (source `~/.claude/skills/test-design/` is empty/team-based — write fresh, do NOT copy). Required sections:
1. Frontmatter `name: glab-flow-test-design`, `description: 测试中节点的测试计划设计（用例/范围/验收→测试映射），产出 test-plan.md。`
2. **测试计划产出** — `test-plan.md` → `<workspace.root>/.glab-flow/<iid>/spec/test-plan.md`.
3. **设计要点** — 用例覆盖（unit/integration/e2e）、测试范围、验收标准→测试条目映射、边界/异常用例。
4. **API 测试** — 接口测试委托 apifox 运行时工具（见 test-flow-apifox.md / tools.md）。
5. **glab-flow 上下文** — 单 Leader；测试问题挂父需求评论（G11：阻塞发布问题须全验证才放行）。

- [ ] **Step 2: Verify + commit**
```bash
grep -ni 'dev-flow\|jira\|\.test-flow\|create-team' skills/glab-flow/sub-skills/test-design.md   # expect 0
git add skills/glab-flow/sub-skills/test-design.md
git commit -m "feat(sub-skill): add test-design methodology (lean, single-leader)"
```

---

### Task 7: Write `test-flow-apifox.md` (lean API-test execution, fresh)

**Files:** Create `skills/glab-flow/sub-skills/test-flow-apifox.md`

- [ ] **Step 1: Write** — fresh, lean. NOTE: source `~/.claude/skills/test-flow/` is a 5-stage jira-mode agent-team pipeline (`.test-flow` state, Gates) — **DO NOT copy it** (would violate single-leader D2). Write a lean single-leader API-test sub-skill. Required sections:
1. Frontmatter `name: glab-flow-test-flow-apifox`, `description: 测试中节点的 API 测试执行（经 apifox 运行时工具），收集结果并挂父需求评论。`
2. **执行** — 用 apifox-* 运行时 skill（apifox-test-case / apifox-test-scenario / apifox-test-automation / apifox-cli 等，见 tools.md）跑接口用例。
2. **结果收集** — 通过/失败计数 + 失败用例清单（同 tdd-guide 证据三段式）。
3. **挂评论** — 测试问题评论挂父 GitLab Issue（`glab issue note`），不建 Bug Issue（G13）；阻塞问题全部验证通过才放行待发布（G11）。
4. **glab-flow 上下文** — 单 Leader；不引入 test-flow 的团队/state.json/Gates 管道。

- [ ] **Step 2: Verify + commit**
```bash
grep -ni 'dev-flow\|jira\|\.test-flow\|create-team\|test_key' skills/glab-flow/sub-skills/test-flow-apifox.md   # expect 0
git add skills/glab-flow/sub-skills/test-flow-apifox.md
git commit -m "feat(sub-skill): add test-flow-apifox (lean API-test, no team pipeline)"
```

---

### Task 8: Write `tools.md` (runtime tool dependencies)

**Files:** Create `skills/glab-flow/tools.md`

- [ ] **Step 1: Write** — document the runtime tools glab-flow relies on (not vendored — infrastructure). Required:
1. Frontmatter `name: glab-flow-tools`, `description: glab-flow 运行时工具依赖（非 vendor 的基础设施）。`
2. **声明** — glab-flow vendor 了 OA 方法论（sub-skills/），以下为运行时工具依赖，已装即用、不随 skill 拷贝：
   - `glab` CLI — GitLab 读写（已认证，无 token）。
   - `codegraph` MCP — 符号导航/影响分析（tdd-guide / code-review 使用）。
   - `*-reviewer` agents — php/typescript/java/security/database-reviewer（code-review 按栈调用）。
   - `apifox-*` skills — API 测试（test-flow-apifox 使用）。
   - MySQL MCP — 数据库查验（可选）。
3. **边界说明** — 「完全零外部依赖」= 零外部 *skill/方法论* 依赖；上述工具是基础设施（同 dev-flow 依赖 Atlassian MCP），文档声明即可。

- [ ] **Step 2: Commit**
```bash
git add skills/glab-flow/tools.md
git commit -m "docs(skill): add tools.md (runtime tool dependencies)"
```

---

### Task 9: Write `learn.md` (capture / apply / upgrade loop)

**Files:** Create `skills/glab-flow/learn.md`

- [ ] **Step 1: Write** — native learn loop, "前面只记录，最后升级". Required sections:
1. Frontmatter `name: glab-flow-learn`, `description: glab-flow 自我迭代闭环——每节点 capture，终态 upgrade（distill + 人工审批的 skill 文件编辑），下个 run apply。`
2. **节奏（核心）** — 记录（整个 run，每节点）：capture；升级（终态 已完成/close 后）：upgrade ritual；下个 run 开始：apply（只读）。
3. **capture（每节点）** — Leader 把信号写到 `<workspace.root>/.glab-flow/<iid>/lessons-<HHmm>.jsonl`（每 run 一文件），`state.lessonsCaptured++`。信号：哪个节点卡、哪个护栏触发、证据缺失模式、sub-skill 表现、用户修正。**不 distill、不注入、不改文件。** 每条 lesson 是一行 JSON `{node, signal, detail, at}`。
4. **apply（下个 run 开始，只读）** — 读 `<workspace.root>/.glab-flow/knowledge.md`，挑与当前节点/类型相关条目注入执行上下文。首次无 knowledge → 零开销（返回空）。
5. **upgrade ritual（终态 已完成，close 之后）**:
   1. distill 本 run lessons（+ 历史累积）→ `<workspace.root>/.glab-flow/knowledge.md`。
   2. spawn 临时 curator（general-purpose）视情况**提议**对 `skills/glab-flow/` 下 SKILL.md/nodes.md/guards.md/sub-skills/*.md 的编辑（diff 形式）。
   3. **人工审批后才应用**——绝不自动改 skill 文件。用户否决则只更新 knowledge.md。
6. **手动命令** — `/glab-flow learn <note>` 记一条 manual_note；`/glab-flow learn --upgrade` 终态外手动触发升级。
7. **数据落点** — `knowledge.md`、`<iid>/lessons-*.jsonl` 独立于 state.json；终态删 state 不影响它们。
8. **引擎影响** — 无（learn 是 Leader + markdown，引擎不参与）。

- [ ] **Step 2: Commit**
```bash
git add skills/glab-flow/learn.md
git commit -m "feat(skill): add learn.md (capture/apply/upgrade self-iteration loop)"
```

---

### Task 10: Wire SKILL.md (sub-skills + learn + tools references)

**Files:** Modify `skills/glab-flow/SKILL.md`

- [ ] **Step 1: Read current SKILL.md** (Phase C shipped it; it forward-references `sub-skills/`).

- [ ] **Step 2: Update the `## 内容生成` section** — replace the forward-pointer with concrete sub-skill mapping (one line each, matching the 7 created files):
```
- 需求/方案 → `sub-skills/spec-author.md`
- 开发 → `sub-skills/git-ops.md` / `sub-skills/tdd-guide.md` / `sub-skills/code-review.md`
- 测试 → `sub-skills/test-design.md` / `sub-skills/test-flow-apifox.md`
- 发布 → `sub-skills/jenkins-deploy.md`
- 运行时工具（非 vendor）见 `tools.md`（codegraph / *-reviewer / apifox-* / glab / MySQL MCP）
```

- [ ] **Step 3: Add learn wiring** — in the Leader loop / hard-rules area, add:
- **每节点**：capture lesson（见 `learn.md`），`lessonsCaptured++`。
- **终态（已完成/close 后）**：upgrade ritual（distill + 人工审批的 skill 编辑，见 `learn.md`）。
- **flow 启动**：apply（只读 knowledge.md，见 `learn.md`）。
- Add `learn.md` and `tools.md` to the file's reference list.

- [ ] **Step 4: Verify + commit**
```bash
grep -n 'sub-skills/spec-author\|sub-skills/git-ops\|sub-skills/test-flow-apifox\|learn.md\|tools.md' skills/glab-flow/SKILL.md   # expect hits
ls skills/glab-flow/sub-skills/{spec-author,git-ops,tdd-guide,code-review,test-design,test-flow-apifox,jenkins-deploy}.md skills/glab-flow/{learn,tools}.md   # expect all exist
git add skills/glab-flow/SKILL.md
git commit -m "feat(skill): wire sub-skills + learn loop + tools in SKILL.md"
```

---

### Task 11: Validation gate (Plan 2 done)

**Files:** none (verification only)

- [ ] **Step 1: All sub-skills + learn + tools exist**
```bash
ls skills/glab-flow/sub-skills/{spec-author,git-ops,tdd-guide,code-review,test-design,test-flow-apifox,jenkins-deploy}.md skills/glab-flow/{learn,tools}.md
```
- [ ] **Step 2: Decoupling grep across ALL new files (expect 0)**
```bash
grep -rni 'dev-flow\|jira-flow\|quick-dev-flow\|\.dev-flow\|\.test-flow\|create-team\|/browse/' skills/glab-flow/sub-skills/ skills/glab-flow/learn.md skills/glab-flow/tools.md
```
- [ ] **Step 3: Engine still green (no regression — Plan 2 is markdown-only)**
```bash
pnpm typecheck && pnpm test   # expect 63/63
```
- [ ] **Step 4: SKILL.md references resolve** — every `sub-skills/*.md`, `learn.md`, `tools.md` referenced exists (Step 1 covers it).
- [ ] **Step 5: No commit (verification only)**. Plan 2 complete → ready for final review + merge (user merges only after both plans done).

---

## Self-Review

**Spec coverage (Plan 2 scope = §10 learn, §11 vendor, §5 sub-skills):**
- §5 sub-skills (7 files) → Tasks 1-7.
- §11 vendor boundary (methodology owned, tools runtime) → Tasks 1-7 (vendor/fold) + Task 8 (tools.md documents runtime deps).
- §10 learn (capture/apply/upgrade, "前面记录最后升级", human-approved edits) → Task 9 + Task 10 wiring.
- SKILL.md consistency → Task 10.

**Placeholder scan:** vendor tasks (1-3) specify exact source + concrete adaptations (path rewrites, ref stripping) — not vague. Methodology tasks (4-7, 9) specify required sections + key content. No TBD.

**Consistency:** 7 sub-skill filenames match SKILL.md's existing references (spec-author/git-ops/tdd-guide/code-review/test-design/test-flow-apifox/jenkins-deploy). learn.md is at skill-pack root (not sub-skills/) per spec §5. tools.md documents the runtime deps the methodology sub-skills reference.

**Source-handling note:** test-flow source is a team pipeline (correctly NOT copied → lean fresh); spec-author source has real dev-flow coupling (correctly heavy-adapted); git-ops/jenkins-deploy clean (light copy). This matches the user-confirmed boundary (methodology vendor + runtime tools).

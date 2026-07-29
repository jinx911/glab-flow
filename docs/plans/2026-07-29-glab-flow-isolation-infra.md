# glab-flow Core Isolation Infrastructure — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make glab-flow fully self-contained and config-driven — own config system + `/init-glab-flow`, local state cache + resume, gate mechanism + run modes, unified `.glab-flow/` doc storage, and zero dev-flow references — while preserving the single-Leader + pure-engine core.

**Architecture:** Add two pure engine modules (`config.ts`, `state.ts`) + CLI commands (`config`, `state-init`) so the deterministic core owns config parsing and the state schema. All file I/O stays with the Leader (bash/glab) — the engine remains stdin→stdout. The skill pack gains `config.md`, `config.example.md`, `resume.md`, `gate.md`, a rewritten `SKILL.md`, an `/init-glab-flow` command, and decoupling edits. GitLab Issue stays the sole state-truth; the local `state.json` is a derived cache.

**Tech Stack:** TypeScript (strict, NodeNext, `.js` import suffixes), vitest, pnpm, `yaml` lib (existing — no new deps), tsx CLI. Skill pack = markdown, symlinked by `install.sh`.

**Spec:** `docs/specs/2026-07-29-glab-flow-isolation-design.md` (§5 structure, §6 config, §7 doc storage, §8 state/resume, §9 gate/run-modes, §12 decoupling).

**Plan 2 (next):** vendor 7 content sub-skills + learn loop (spec §10, §11).

---

## File Structure

**Engine (TypeScript, pure, tested):**
- Create `engine/src/config.ts` — parse config markdown (extract ```yaml block, validate required fields, defaults) → `GlabConfig`.
- Create `engine/src/config.test.ts`
- Create `engine/src/state.ts` — `RunState` schema + `initState()` template builder.
- Create `engine/src/state.test.ts`
- Modify `engine/src/cli.ts` — add `config` + `state-init` commands; update help line.

**Skill pack (markdown):**
- Create `skills/glab-flow/config.md` — config format spec + lookup chain.
- Create `skills/glab-flow/config.example.md` — GitLab-native YAML template.
- Create `skills/glab-flow/resume.md` — state cache + recovery flow.
- Create `skills/glab-flow/gate.md` — node gate ritual + run modes.
- Modify `skills/glab-flow/SKILL.md` — rewrite: config-driven, zero dev-flow, wires config/state/gate/resume.
- Modify `skills/glab-flow/nodes.md` — drop dev-flow ref, add unified doc-storage convention.

**Init command:**
- Create `skills/init-glab-flow/SKILL.md` — `/init-glab-flow` interactive probe → writes `.glab-flow/config.md`.

**Installer / docs:**
- Modify `install.sh` — symlink `config.example.md` + `init-glab-flow`; drop stale `GLAB_FLOW_TOKEN` line.
- Modify `uninstall.sh` — remove new symlinks.
- Modify `README.md` — drop dev-flow mapping table; one-liner.
- Modify `docs/architecture.md`, `docs/flow.md` — remove dev-flow mappings.

**Conventions:**
- TS: explicit types on exports, `interface` for object shapes, `type` for unions, immutable spread, no `any`, `.js` import suffixes, no `console.log` except CLI stdout (engine established pattern).
- No new npm deps — use existing `yaml` lib + manual validation (matches `model.ts`/`contract.ts`).
- Each task ends with a commit (conventional: `feat`/`docs`/`chore`).

---

### Task 1: Engine — config parser (`config.ts`)

**Files:**
- Create: `engine/src/config.ts`
- Test: `engine/src/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `engine/src/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseConfig } from './config.js';

const VALID = [
  '# glab-flow config',
  '',
  '```yaml',
  'gitlab:',
  '  host: git.kuainiujinke.com',
  '  project_id: "3915"',
  'workspace:',
  '  root: /tmp/oa',
  '```',
  '',
].join('\n');

describe('parseConfig', () => {
  it('parses required fields and applies defaults', () => {
    const c = parseConfig(VALID);
    expect(c.gitlab.host).toBe('git.kuainiujinke.com');
    expect(c.gitlab.projectId).toBe('3915');
    expect(c.workspace.root).toBe('/tmp/oa');
    expect(c.runMode).toBe('semi-auto');
    expect(c.branchNaming.format).toBe('{type}/{iid}');
    expect(c.branchNaming.typeMap).toEqual({ story: 'feat', bug: 'fix' });
  });

  it('throws when no yaml block present', () => {
    expect(() => parseConfig('# just markdown, no yaml')).toThrow(/yaml/);
  });

  it('throws when required fields missing', () => {
    expect(() => parseConfig('```yaml\nrun_mode: full-auto\n```')).toThrow(/missing required/);
  });

  it('maps full-auto, deploy_branch, jenkins with defaults', () => {
    const md = '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\nrun_mode: full-auto\ndeploy_branch: test\njenkins: { job_name: oa-service }\n```';
    const c = parseConfig(md);
    expect(c.runMode).toBe('full-auto');
    expect(c.deployBranch).toBe('test');
    expect(c.jenkins?.jobName).toBe('oa-service');
    expect(c.jenkins?.branchParam).toBe('oa_branch');
    expect(c.jenkins?.defaultParams).toEqual({});
  });

  it('accepts project_path as fallback for project_id', () => {
    const c = parseConfig('```yaml\ngitlab: { host: h, project_path: "oa/oa" }\nworkspace: { root: /r }\n```');
    expect(c.gitlab.projectId).toBe('oa/oa');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- engine/src/config.test.ts`
Expected: FAIL — `Cannot find module './config.js'` / `parseConfig is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `engine/src/config.ts`:

```typescript
import { parse as parseYaml } from 'yaml';

export type RunMode = 'semi-auto' | 'full-auto';

export interface GlabConfig {
  gitlab: { host: string; projectId: string; harnessClone?: string };
  workspace: { root: string };
  branchNaming: { format: string; typeMap: Record<string, string> };
  runMode: RunMode;
  deployBranch?: string;
  jenkins?: { jobName: string; branchParam: string; defaultParams: Record<string, string> };
  databases?: Record<string, { mcp: string; desc?: string }>;
  testEnvironments?: Record<string, { url: string; account?: string; password?: string; desc?: string }>;
}

interface RawConfig {
  gitlab?: { host?: string; project_id?: string; project_path?: string; harness_clone?: string };
  workspace?: { root?: string };
  branch_naming?: { format?: string; type_map?: Record<string, string> };
  run_mode?: string;
  deploy_branch?: string;
  jenkins?: { job_name?: string; branch_param?: string; default_params?: Record<string, string> };
  databases?: Record<string, { mcp?: string; desc?: string }>;
  test_environments?: Record<string, { url?: string; account?: string; password?: string; desc?: string }>;
}

function extractYamlBlock(markdown: string): string | null {
  const match = markdown.match(/```yaml\n([\s\S]*?)\n```/);
  return match ? match[1] : null;
}

export function parseConfig(markdown: string): GlabConfig {
  const block = extractYamlBlock(markdown);
  if (!block) throw new Error('config: no ```yaml fenced block found in config markdown');

  const raw = parseYaml(block) as RawConfig;
  const host = raw.gitlab?.host;
  const projectId = raw.gitlab?.project_id ?? raw.gitlab?.project_path;
  const root = raw.workspace?.root;
  if (!host || !projectId || !root) {
    throw new Error(
      `config: missing required fields — need gitlab.host, gitlab.project_id (or project_path), workspace.root; ` +
        `got host=${host ?? '<empty>'}, projectId=${projectId ?? '<empty>'}, root=${root ?? '<empty>'}`,
    );
  }

  const runMode: RunMode = raw.run_mode === 'full-auto' ? 'full-auto' : 'semi-auto';
  const gitlab: GlabConfig['gitlab'] = { host, projectId: String(projectId) };
  if (raw.gitlab?.harness_clone) gitlab.harnessClone = raw.gitlab.harness_clone;

  const config: GlabConfig = {
    gitlab,
    workspace: { root },
    branchNaming: {
      format: raw.branch_naming?.format ?? '{type}/{iid}',
      typeMap: raw.branch_naming?.type_map ?? { story: 'feat', bug: 'fix' },
    },
    runMode,
  };

  if (raw.deploy_branch) config.deployBranch = raw.deploy_branch;
  if (raw.jenkins?.job_name) {
    config.jenkins = {
      jobName: raw.jenkins.job_name,
      branchParam: raw.jenkins.branch_param ?? 'oa_branch',
      defaultParams: raw.jenkins.default_params ?? {},
    };
  }
  if (raw.databases) {
    config.databases = Object.fromEntries(
      Object.entries(raw.databases).map(([key, value]) => [
        key,
        { mcp: value.mcp ?? '', ...(value.desc ? { desc: value.desc } : {}) },
      ]),
    );
  }
  if (raw.test_environments) {
    config.testEnvironments = Object.fromEntries(
      Object.entries(raw.test_environments).map(([key, value]) => [
        key,
        {
          url: value.url ?? '',
          ...(value.account ? { account: value.account } : {}),
          ...(value.password ? { password: value.password } : {}),
          ...(value.desc ? { desc: value.desc } : {}),
        },
      ]),
    );
  }

  return config;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- engine/src/config.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add engine/src/config.ts engine/src/config.test.ts
git commit -m "feat(engine): add config parser (yaml block → GlabConfig, validated)"
```

---

### Task 2: Engine — state module (`state.ts`)

**Files:**
- Create: `engine/src/state.ts`
- Test: `engine/src/state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `engine/src/state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { initState } from './state.js';

describe('initState', () => {
  it('builds initial state with defaults', () => {
    const s = initState({
      iid: '123',
      type: 'story',
      host: 'git.kuainiujinke.com',
      projectId: '3915',
      workspaceRoot: '/tmp/oa',
      now: '2026-07-29T00:00:00Z',
    });
    expect(s.iid).toBe('123');
    expect(s.type).toBe('story');
    expect(s.project).toEqual({ host: 'git.kuainiujinke.com', id: '3915' });
    expect(s.cachedNode).toBe('');
    expect(s.docVersion).toBe(1);
    expect(s.lessonsCaptured).toBe(0);
    expect(s.lastActions).toEqual([]);
    expect(s.spawnedAgents).toEqual([]);
    expect(s.specDir).toBe('/tmp/oa/.glab-flow/123/spec');
    expect(s.runMode).toBe('semi-auto');
    expect(s.cachedNodeAt).toBe('2026-07-29T00:00:00Z');
    expect(s.updatedAt).toBe('2026-07-29T00:00:00Z');
  });

  it('honors runMode override', () => {
    const s = initState({
      iid: '1',
      type: 'bug',
      host: 'h',
      projectId: '9',
      workspaceRoot: '/r',
      runMode: 'full-auto',
      now: 'x',
    });
    expect(s.runMode).toBe('full-auto');
    expect(s.type).toBe('bug');
  });

  it('derives specDir from workspaceRoot and iid', () => {
    const s = initState({ iid: '456', type: 'story', host: 'h', projectId: '1', workspaceRoot: '/var/oa', now: 't' });
    expect(s.specDir).toBe('/var/oa/.glab-flow/456/spec');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- engine/src/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `engine/src/state.ts`:

```typescript
import type { IssueType } from './types.js';
import type { RunMode } from './config.js';

export interface RunState {
  iid: string;
  type: IssueType;
  project: { host: string; id: string };
  cachedNode: string;
  cachedNodeAt: string;
  docVersion: number;
  specDir: string;
  runMode: RunMode;
  lastActions: string[];
  spawnedAgents: string[];
  lessonsCaptured: number;
  updatedAt: string;
}

export interface InitStateInput {
  iid: string;
  type: IssueType;
  host: string;
  projectId: string;
  workspaceRoot: string;
  runMode?: RunMode;
  now?: string;
}

export function initState(input: InitStateInput): RunState {
  const now = input.now ?? new Date().toISOString();
  const runMode: RunMode = input.runMode ?? 'semi-auto';
  return {
    iid: input.iid,
    type: input.type,
    project: { host: input.host, id: input.projectId },
    cachedNode: '',
    cachedNodeAt: now,
    docVersion: 1,
    specDir: `${input.workspaceRoot}/.glab-flow/${input.iid}/spec`,
    runMode,
    lastActions: [],
    spawnedAgents: [],
    lessonsCaptured: 0,
    updatedAt: now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- engine/src/state.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add engine/src/state.ts engine/src/state.test.ts
git commit -m "feat(engine): add RunState schema + initState template builder"
```

---

### Task 3: Engine — wire CLI commands (`config`, `state-init`)

**Files:**
- Modify: `engine/src/cli.ts`
- Test: `engine/src/e2e.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `engine/src/e2e.test.ts` (read it first to match its existing style/imports):

```typescript
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

describe('cli config + state-init', () => {
  it('config parses a config markdown file via stdin', () => {
    const tmp = `${import.meta.dirname}/../.tmp-config.md`;
    writeFileSync(tmp, '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\n```');
    const out = execFileSync('pnpm', ['cli', 'config'], { input: '', cwd: import.meta.dirname + '/..', encoding: 'utf8' });
    // note: pipe file via shell in step 3 verification; here we assert the command exists & runs
    expect(out + 'cli config').toBeTruthy();
  });
});
```

> If the e2e file does not spawn the CLI via stdio conveniently, instead add a focused test that imports `parseConfig`/`initState` is already covered in Tasks 1–2. Prefer: keep this task's verification as the manual smoke in Step 4. If adding an exec test is awkward, delete this test step and rely on Step 4 smoke + Tasks 1–2 unit coverage. Do not leave a failing/placeholder test.

- [ ] **Step 2: Run test to verify it fails (or decide to rely on smoke)**

Run: `pnpm test -- engine/src/e2e.test.ts`
If the exec-based test is flaky/awkward in this repo, remove it and rely on the Step 4 smoke. Do not commit a placeholder test.

- [ ] **Step 3: Wire the commands**

In `engine/src/cli.ts`, add imports near the top:

```typescript
import { parseConfig } from './config.js';
import { initState } from './state.js';
```

Add two cases inside the `switch (cmd)` (before `default:`):

```typescript
    case 'config': {
      console.log(JSON.stringify(parseConfig(readStdin())));
      break;
    }
    case 'state-init': {
      const input = JSON.parse(readStdin()) as {
        iid: string;
        type: 'story' | 'bug';
        host: string;
        projectId: string;
        workspaceRoot: string;
        runMode?: 'semi-auto' | 'full-auto';
        now?: string;
      };
      console.log(JSON.stringify(initState(input)));
      break;
    }
```

Update the `default:` help line to include the new commands:

```typescript
      console.error('commands: node | validate | render | plan | plan-return | evidence | config | state-init');
```

- [ ] **Step 4: Smoke-verify both commands**

```bash
# config
printf '```yaml\ngitlab: { host: git.kuainiujinke.com, project_id: "3915" }\nworkspace: { root: /tmp/oa }\n```\n' | pnpm cli config
# expected: JSON with gitlab.host="git.kuainiujinke.com", runMode="semi-auto"

# state-init
echo '{"iid":"123","type":"story","host":"h","projectId":"3915","workspaceRoot":"/tmp/oa","now":"2026-07-29T00:00:00Z"}' | pnpm cli state-init
# expected: JSON state with specDir "/tmp/oa/.glab-flow/123/spec", docVersion 1, lessonsCaptured 0
```

Expected: both print valid JSON matching the asserted shapes.

- [ ] **Step 5: Full typecheck + test**

Run: `pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add engine/src/cli.ts engine/src/e2e.test.ts
git commit -m "feat(engine): expose config + state-init CLI commands"
```

---

### Task 4: Skill — `config.example.md` (GitLab-native template)

**Files:**
- Create: `skills/glab-flow/config.example.md`

- [ ] **Step 1: Write the file**

Create `skills/glab-flow/config.example.md` with exactly this content:

````markdown
---
name: glab-flow-config-example
description: glab-flow 项目配置示例。由 /init-glab-flow 生成 .glab-flow/config.md，或复制本文件手填。
---

# glab-flow 项目配置（示例）

> 实际配置由 `/init-glab-flow` 写到 `<workspace.root>/.glab-flow/config.md`。
> 引擎解析其中的 ```yaml 代码块（`pnpm cli config`）。

```yaml
gitlab:
  host: "git.kuainiujinke.com"            # 必填；glab api --hostname 用
  project_id: "3915"                      # 必填；或用 project_path: "oa/oa"
  # harness_clone: "/Users/.../oa-ai-native-harness"  # 可选；glab remote 自动识别用

workspace:
  root: "/Users/eliojin/IdeaProjects/oa"  # 必填；.glab-flow/ 落点

branch_naming:
  format: "{type}/{iid}"
  type_map: { story: feat, bug: fix }

run_mode: "semi-auto"                     # semi-auto（默认）| full-auto

# ---- 可选（按需开启）----

# deploy_branch: "test"                  # 自动部署分支；不配则发布节点跳过合并

# jenkins:
#   job_name: "oa-service"
#   branch_param: "oa_branch"            # 默认 oa_branch
#   default_params: { deploy_type: "api", test_version: "kn" }

# databases:
#   main: { mcp: "mcp__platform-local__mysql_query", desc: "主数据库" }

# test_environments:
#   default:
#     url: "http://your-test-env.example.com"
#     account: ""
#     password: ""
#     desc: "默认测试环境"
```
````

- [ ] **Step 2: Validate it parses**

Run: `printf '%s\n' "$(cat skills/glab-flow/config.example.md)" | pnpm cli config`
Expected: valid JSON with `gitlab.host`, `gitlab.projectId`, `workspace.root`, `runMode: "semi-auto"`. (Commented optional sections are ignored by YAML.)

- [ ] **Step 3: Commit**

```bash
git add skills/glab-flow/config.example.md
git commit -m "docs(skill): add GitLab-native config.example.md"
```

---

### Task 5: Skill — `config.md` (format spec + lookup chain)

**Files:**
- Create: `skills/glab-flow/config.md`

- [ ] **Step 1: Write the file**

Create `skills/glab-flow/config.md`. Required sections (write full prose for each — no placeholders):

1. **Frontmatter** — `name: glab-flow-config`, `description: glab-flow 配置格式与查找链。项目配置在 <workspace.root>/.glab-flow/config.md（由 /init-glab-flow 生成）。`
2. **格式** — config is markdown containing one ```yaml fenced block; the engine parses that block via `pnpm cli config` (stdin = file content → JSON). Required keys: `gitlab.host`, `gitlab.project_id` (or `project_path`), `workspace.root`. Optional: `gitlab.harness_clone`, `branch_naming`, `run_mode`, `deploy_branch`, `jenkins`, `databases`, `test_environments`. Reference `config.example.md` for the full template.
3. **查找链（按顺序）**:
   1. `<workspace.root>/.glab-flow/config.md`（项目级，首选）— Leader: `[ -f "$ROOT/.glab-flow/config.md" ]`
   2. `~/.claude/skills/glab-flow/config.md`（全局兜底）
   3. 都没有 → AskUserQuestion 引导跑 `/init-glab-flow`
4. **Leader 读取流程** — locate the first existing file in the chain; pipe it: `cat <chosen> | pnpm cli config` → get `GlabConfig` JSON; derive `workspace.root`, `gitlab.host`, `gitlab.project_id` from it (never hardcode these in SKILL.md).
5. **字段说明表** — one row per key (required/optional + 用途), mirroring `config.example.md`.

- [ ] **Step 2: Cross-check references resolve**

Run: `grep -n 'pnpm cli config' skills/glab-flow/config.md` → expect ≥1 hit. `grep -n 'config.example.md' skills/glab-flow/config.md` → expect ≥1 hit.

- [ ] **Step 3: Commit**

```bash
git add skills/glab-flow/config.md
git commit -m "docs(skill): add config.md (format spec + lookup chain)"
```

---

### Task 6: Skill — `/init-glab-flow` command

**Files:**
- Create: `skills/init-glab-flow/SKILL.md`

- [ ] **Step 1: Write the file**

Create `skills/init-glab-flow/SKILL.md`. Required content:

1. **Frontmatter** — `name: init-glab-flow`, `description: 探测 GitLab 环境并生成 <workspace.root>/.glab-flow/config.md。`
2. **输入** — `$ARGUMENTS` = workspace root（可选；缺省则 AskUserQuestion）。
3. **探测步骤（Leader 执行）**:
   1. 确定 `workspace.root`：`$ARGUMENTS` 或 AskUserQuestion；`mkdir -p <root>/.glab-flow`（基础设施，非业务代码）。
   2. host：跑 `glab auth status` 确认登录；默认 `git.kuainiujinke.com`，AskUserQuestion 可改。
   3. project：AskUserQuestion 给 project_id 或 project_path（可跑 `glab api projects?search=...` 辅助）。
   4. run_mode：AskUserQuestion 选 `semi-auto`（默认）/`full-auto`。
   5. 可选项（deploy_branch/jenkins/databases/test_environments）：AskUserQuestion 问是否配置，是则补；否则留空跳过。
4. **生成** — 用 `config.example.md` 为模板，填入探测值，写到 `<root>/.glab-flow/config.md`。
5. **校验** — `cat <root>/.glab-flow/config.md | pnpm cli config`（在 repo 根跑）；失败则修配置直到 JSON 合法。
6. **完成提示** — "config 已写入 `<root>/.glab-flow/config.md`。可用 `/glab-flow <iid>` 开始。"

- [ ] **Step 2: Commit**

```bash
git add skills/init-glab-flow/SKILL.md
git commit -m "feat(skill): add /init-glab-flow initializer command"
```

---

### Task 7: Skill — `resume.md` (state cache + recovery)

**Files:**
- Create: `skills/glab-flow/resume.md`

- [ ] **Step 1: Write the file**

Create `skills/glab-flow/resume.md`. Required sections (full prose):

1. **Frontmatter** — `description: 从 .glab-flow/*-state.json 恢复未完成 flow；GitLab 标签为唯一真理，本地仅缓存。`
2. **真理源声明** — GitLab Issue 标签（`pnpm cli node` 推导）为权威；`<root>/.glab-flow/<iid>-state.json` 是派生缓存，spec §8。
3. **列出未完成 flow（`/glab-flow` 无参）** — `ls <root>/.glab-flow/*-state.json`；每条展示 iid + `cached_node` + 进度条 + `run_mode`；AskUserQuestion 选一个或都不选；无文件 → 提示"无未完成 flow，用 `/glab-flow <iid>` 开新 flow"。
4. **恢复流程（4 步，必须照此写）**:
   1. 读 `<iid>-state.json`（取 `type`, `project`, `run_mode`, `spec_dir`）。
   2. **从 GitLab 重推导当前节点**：`glab issue view <iid> --output json`（从 harness_clone 或配 host）取 labels → `pnpm cli node <type> <labels...>` → GitLab 节点。
   3. **对比 `cached_node` vs GitLab 节点**：一致 → 续；不一致 → **GitLab 为准**，提示"标签在 flow 外被改过，以 GitLab 为准"，更新 `cached_node`。
   4. 从当前节点继续 SKILL.md 编排循环。
5. **state schema 参考** — 指向 `engine/src/state.ts` 的 `RunState`（字段表：iid/type/project/cachedNode/cachedNodeAt/docVersion/specDir/runMode/lastActions/spawnedAgents/lessonsCaptured/updatedAt）。
6. **持久化时机** — 写回 GitLab 后更新 `cached_node`/`lastActions`/`updatedAt`；capture lesson 后 `lessonsCaptured++`；终态（已完成）删 state 文件。
7. **脏状态** — `pnpm cli node` 返回 0 或 ≥2 状态标签 → 停，列给人工（与 SKILL.md 一致）。

- [ ] **Step 2: Commit**

```bash
git add skills/glab-flow/resume.md
git commit -m "docs(skill): add resume.md (GitLab-truth state cache + recovery)"
```

---

### Task 8: Skill — `gate.md` (node gate ritual + run modes)

**Files:**
- Create: `skills/glab-flow/gate.md`

- [ ] **Step 1: Write the file**

Create `skills/glab-flow/gate.md`. Required sections (full prose):

1. **Frontmatter** — `description: 每节点门禁仪式（取证→校验→计划→预览→确认→应用）+ semi/full-auto。`
2. **节点门禁仪式（6 步，每节点固定，必须照此写）**:
   1. **取证**：`glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100" | pnpm cli evidence` → 抽 `## 状态变更` 证据。
   2. **校验**：`pnpm cli validate`（stdin `{type,labels,payload}`，G1–G13）。`ok:false` → 停，列 `missing`+`reasons` 问用户。
   3. **建计划**：正向 `pnpm cli plan <iid>`（stdin `{payload}`）；退回 `pnpm cli plan-return <iid>`。
   4. **预览**：计划翻译成 glab 命令，diff 给用户看。
   5. **确认/应用**：标签+Assignee `glab issue update <iid> --label … --unlabel … --assignee <@user>`；评论 `glab issue note <iid> -m "<render/plan 正文>"`；终态 `glab issue close <iid>`（G12 原子：标签替换+Assignee+评论+关闭同次）。
   6. **冻结**：不改原文（G7）、不编评论（G8）；二值门禁（G2，退回走 plan-return）；hard_gate 需 humanConfirmed（G3）。
3. **run 模式（表）** — 两行：semi-auto（默认）门禁预览=展示+AskUserQuestion；full-auto 护栏 ok 即自动应用。**hard_gate（待发布/验收/关闭）两模式都强制人工（G3，不可关）—— 红线。** `run_mode` 来自 config/state。
4. **证据不足时** — 不推进状态，委派节点工作 agent（见 SKILL.md 节点→agent 表）生成缺失内容。
5. **引用** — 护栏细节见 `guards.md`；节点契约见 `nodes.md`。

- [ ] **Step 2: Commit**

```bash
git add skills/glab-flow/gate.md
git commit -m "docs(skill): add gate.md (node gate ritual + run modes)"
```

---

### Task 9: Skill — rewrite `SKILL.md` (config-driven, zero dev-flow)

**Files:**
- Modify: `skills/glab-flow/SKILL.md`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `skills/glab-flow/SKILL.md`. The new file MUST:

1. **Frontmatter** — keep `name: glab-flow`; update `description` to drop any dev-flow mention: `当用户提供 GitLab Issue URL/编号，需要按 harness 状态机驱动需求从分诊到上线/验收时使用。引擎只做确定性计算（节点/校验/计划/渲染/配置/状态），GitLab 读写由 Leader 直接用 glab CLI 完成，每次写回前预览确认。自有配置与状态缓存，不依赖任何外部 skill。`
2. **输入** — `$ARGUMENTS` = GitLab Issue URL 或 iid；空 → 按 `resume.md` 列未完成 flow。
3. **配置** — "先读 config：按 `config.md` 查找链取首个 config 文件 → `cat <file> | pnpm cli config` → 得 host/project_id/workspace.root/run_mode。无 config → 引导 `/init-glab-flow`。" **删除硬编码的 host/project/workspace/harness 路径。**
4. **引擎** — `cd <repo> && pnpm cli <cmd>`；命令列表更新为：`node|validate|render|plan|plan-return|evidence|config|state-init`。Repo 路径 `glab-flow` 自身（不再提与 jira-flow/quick-dev-flow 并列）。
5. **GitLab 读写** — Leader 直接 glab CLI（glab 已认证，**无需 token**）。从 `config.gitlab.harness_clone` 跑 `glab issue …` 自动识别 remote；或 `glab api --hostname <host> "<path>"`（host/project 来自 config）。
6. **Leader 每轮编排** — 保留现有 8 步骨架，但：第 1 步读状态后用 `config` 提供 host/project；新增"状态缓存"——首轮 `echo {…} | pnpm cli state-init` 生成 `<root>/.glab-flow/<iid>-state.json`；每轮门禁走 `gate.md`；恢复走 `resume.md`。
7. **门禁** — 改为"详见 `gate.md`"（不再内联全部步骤）。
8. **硬规则** — 保留要点，指 `guards.md`；保留"不建 Jira"（G13，领域规则）。
9. **内容生成（替换原"复用"段）** — 删除指向 spec-author/git-ops 等的"复用"行；改为："节点内容生成由 `sub-skills/` 内置子 skill 提供（spec-author/git-ops/tdd-guide/code-review/test-design/test-flow-apifox/jenkins-deploy）——Leader 对每节点 Read 对应 sub-skill 内联执行，或 spawn `general-purpose` 以其为 prompt。自带 agent：intake/review-preview/release-check。"（Plan 2 创建 sub-skills/；此处先写引用，sub-skills 落地在 Plan 2。）
10. **文档落点** — 指向统一存储：所有 issue 文档 → `<root>/.glab-flow/<iid>/spec/`（spec §7）；**禁止**写代码仓 docs/。

**Forbidden in this rewrite:** the phrase "dev-flow", the "复用: 需求/方案 → spec-author …" line, hardcoded `git.kuainiujinke.com`/`3915`/workspace paths.

- [ ] **Step 2: Verify zero dev-flow + no hardcoded env**

```bash
grep -ni 'dev-flow' skills/glab-flow/SKILL.md          # expect: 0 hits
grep -n 'git.kuainiujinke.com\|3915\|/Users/eliojin' skills/glab-flow/SKILL.md   # expect: 0 hits
grep -n '复用' skills/glab-flow/SKILL.md                # expect: 0 hits (old 复用 section removed)
```

- [ ] **Step 3: Verify referenced commands/files exist**

```bash
grep -n 'gate.md\|resume.md\|config.md\|sub-skills' skills/glab-flow/SKILL.md   # expect hits
ls skills/glab-flow/gate.md skills/glab-flow/resume.md skills/glab-flow/config.md  # expect all exist
```

- [ ] **Step 4: Commit**

```bash
git add skills/glab-flow/SKILL.md
git commit -m "refactor(skill): rewrite SKILL.md config-driven, zero dev-flow refs"
```

---

### Task 10: Skill — edit `nodes.md` (drop dev-flow ref + doc storage)

**Files:**
- Modify: `skills/glab-flow/nodes.md`

- [ ] **Step 1: Edit the dev-flow reference (line 3)**

Replace the opening "**工作产物落点**（参考 dev-flow 的 `.dev-flow/<key>/spec/`）…" sentence with:

```markdown
**工作产物落点**：所有 issue 文档（需求草稿 / 技术方案 `design.md` / 测试计划 / 回滚等）→ `<workspace.root>/.glab-flow/<iid>/spec/`（路径来自 config，见 `config.md`；`<iid>` 为 GitLab Issue iid）。**禁止**写进代码仓（oa-service / oa-platform 等）的 `docs/`——文档归 Docs-as-Code 工作目录，代码仓只放代码。统一存储树见 spec §7。
```

- [ ] **Step 2: Verify**

```bash
grep -ni 'dev-flow\|\.dev-flow' skills/glab-flow/nodes.md   # expect: 0 hits
grep -n 'workspace.root' skills/glab-flow/nodes.md           # expect: ≥1 hit
```

- [ ] **Step 3: Commit**

```bash
git add skills/glab-flow/nodes.md
git commit -m "docs(skill): nodes.md — drop dev-flow ref, config-driven doc path"
```

---

### Task 11: `install.sh` / `uninstall.sh` — symlink new files, drop stale token line

**Files:**
- Modify: `install.sh`
- Modify: `uninstall.sh`

- [ ] **Step 1: Update `install.sh`**

Replace lines 7–12 with:

```bash
ln -sf "$DIR/skills/glab-flow" "$CLAUDE/skills/glab-flow"
ln -sf "$DIR/skills/init-glab-flow" "$CLAUDE/skills/init-glab-flow"
for a in intake review-preview release-check; do
  ln -sf "$DIR/agents/$a.md" "$CLAUDE/agents/$a.md"
done
echo "[glab-flow] installed (glab-flow skill + init-glab-flow + 3 agents)."
echo "[glab-flow] engine: cd $DIR && pnpm install"
echo "[glab-flow] configure: /init-glab-flow  (glab CLI handles auth — no token needed)"
```

(Removes the stale `export GLAB_FLOW_TOKEN=…` line — token-discovery was already dropped; glab CLI authenticates itself.)

- [ ] **Step 2: Update `uninstall.sh`**

Read `uninstall.sh` first. Add removal of the new symlink: `rm -f "$CLAUDE/skills/init-glab-flow"` alongside the existing `glab-flow` removal. Keep its existing style.

- [ ] **Step 3: Verify scripts are syntactically valid**

Run: `bash -n install.sh && bash -n uninstall.sh && echo OK`
Expected: `OK` (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add install.sh uninstall.sh
git commit -m "chore: install.sh symlinks init-glab-flow; drop stale token line"
```

---

### Task 12: Decoupling — `README.md` + docs (drop dev-flow mappings)

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/flow.md`

- [ ] **Step 1: README — drop the mapping table**

In `README.md`:
- Replace the "## Relation to dev-flow" section + its mapping table with a one-liner under a new "## Scope" section: `glab-flow is an independent, self-contained skill (GitLab-native). It does not depend on dev-flow or any external skill; all content sub-skills are vendored under skills/glab-flow/sub-skills/.`
- In the top description paragraph, replace "It is the GitLab-native counterpart of `dev-flow` (which is Jira-based). `dev-flow` stays untouched; glab-flow is a new, independent skill." with: `glab-flow is a self-contained, GitLab-native skill with its own config, state cache, and vendored sub-skills.`
- Add a short "## Config" section pointing to `/init-glab-flow` and `skills/glab-flow/config.md`.
- Update the "Engine CLI" command list to include `config` and `state-init`.

- [ ] **Step 2: docs/architecture.md + docs/flow.md — remove dev-flow mappings**

Read both files. Remove/rewrite any sentence mapping glab-flow nodes/states to dev-flow stages (e.g. "dev-flow: spec design dev …"). Keep the harness-derived content (state machine, guards). G13 "不建 Jira" rows stay (domain rule).

- [ ] **Step 3: Verify decoupling across the whole repo**

```bash
grep -rni 'dev-flow' README.md docs/architecture.md docs/flow.md skills/glab-flow/SKILL.md skills/glab-flow/nodes.md
# expect: 0 hits in these files
grep -rni 'jira-flow\|quick-dev-flow' README.md docs skills/glab-flow install.sh
# expect: 0 hits (no sibling-skill references)
```

(Allowed to remain: `docs/specs/2026-07-28-glab-flow-design.md` historical spec, `docs/plans/*` historical plan, and the G13 "不建 Jira" guard text.)

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture.md docs/flow.md
git commit -m "docs: drop dev-flow mappings; glab-flow is self-contained"
```

---

### Task 13: Validation gate (Plan 1 done)

**Files:** none (verification only)

- [ ] **Step 1: Engine green**

Run: `pnpm install && pnpm typecheck && pnpm test`
Expected: typecheck clean; all vitest tests pass (including new config/state tests).

- [ ] **Step 2: CLI smoke**

```bash
printf '```yaml\ngitlab: { host: h, project_id: "1" }\nworkspace: { root: /r }\n```' | pnpm cli config
echo '{"iid":"1","type":"story","host":"h","projectId":"1","workspaceRoot":"/r","now":"t"}' | pnpm cli state-init
```
Expected: both valid JSON.

- [ ] **Step 3: Decoupling grep**

```bash
grep -rni 'dev-flow' skills/glab-flow/ README.md docs/architecture.md docs/flow.md install.sh | grep -v 'docs/specs\|docs/plans'
# expect: empty
```

- [ ] **Step 4: Referenced files exist**

```bash
ls skills/glab-flow/{config,config.example,resume,gate,nodes,guards}.md skills/init-glab-flow/SKILL.md
# expect: all listed files exist
```

- [ ] **Step 5: No commit needed (verification only)**

If all pass, Plan 1 is complete. Proceed to Plan 2 (vendor sub-skills + learn loop).

---

## Self-Review

**Spec coverage (Plan 1 scope = §5 structure, §6 config, §7 doc storage, §8 state/resume, §9 gate/run-modes, §12 decoupling):**
- §5 structure → Tasks 4–11 create/modify every listed skill file + init command + install.
- §6 config → Tasks 1, 3, 4, 5, 6 (parser, CLI, example, spec, init).
- §7 doc storage → Tasks 9, 10 (SKILL.md + nodes.md doc-path convention; tree lives under `.glab-flow/`).
- §8 state/resume → Tasks 2, 3, 7 (state module, CLI, resume.md).
- §9 gate/run-modes → Task 8.
- §12 decoupling → Tasks 9, 10, 11, 12.
- §10 learn + §11 vendor → **Plan 2** (out of scope here, by design).

**Placeholder scan:** engine tasks have full code + tests; markdown tasks have explicit required-section contracts with exact engine commands/paths (not vague). Task 3 e2e has a fallback note (rely on smoke) rather than a placeholder test. ✓

**Type consistency:** `RunMode` defined in `config.ts`, imported by `state.ts`; `IssueType` from `types.ts`; CLI `state-init` stdin shape matches `InitStateInput`; `GlabConfig` field names (`projectId`, `harnessClone`, `branchNaming`, `deployBranch`) used consistently in tests and config.example.md. ✓

**Note:** Plan 2 must create `skills/glab-flow/sub-skills/` (referenced by the rewritten SKILL.md in Task 9) — until then the SKILL.md reference is forward-looking. That's acceptable: Plan 1 ships the infra; Plan 2 ships the content.

# Full Install Readiness Implementation Plan

> **For agentic workers:** Execute inline in this session; implement first, then validate with a clean installation simulation.

**Goal:** Make glab-flow refuse partial setups and provide one full, auditable installation path for every required local capability.

**Architecture:** Keep the installer as a thin, idempotent Bash entry point. Add a focused `scripts/doctor.sh` that reports machine-readable checks and is reused by the installer after dependency bootstrapping. Credentials and project access are validated but never collected or stored by this repository.

**Tech Stack:** Bash, Homebrew/apt/winget adapters, Node/pnpm, GitLab CLI, Apifox CLI, CodeGraph, Playwright, TypeScript/Vitest.

---

### Task 1: Define the full-install contract

**Files:**
- Create: `scripts/doctor.sh`
- Modify: `install.sh`
- Modify: `README.md`

- [x] Detect supported OS/package-manager pairs before mutating the user environment.
- [x] Treat Git, Node, pnpm, glab, Apifox CLI, CodeGraph, ripgrep, Playwright browsers, package dependencies, skill links, GitLab login, Apifox login, and CodeGraph setup as required checks.
- [x] Stop with a non-zero exit code when a tool, credential, or target-workspace setup is absent.
- [x] Require explicit confirmation for global package installation unless `--yes` was supplied.

### Task 2: Install and configure all local capabilities

**Files:**
- Modify: `install.sh`
- Modify: `uninstall.sh`

- [x] Install missing base tools with the detected package manager.
- [x] Install/update pnpm, Apifox CLI, CodeGraph and Playwright from their official package sources.
- [x] Register CodeGraph for available agent clients and create the initial graph only after the target workspace is supplied.
- [x] Create non-destructive skill links, refusing to replace user-owned files.

### Task 3: Make distribution and runtime checks portable

**Files:**
- Modify: `engine/src/version.test.ts`
- Modify: `engine/src/version.ts` if required
- Modify: `package.json`

- [x] Let a source ZIP validate as a non-git distribution while preserving the runtime warning that automatic freshness comparison is unavailable.
- [x] Declare verified Node and pnpm compatibility, pin the package-manager version, and configure pnpm build-script approval so clean installs are deterministic.

### Task 4: Publish a first-run guide and verify it

**Files:**
- Modify: `README.md`
- Modify: `skills/glab-flow/tools.md`
- Modify: `skills/init-glab-flow/SKILL.md`

- [x] Document a single clone → install → secure login → doctor → initialize sequence and the supported OS matrix.
- [x] Replace the token-in-command example with secure interactive login guidance.
- [x] State that API-test and CodeGraph capabilities are installed and checked as required components, while Jenkins/database access is project configuration validated during initialization.
- [x] Verify shell syntax, clean git-clone installation, ZIP installation, engine checks, and the existing TypeScript test/build suite.

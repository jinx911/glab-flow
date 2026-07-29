# glab-flow

Local human-driven Claude skill that drives OA requirements through the `oa-ai-native-harness` GitLab Issue state machine — from triage to release/acceptance — with **deterministic guardrails**, content generation via reused sub-skills, and **preview-confirmed** GitLab writeback.

glab-flow is a self-contained, GitLab-native skill with its own config, state cache, and vendored sub-skills.

## Architecture (pure engine + Leader-driven I/O)

- **Engine** (`engine/`, tested TypeScript): the deterministic **pure-computation** core — state-machine model, guard validator (G1–G13), comment renderer, write-plan builder. **No subprocess, no network, no GitLab client.** stdin → stdout only.
- **Skill pack** (`skills/glab-flow/SKILL.md` + `agents/*.md`): the Leader orchestration that reads/writes GitLab **directly via `glab` CLI**, calls the engine CLI for deterministic decisions, delegates expert agents, previews write plans, confirms, applies.

Seven layers: trigger → rule authority (harness) → state-machine driver → guard/pre-flight (deterministic) → content generation (expert agents) → GitLab integration (Leader via glab, preview-confirm) → persistence (GitLab Issue is truth).

## Install

```bash
./install.sh                                   # symlinks glab-flow + init-glab-flow + 3 agents into ~/.claude
# Requires glab CLI installed + authenticated (no token env needed).
```

## Config

Run `/init-glab-flow <workspace.root>` to generate `.glab-flow/config.md`; format/details in `skills/glab-flow/config.md`.

## Engine CLI (pure: stdin → stdout, no I/O)

```bash
cd /Users/eliojin/IdeaProjects/glab-flow && pnpm cli <cmd>
  node <type> <labels...>                         # -> {"node": "<current>"}
  validate          (stdin {type,labels,payload}) # -> GuardResult
  render            (stdin payload)               # -> harness 状态变更 markdown
  plan <iid>        (stdin {payload})             # -> WritePlan JSON
  plan-return <iid> (stdin {type,from,target,issues,confirmer,date,assigneeUser})
                                                  # -> 退回 WritePlan JSON
  evidence          (stdin [{body}] from `glab api .../notes`)  # -> 抽取的状态变更证据
  config            (stdin {workspace.root})      # -> 读取/生成 .glab-flow/config.md
  state-init <iid>  (stdin {type,labels})         # -> 初始化 .glab-flow/<iid>/ 本地状态
```

All GitLab reads/writes are done by the Leader via `glab` CLI (no token needed).

## Test / typecheck

```bash
pnpm install
pnpm typecheck && pnpm test   # vitest
```

## Project structure

```
engine/state-machine.yaml     # the model (story+bug), derived from harness docs/issue-state-machine.md
engine/src/{types,model,contract,guard,parse,gitlab,render,plan,evidence,cli}.ts   # + *.test.ts
skills/glab-flow/{SKILL,nodes,guards}.md
agents/{intake,review-preview,release-check}.md
install.sh / uninstall.sh
```

## Scope

glab-flow is an independent, self-contained skill (GitLab-native). It does not depend on any external skill; all content sub-skills are vendored under `skills/glab-flow/sub-skills/`.

## Authority

The state machine and AI guardrails are the executable projection of `oa-ai-native-harness`'s `docs/issue-state-machine.md` and `AGENTS.md`. Those docs remain the single source of truth; `engine/src/contract.ts` checks the model against invariants to detect drift.

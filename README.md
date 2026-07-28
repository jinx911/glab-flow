# glab-flow

Local human-driven Claude skill that drives OA requirements through the `oa-ai-native-harness` GitLab Issue state machine — from triage to release/acceptance — with **deterministic guardrails**, content generation via reused sub-skills, and **preview-confirmed** GitLab writeback.

It is the GitLab-native counterpart of `dev-flow` (which is Jira-based). `dev-flow` stays untouched; glab-flow is a new, independent skill.

## Architecture (hybrid)

- **Engine** (`engine/`, tested TypeScript): the deterministic core — state-machine model, guard validator (G1–G13), GitLab client, comment renderer. See `docs/architecture.md`.
- **Skill pack** (`skills/glab-flow/SKILL.md` + `agents/*.md`): the Leader orchestration that reads GitLab, calls the engine CLI, delegates expert agents, previews write plans, confirms, applies.

Seven layers: trigger → rule authority (harness) → state-machine driver → guard/pre-flight (deterministic) → content generation (expert agents) → GitLab integration (preview-confirm) → persistence (GitLab Issue is truth).

## Install

```bash
./install.sh                                   # symlinks skill + 3 agents into ~/.claude
export GLAB_FLOW_TOKEN=<your-gitlab-token>     # required for online ops
# optional:
#   GLAB_FLOW_PROJECT_ID (default 3915 = oa-ai-native-harness)
#   GLAB_FLOW_API        (default https://git.kuainiujinke.com/api/v4)
```

## Engine CLI

```bash
cd /Users/eliojin/IdeaProjects/glab-flow && pnpm cli <cmd>
  node <type> <labels...>                 # -> {"node": "<current>"}
  validate          (stdin {type,labels,payload})  # -> GuardResult
  render            (stdin payload)                # -> harness 状态变更 markdown
  plan <iid>        (stdin {labels,payload})       # -> WritePlan JSON
  apply             (stdin WritePlan)              # validateWritePlan then GitLab API
  resolve-assignee <iid> <role>                    # -> {"user":"@x"} from 交付协同 table
```

## Test / typecheck

```bash
pnpm install
pnpm typecheck && pnpm test   # vitest, 36 tests across 6 files
```

## Project structure

```
engine/state-machine.yaml     # the model (story+bug), derived from harness docs/issue-state-machine.md
engine/src/{types,model,contract,guard,gitlab,render,cli}.ts   # + *.test.ts
skills/glab-flow/{SKILL,nodes,guards}.md
agents/{intake,review-preview,release-check}.md
install.sh / uninstall.sh
```

## Relation to dev-flow

| dev-flow (Jira) | glab-flow (GitLab harness) |
|---|---|
| spec | 草稿中 + 待评审 |
| design | 已评审 (技术方案) |
| dev | 开发中 |
| review-test | 测试中 |
| ship | 待发布 + 生产验收中 + 已完成 |

glab-flow adds (from the harness): triage, three-review separation + node freezing, binary gate with 问题清单 退回, hard_gate release/acceptance, knowledge feedback loop.

## Authority

The state machine and AI guardrails are the executable projection of `oa-ai-native-harness`'s `docs/issue-state-machine.md` and `AGENTS.md`. Those docs remain the single source of truth; `engine/src/contract.ts` checks the model against invariants to detect drift.

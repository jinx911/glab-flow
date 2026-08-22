# glab-flow

Local human-driven Claude skill that drives OA requirements through the `oa-ai-native-harness` GitLab Issue state machine — from triage to release/acceptance — with **deterministic guardrails**, content generation via reused sub-skills, and **preview-confirmed** GitLab writeback.

glab-flow is a self-contained, GitLab-native skill with its own config, state cache, and vendored sub-skills.

## Architecture (pure engine + Leader-driven I/O)

- **Engine** (`engine/`, tested TypeScript): the deterministic **pure-computation** core — state-machine model, guard validator (G1–G14), comment renderer, write-plan builder. **No subprocess, no network, no GitLab client.** stdin → stdout only.
- **Skill pack** (`skills/glab-flow/SKILL.md` + `agents/*.md`): the Leader orchestration that reads/writes GitLab **directly via `glab` CLI**, calls the engine CLI for deterministic decisions, delegates expert agents, previews write plans, confirms, applies.

Seven layers: trigger → rule authority (harness) → state-machine driver → guard/pre-flight (deterministic) → content generation (expert agents) → GitLab integration (Leader via glab, preview-confirm) → persistence (GitLab Issue is truth).

## Install

```bash
./install.sh        # symlinks glab-flow + init-glab-flow into ~/.claude AND ~/.codex
                    # (Claude Code + Codex 双端; symlink 指向本仓库,master 更新即双端生效,无需重装)
# Requires glab CLI installed + authenticated (no token env needed).
# 接口测试另需: npm i -g apifox-cli && apifox login --with-token <token>
```

## Config (两份,职责分离)

Run `/init-glab-flow <workspace.root>` — 一次性探测生成：

| 文件 | 职责 |
|---|---|
| `.glab-flow/config.md` | **交付流程**：GitLab host/projectId、分支命名、run_mode、Jenkins、数据库索引 |
| `.glab-flow/test-config.md` | **测试配置**：Apifox 项目路由（改动仓库→项目）、环境 ID 索引、凭据变量名、测试数据策略、共用登录契约 |
| `.glab-flow/apifox-vars.json` | **环境参数值**（CLI `--variables` 消费）：凭据/前缀按环境条目存，`-e` 切环境自动跟随 |

格式详见 `skills/glab-flow/config.md` / `test-config.example.md`。

## 测试执行体系（已定型,合同花名册需求全链路实测）

**双跑铁律**：自测（开发中）与测试环境测试（测试中）都必须包含接口测试 + E2E，只跑接口不算完成。

```bash
# 一套场景/套件跑双环境——只换 -e,场景/断言零改动
apifox test-suite run <suiteId> --project <pid> \
  -e <envId> --variables .glab-flow/apifox-vars.json \
  -d <testDataId> \                    # 矩阵场景才加:云端数据集一行一轮迭代
  --carry-runtime-variables --upload-report detail \
  --reporters cli,json --out-dir <dir>
```

- **参数三轴口诀**：随环境轴变（每环境一值）→ apifox-vars.json；随轮次轴变（同环境 N 值）→ 云端数据集 `-d`；不变 → 写死 case。
- ⚠️ CLI 环境变量坑：Apifox 环境 UI / `environment update` 写的变量 CLI 运行时**取不到**——只认 `--variables` 文件（实测三轮坐实）。
- **产物落点**：所有产出按 `.glab-flow/<iid>/` 归位（spec / e2e / fixtures / archive）；工作区根的 `playwright-report/`、`test-results/` 是临时执行位，报告进 Issue 评论后立即清理。
- **测试计划**：`test-plan.md` 必含「测试环境与数据集」章节（环境矩阵 + 场景↔数据集映射表 + fixture 顺序）——执行时 `-d` 传什么一目了然。
- **证据门禁**：执行后 `test-report get` 回读 environmentName + stats，禁止只凭 CLI stdout 说通过。

## Engine CLI (pure: stdin → stdout, no I/O)

```bash
cd <glab-flow repo> && pnpm cli <cmd>   # skill 运行时经 ENGINE_ROOT 解析，见 SKILL.md「引擎与命令」
  node <type> <labels...>                         # -> {"node": "<current>"}
  validate          (stdin {type,labels,payload}) # -> GuardResult
  render            (stdin payload)               # -> harness 状态变更 markdown
  plan <iid>        (stdin {payload})             # -> WritePlan JSON
  plan-return <iid> (stdin {type,from,target,issues,confirmer,date,assigneeUser})
                                                  # -> 退回 WritePlan JSON
  evidence          (stdin [{body}] from `glab api .../notes`)  # -> 抽取的状态变更证据
  config            (stdin = config markdown 文件内容)                      # -> GlabConfig JSON（Leader: cat <config.md> | pnpm cli config）
  test-config       (--repos a,b --env local [--iid N]; stdin = test-config.md)  # -> TestContext JSON（apifoxTargets/envId/凭据变量/数据库,配置送到脸上）
  state-init        (stdin {iid,type,host,projectId,workspaceRoot,runMode?,now?})  # -> RunState JSON（Leader 写到 .glab-flow/*-state.json）
```

All GitLab reads/writes are done by the Leader via `glab` CLI (no token needed).

## Test / typecheck / build

```bash
pnpm install
pnpm typecheck && pnpm test   # vitest
pnpm build                    # tsc → engine/dist（可选；用 node engine/dist/cli.js 省去 tsx 冷启动）
```

## Project structure

```
engine/state-machine.yaml     # the model (story+bug), derived from harness docs/issue-state-machine.md
engine/src/{types,model,contract,guard,parse,gitlab,render,plan,evidence,test-config,cli}.ts   # + *.test.ts
skills/glab-flow/{SKILL,config,config.example,test-config.example,nodes,guards,gate,resume,learn,tools}.md
skills/glab-flow/sub-skills/*.md    # 含 test-design / test-flow-apifox / test-flow-e2e (测试三件套)
agents/{intake,review-preview,release-check}.md
install.sh / uninstall.sh     # 双端安装 (~/.claude + ~/.codex)
```

## Scope

glab-flow is an independent, self-contained skill (GitLab-native). It does not depend on any external skill; all content sub-skills are vendored under `skills/glab-flow/sub-skills/`.

## Memory hygiene

Reusable glab-flow lessons belong in versioned docs/tests/skill files after they are generalized and verified. Run-specific observations stay in `<workspace.root>/.glab-flow/<iid>/lessons-*.jsonl` or external memory until they are distilled; do not copy issue-specific details into reusable project docs.

## Authority

The state machine and AI guardrails are the executable projection of `oa-ai-native-harness`'s `docs/issue-state-machine.md` and `AGENTS.md`. Those docs remain the single source of truth; `engine/src/contract.ts` checks the model against invariants to detect drift.

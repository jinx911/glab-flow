# glab-flow

> 让 AI 推进需求，不绕过交付流程。先看 [项目介绍页](index.html) 了解完整流程、变更闭环与多环境证据链。

glab-flow 是由人主导的 Claude Code / Codex 技能包，依据项目级 GitLab Issue 状态机推进需求：从分诊到发布、验收，以**确定性护栏**约束流程，复用子技能生成内容，并以“预览—确认”方式写回 GitLab。

它是自包含、GitLab 原生的技能包，内置配置、状态缓存和随仓库维护的子技能。

## 架构（纯引擎 + Leader 负责 I/O）

- **引擎**（`engine/`，有 TypeScript 测试）：确定性的**纯计算**核心——状态机模型、护栏校验器（G1–G16）、评论渲染器和写回计划构建器。**不启动子进程、不访问网络、不调用 GitLab 客户端**，只接受标准输入并输出标准输出。
- **技能包**（`skills/glab-flow/SKILL.md` + `agents/*.md`）：由 Leader 编排，直接通过 `glab` CLI 读写 GitLab，调用引擎 CLI 作确定性决策，委托专家 Agent，预览、确认后再应用写回。

共七层：触发 → 规则权威（Harness）→ 状态机驱动 → 确定性护栏/预检 → 内容生成（专家 Agent）→ GitLab 集成（Leader 经 `glab` 预览确认）→ 持久化（GitLab Issue 是事实源）。

## 完整安装（未通过即禁止使用）

glab-flow 不支持“只装一部分先跑”的模式。安装成功必须同时具备 Git、Node.js 20+、pnpm 10.33.0、GitLab CLI、Apifox CLI、CodeGraph、ripgrep、Playwright Chromium、Claude Code/Codex 技能链接，以及 GitLab/Apifox 授权和目标业务工作区的 CodeGraph 索引。

支持 macOS（Homebrew）、Ubuntu/Debian（apt）和 Windows（winget）。安装器会展示将执行的全局安装操作；传 `--yes` 才会跳过确认。它不会读取、打印或保存 GitLab/Apifox Token。

```bash
# 推荐：从 Git 仓库克隆开始。<business-workspace> 是被 glab-flow 推进需求的业务仓库，
# 不要填本 glab-flow 仓库。
git clone https://github.com/jinx911/glab-flow.git
cd glab-flow
./install.sh --workspace /absolute/path/to/business-workspace

# Windows PowerShell
# 请先启用 Windows 开发者模式，或以管理员身份打开 PowerShell（安装器需要创建技能符号链接）。
.\install.ps1 -Workspace C:\path\to\business-workspace
```

首次只有 GitHub 源码 ZIP 也可以执行 `install.sh`：脚本会先安装 Git，再把自身迁移到 `~/.local/share/glab-flow` 的官方 Git checkout，确保后续版本守卫和更新可用。

安装结束必须看到 `doctor` 的“全部能力、授权与工作区索引均已就绪”。任何 `FAIL` 都表示完整流程不能启动。可随时复查：

```bash
scripts/doctor.sh --workspace /absolute/path/to/business-workspace
# Windows: .\scripts\doctor.ps1 -Workspace C:\path\to\business-workspace
```

之后在 Claude Code 或 Codex 新开会话执行：

```text
/init-glab-flow /absolute/path/to/business-workspace
```

## 配置（两份，职责分离）

运行 `/init-glab-flow <workspace.root>`，一次性探测并生成：

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
- **四层环境事实**：测试计划环境、CLI 显式 `-e` 目标、报告 `environmentName`、Apifox 页面列表展示必须分别记录并核对；页面显示 local、报告为 Stage 不能通过资产审计。
- **共用认证**：每个角色使用 AuthProfile 的登录引导和后置临时 token 提取；业务接口统一引用鉴权变量，账号、密码和 token 值不进入 Apifox 资产、Issue 或报告。

## 引擎 CLI（纯计算：标准输入 → 标准输出，无 I/O）

```bash
cd <glab-flow repo> && pnpm cli <cmd>   # skill 运行时经 ENGINE_ROOT 解析，见 SKILL.md「引擎与命令」
  node <type> <labels...>                         # -> {"node": "<current>"}
  validate          (stdin {type,labels,payload}) # -> GuardResult
  render            (stdin payload)               # -> harness 状态变更 markdown
  plan <iid>        (stdin {payload})             # -> WritePlan JSON
  plan-return <iid> (stdin {type,from,target,issues,confirmer,date,assigneeUser})
                                                  # -> 退回 WritePlan JSON
  change-impact  (stdin {iid,type,currentNode,changeId,proposer,changeDate,source,reason,scopes,testPlan?})
                                                  # -> open 变更影响单 + 受影响产物/建议回退节点
  change-close   (stdin {iid,changeId,closer,closeDate,notes,completed,testPlan?})
                                                  # -> closed 变更回执；测试计划受影响时校验版本递增
  evidence          (stdin [{body}] from `glab api .../notes`)  # -> 抽取的状态变更证据
  config            (stdin = config markdown 文件内容)                      # -> GlabConfig JSON（Leader: cat <config.md> | pnpm cli config）
  test-config       (--repos a,b --env local [--iid N]; stdin = test-config.md)  # -> TestContext JSON（apifoxTargets/envId/凭据变量/数据库,配置送到脸上）
  state-init        (stdin {iid,type,host,projectId,workspaceRoot,runMode?,now?})  # -> RunState JSON（Leader 写到 .glab-flow/*-state.json）
```

全部 GitLab 读写均由 Leader 通过已登录的 `glab` CLI 完成，无需在命令或环境变量中配置 Token。

## 变更闭环

需求、技术方案、实现或测试中发现错误时，先用 `change-impact` 写入不可变的 open 影响单；它会推导必须同步的 proposal、design、测试计划、Apifox 资产、环境重测、排期或发布材料。open 单存在时 G16 阻断正向状态流转。完成所有受影响项后，以刚回读的 Issue notes 调 `change-close`；若测试计划被影响，`plan-version` 必须递增，旧 local/test 证据会自动失效。

## 测试、类型检查与构建

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test   # vitest
pnpm build                    # tsc → engine/dist（可选；用 node engine/dist/cli.js 省去 tsx 冷启动）
```

## 项目结构

```
engine/state-machine.yaml     # 状态机模型（story+bug），来源为 Harness 的 docs/issue-state-machine.md
engine/src/{types,model,contract,guard,parse,gitlab,render,plan,evidence,test-config,cli}.ts   # + *.test.ts
skills/glab-flow/{SKILL,config,config.example,test-config.example,nodes,guards,gate,resume,learn,tools}.md
skills/glab-flow/sub-skills/*.md    # 含 test-design / test-flow-apifox / test-flow-e2e (测试三件套)
agents/{intake,review-preview,release-check}.md
install.sh / uninstall.sh     # 双端安装 (~/.claude + ~/.codex)
```

## 项目边界

glab-flow 是独立、自包含、GitLab 原生的技能包。它不依赖外部技能；所有内容类子技能均随仓库维护在 `skills/glab-flow/sub-skills/`。

## 开源信息

- License: [MIT](LICENSE)
- 项目流程与产品介绍：[index.html](index.html)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)

## 经验沉淀边界

可复用的 glab-flow 经验须经抽象和验证后，沉淀到受版本控制的文档、测试或技能文件中。一次运行的观察先保留在 `<workspace.root>/.glab-flow/<iid>/lessons-*.jsonl` 或外部记忆，完成蒸馏前不得把 Issue 专有细节复制进可复用项目文档。

## 规则权威

目标项目的状态机规则与团队交付规范是业务规则权威。glab-flow 将已确认的规则配置为 `engine/state-machine.yaml`、项目配置和技能文档中的可执行护栏；`engine/src/contract.ts` 通过不变量校验模型，以发现规则实现漂移。

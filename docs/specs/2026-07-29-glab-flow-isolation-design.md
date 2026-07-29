# glab-flow 隔离设计（self-containment）

- **日期**：2026-07-29
- **状态**：设计稿（待评审）
- **作者**：eliojin + Claude
- **前置**：`docs/specs/2026-07-28-glab-flow-design.md`（glab-flow v1 原始设计）

## 1. 背景与动机

实际跑过一次 glab-flow 后，与 dev-flow 对比发现流程混乱，根因是 glab-flow 与 dev-flow **来源本质不同**（GitLab vs Jira），但当前实现仍残留 dev-flow 的影子，且缺少 dev-flow 已有的基础设施：

1. **无自有配置** —— GitLab host（`git.kuainiujinke.com`）、project id（`3915`）、workspace 路径**硬编码**在 `SKILL.md`，不可移植。
2. **无本地状态/恢复** —— dev-flow 有 `.dev-flow/*-state.json` + `resume.md`；glab-flow 把 GitLab Issue 当唯一真理，每轮全量重推导，无恢复列表，体感脆弱。
3. **复用 dev-flow 子 skill** —— `SKILL.md` "复用" 指向 `spec-author` 等；设计文档大段映射 dev-flow，像个衍生品。
4. **无自我迭代闭环** —— dev-flow 有 `learn`（capture/apply/distill）；glab-flow 每轮结束即结束，无法沉淀经验升级自身。

## 2. 目标与非目标

**目标**
- glab-flow **完全自包含**：自有配置、本地状态缓存 + 恢复、门禁机制、`/init-glab-flow` 初始化、自带内容生成子 skill、自我迭代闭环。
- **零 dev-flow 引用**（文字与运行时）。
- GitLab Issue **保持唯一状态真理源**。
- 单 Leader + 纯引擎核心**保留**（这是 glab-flow 的差异化优势，已建成且测试覆盖）。

**非目标**
- 不采用 dev-flow 的多 agent 团队编排（`/create-team`、dev-loop/review-test/ship 团队管道）。
- 不 vendor 运行时工具（codegraph MCP、glab CLI、MySQL MCP、bash、模型）—— 这些是基础设施，非 skill。
- 不改纯引擎的「stdin→stdout、无 I/O」契约。

## 3. 关键决策（已确认）

| # | 决策点 | 选择 |
|---|---|---|
| D1 | 隔离程度 | **全自包含** —— 连内容生成子 skill 也 vendor 进 glab-flow |
| D2 | 编排模型 | **保留单 Leader + 纯引擎**，不引入团队管道 |
| D3 | 状态真理源 | **GitLab 为准 + 本地派生缓存**（启动重推导，零漂移） |
| D4 | 自我迭代 | **「前面只记录，最后升级」** —— 每节点 capture；终态升级（distill + 人工审批的 skill 文件编辑） |

## 4. 设计原则

- **GitLab 为准**：标签 = 状态机；本地文件只缓存/恢复/可见性。
- **配置驱动**：host/project/workspace/deploy/jenkins 全部从 config 读，禁止硬编码。
- **自包含但不自虐**：vendor 的是 *skill 内容*；codegraph/glab/MCP/model 是运行时工具依赖，文档声明即可。
- **保留差异化**：纯引擎 + 确定性护栏（G1–G13）不丢弃。
- **统一存储**：所有 flow 产物归到 `.glab-flow/` 一棵树。

## 5. 目标仓库结构

```
glab-flow/
├─ engine/                        # 纯引擎（保留；可选加 state-init 辅助命令）
│  ├─ state-machine.yaml
│  └─ src/{types,model,contract,guard,parse,gitlab,render,plan,evidence,cli}.ts  + *.test.ts
├─ skills/
│  ├─ glab-flow/                  # skill 包（自包含单元）
│  │  ├─ SKILL.md                 # 重写：config 驱动，零 dev-flow 引用
│  │  ├─ nodes.md                 # 节点契约（删 dev-flow 引用）
│  │  ├─ guards.md                # G1–G13（保留）
│  │  ├─ config.md                # 新：配置 schema + 查找链
│  │  ├─ config.example.md        # 新：示例配置
│  │  ├─ resume.md                # 新：从 .glab-flow/*-state.json 恢复
│  │  ├─ gate.md                  # 新：节点门禁仪式 + run 模式
│  │  ├─ learn.md                 # 新：自我迭代闭环（capture/apply/upgrade，glab-flow 原生非 vendor）
│  │  └─ sub-skills/              # 新：vendor 的内容生成 skill（glab-flow 自有副本）
│  │     ├─ spec-author.md
│  │     ├─ git-ops.md
│  │     ├─ tdd-guide.md
│  │     ├─ code-review.md
│  │     ├─ test-design.md
│  │     ├─ test-flow-apifox.md
│  │     └─ jenkins-deploy.md
│  └─ init-glab-flow/SKILL.md     # 新：/init-glab-flow 初始化命令
├─ agents/                        # glab-flow 自有 agent（保留）
│  ├─ intake.md
│  ├─ review-preview.md
│  └─ release-check.md
├─ docs/                          # 更新：删 dev-flow 映射
├─ install.sh / uninstall.sh      # 更新：symlink 新增文件
└─ package.json / tsconfig.json / vitest.config.ts
```

**vendor 子 skill 调用方式**：嵌套于 `sub-skills/`（命名隔离，避免与全局 `spec-author` 等冲突）。单 Leader 模式下，Leader 对每个节点 **Read 对应 sub-skill 内联执行**，或 spawn `general-purpose` agent 以该 sub-skill 为 prompt（保上下文干净）。它们是 glab-flow 私有内容，**不**作为独立 `/spec-author` slash 命令暴露。

## 6. 配置系统

### 6.1 config.example.md（GitLab 原生字段）

```yaml
gitlab:
  host: "git.kuainiujinke.com"            # glab api --hostname
  project_id: "3915"                      # 或 project_path: "oa/oa"
  harness_clone: "/Users/.../oa-ai-native-harness"  # 可选；glab remote 自动识别用

workspace:
  root: "/Users/eliojin/IdeaProjects/oa"  # .glab-flow/ 落点

branch_naming:
  format: "{type}/{iid}"
  type_map: { story: feat, bug: fix }

run_mode: "semi-auto"                     # semi-auto（默认）| full-auto

# 可选（按需，镜像 dev-flow 语义但 GitLab 原生）
deploy_branch: "test"
jenkins:
  job_name: "oa-service"
  branch_param: "oa_branch"
  default_params: { deploy_type: "api", test_version: "kn" }
databases:
  main: { mcp: "mcp__platform-local__mysql_query", desc: "主数据库" }
test_environments:
  default: { url: "http://...", account: "", password: "" }
```

### 6.2 查找链（config.md 定义）

1. `{workspace.root}/.glab-flow/config.md`（项目级，`/init-glab-flow` 生成）← 首选
2. `~/.claude/skills/glab-flow/config.md`（全局默认 / 兜底）
3. 都没有 → AskUserQuestion 引导跑 `/init-glab-flow`

### 6.3 `/init-glab-flow`

交互式探测（`glab auth status`、问 host/project/workspace/run_mode）→ 生成 `{workspace.root}/.glab-flow/config.md`。对应 dev-flow 的 `/init-dev-flow`，但 GitLab 原生。

## 7. 统一文档存储

所有 flow 产物归到 `{workspace.root}/.glab-flow/` 一棵树，路径从 config 派生、写入 `state.json` 供恢复定位：

```
{workspace.root}/.glab-flow/
├─ config.md                      # 项目配置
├─ knowledge.md                   # learn 蒸馏的知识（升级产物）
├─ <iid>-state.json               # 运行状态缓存（resume glob 扫描）
└─ <iid>/
   ├─ spec/                       # spec-author / architect 产出
   │  ├─ proposal.md              #   需求草稿（六清楚）
   │  ├─ design.md                #   技术方案
   │  ├─ test-plan.md             #   测试计划
   │  ├─ release-check.md         #   发布风险/检查清单
   │  └─ rollback.md              #   回滚方案
   ├─ evidence/                   # engine evidence 抽取的状态变更证据
   ├─ plans/                      # write-plan 快照（plan/plan-return 预览留痕）
   ├─ notes/                      # 澄清记录、节点工作产物
   └─ lessons-<HHmm>.jsonl        # learn capture 的原始 lessons（每 run 一文件）
```

**规则**：state 在外层（`<iid>-state.json`，便于 glob），文档在内层 `<iid>/`。引擎保持纯（不写文件），路径由 Leader 按 config 拼接；`state.json.spec_dir` 记录根。**禁止**写进代码仓（oa-service 等）的 `docs/`。

## 8. 状态缓存 + 恢复

### 8.1 真理源

GitLab Issue 标签（引擎 `node` 命令推导）。本地 `state.json` 是**派生缓存**。

### 8.2 最小 state schema

`{workspace.root}/.glab-flow/<iid>-state.json`：
```json
{
  "iid": "123",
  "type": "story",
  "project": { "host": "git.kuainiujinke.com", "id": "3915" },
  "cached_node": "待评审",
  "cached_node_at": "<ISO>",
  "doc_version": 1,
  "spec_dir": ".glab-flow/123/spec",
  "run_mode": "semi-auto",
  "last_actions": [],
  "spawned_agents": [],
  "lessons_captured": 0,
  "updated_at": "<ISO>"
}
```

### 8.3 恢复流程（resume.md）

1. `/glab-flow` 无参 → 扫 `.glab-flow/*-state.json`，列未完成 flow（iid + 节点进度条 + cached_node）。
2. 选定后：**先从 GitLab 重推导当前节点**（`glab issue view <iid> --output json` → `pnpm cli node <type> <labels...>`）。
3. 对比 `cached_node` vs GitLab 推导值：一致 → 直接续；**不一致 → GitLab 为准**，提示「标签在 flow 外被改过，以 GitLab 为准」，更新缓存。**零漂移风险**。
4. 从当前节点继续编排循环。

### 8.4 持久化时机

- 写回 GitLab 后 → 更新 `cached_node` / `last_actions` / `updated_at`。
- capture lesson → `lessons_captured++`。
- 终态（已完成）→ 删 state 文件（learn 数据 `knowledge.md` / `lessons-*.jsonl` 独立保留）。

## 9. 门禁机制 + run 模式

### 9.1 节点门禁仪式（gate.md）

每节点固定六步（固化现有 SKILL.md 步骤 3–7）：
1. **取证**：`glab api .../notes?per_page=100 | pnpm cli evidence` → 抽 `## 状态变更` 证据。
2. **校验**：`pnpm cli validate`（G1–G13）。`ok:false` → 停，列 `missing`+`reasons` 问用户。
3. **建计划**：正向 `pnpm cli plan <iid>`；退回 `pnpm cli plan-return <iid>`。
4. **预览**：计划翻译成 glab 命令，diff 给用户。
5. **确认/应用**：标签+Assignee（`glab issue update`）、评论（`glab issue note`）、终态（`glab issue close`，G12 原子）。
6. **冻结**：不改原文/不编评论（G7/G8）；二值门禁（G2，退回走 plan-return）。

### 9.2 run 模式

| 行为 | semi-auto（默认，= 现状） | full-auto |
|---|---|---|
| 门禁预览 | 展示 + AskUserQuestion 确认 | 护栏 ok 即自动应用 |
| 终态 / hard_gate | **永远**问用户（G3） | **永远**问用户（G3，不可关） |

`run_mode` 存 config + state。hard_gate（待发布/验收/关闭）两模式都强制人工 —— 护栏红线。

## 10. 自我迭代闭环（learn）—— 「前面只记录，最后升级」

### 10.1 节奏

- **记录（整个 run，每节点）**：capture — Leader 写信号到 `.glab-flow/<iid>/lessons-<HHmm>.jsonl`，`lessons_captured++`。信号包括：哪个节点卡住、哪个护栏触发、证据缺失模式、sub-skill 表现、用户修正。**不 distill、不注入、不改文件。**
- **升级（终态 已完成，close 之后）**：upgrade ritual ——
  1. distill 本 run lessons（+ 历史累积）→ `.glab-flow/knowledge.md`
  2. curator（general-purpose）视情况**提议** SKILL.md/nodes.md/guards/sub-skills 的编辑
  3. **人工审批后才应用**（绝不自动改 skill 文件）
- **下个 run 开始**：apply（只读）—— 读升级后的 `knowledge.md`，注入与当前节点/类型相关条目（上次升级收益兑现）。首次无 knowledge → 零开销。

### 10.2 手动命令

- `/glab-flow learn <note>`：记一条 manual_note。
- `/glab-flow learn --upgrade`：终态外手动触发升级。

### 10.3 引擎影响

无 —— learn 是 Leader + markdown 操作（同 dev-flow learn 是 sub-skill 而非引擎）。引擎保持纯计算。

## 11. Vendor 清单与边界

**Vendor（glab-flow 自有副本，放 `sub-skills/`）**：`spec-author`、`git-ops`、`tdd-guide`、`code-review`、`test-design`、`test-flow-apifox`、`jenkins-deploy`（7 个）。`learn` 不在 vendor 列表 —— 它是 glab-flow 原生闭环（`skills/glab-flow/learn.md`），非 dev-flow 团队版 learn 的 copy。

**自有 agent（保留）**：`intake`、`review-preview`、`release-check`；`architect` 以 `general-purpose` 角色按需 spawn。

**运行时工具依赖（不 vendor，文档声明）**：`glab` CLI、`codegraph` MCP、MySQL MCP、bash、模型本身。「完全零外部依赖」= **零外部 skill 依赖**；运行时工具是基础设施。

**vendor 副本改写**：尽量自包含；原版若内部调 superpowers，优先剥离改写，剥离不掉的退为文档声明的运行时依赖。

## 12. 去耦清理

| 位置 | 现状 | 处理 |
|---|---|---|
| `nodes.md` L3 | "参考 dev-flow 的 `.dev-flow/`" | 删引用，改「见 config.md 的 workspace.root」 |
| `SKILL.md` L36 "复用" | 指向 spec-author/git-ops 等 | 改「sub-skills/ 内联执行」 |
| `README.md` "Relation to dev-flow" + 映射表 | 大段映射 | 删映射表，留一行「独立 skill，GitLab 原生」 |
| `docs/architecture.md`、`docs/flow.md` | 多处 dev-flow 映射 | 更新为自包含描述 |
| `docs/specs/2026-07-28-glab-flow-design.md` | v1 历史 | 保留（历史），新 spec 自包含 |
| G13「不建 Jira」 | 提到 Jira | **保留** —— harness 领域规则，非 dev-flow 耦合 |

## 13. 引擎改动（最小）

- **可选新增** `pnpm cli state-init <iid>`：吐初始 state JSON 模板（纯计算，便于测试与一致性）。
- **可选新增** `pnpm cli reconcile <cached_node> <labels...>`：对比缓存节点与 GitLab 推导节点，输出 drift 判定（纯计算，便于测恢复逻辑）。
- 其余引擎模块（model/contract/guard/parse/gitlab/render/plan/evidence）**不动**。

是否加这两个命令由实现阶段定（YAGNI：Leader 内联能做就不加）。

## 14. 测试

- **引擎**（vitest，保持 80%+）：新增 —— config 查找链解析、state 缓存重推导对比（GitLab 为准漂移逻辑）、resume glob 扫描；若加 `state-init`/`reconcile` 则配套单测。
- **vendor sub-skills**：markdown 不单测；通过引擎 e2e（已有 `e2e.test.ts`）+ 一次真实 glab 冒烟验证 Leader 读取执行链路。
- **learn**：验证 capture 写入 jsonl、`lessons_captured++`、apply 首次空走零开销。

## 15. 分阶段交付（plan 细化）

1. **配置系统**：`config.md` + `config.example.md` + 查找链 + `/init-glab-flow` + install.sh。
2. **状态缓存 + 恢复**：state schema + `resume.md` + 重推导对比 + state 持久化时机。
3. **门禁 + run 模式**：`gate.md` + semi/full-auto。
4. **统一文档存储**：`.glab-flow/` 树 + `spec_dir` 记录 + 禁写代码仓规则。
5. **vendor 子 skill**：copy + 改写 7 个 sub-skill。
6. **自我迭代闭环**：`learn.md` + capture/apply/upgrade + knowledge.md。
7. **去耦清理**：SKILL/nodes/README/docs 删 dev-flow 引用 + 更新 install.sh/uninstall.sh + docs。

## 16. 风险

- **vendor 维护成本**：共享 skill 升级后 glab-flow 副本不会自动同步 → 接受（自包含的代价），learn 闭环可提示 drift。
- **full-auto 误应用**：hard_gate 永远人工兜底；非 hard_gate 自动应用前仍跑 G1–G13。
- **GitLab 标签被 flow 外改动**：恢复时 GitLab 为准 + 提示，零静默漂移。
- **skill 文件自升级风险**：curator 只提议、人工审批，不自动改。

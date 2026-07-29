---
name: glab-flow-learn
description: glab-flow 自我迭代闭环——每节点 capture，终态 upgrade（distill + 人工审批的 skill 文件编辑），下个 run apply。
---

# glab-flow 自我迭代闭环（capture / apply / upgrade）

glab-flow 的学习闭环遵循一条铁律：**前面只记录，最后升级**。整个 run 期间只做只读的信号采集（capture）；只有当 flow 走到终态（已完成 / close 之后）才触发升级仪式（upgrade ritual）；升级的产物在下个 run 启动时以只读方式注入（apply）。**绝不边跑边改 skill 文件、绝不自动注入未审批的变更**——流程跑的是确定性状态机，自我迭代是状态机之外、由 Leader + markdown 承载的旁路闭环。

## 节奏（核心）

学习闭环按 run 的生命周期分三拍，严格不重叠：

1. **capture（每节点，整个 run）** —— Leader 在执行每个节点的 8 步编排时，顺手把"有价值的信号"写进本 run 的 lessons 文件。不 distill、不注入、不改任何 skill 文件——只采集原始事实。每条 lesson 让 `state.lessonsCaptured++`（state.json 里的计数器），便于事后判断这次 run 是否值得升级。
2. **upgrade ritual（终态，已完成 / close 之后）** —— run 走到终态后，Leader 把本 run 的 lessons（+ 历史累积）distill 成 `knowledge.md` 条目；视情况 spawn 临时 curator 提议对 skill 文件的编辑（diff 形式），**经人工审批后才应用**。
3. **apply（下个 run 启动，只读）** —— 新 run 启动时，读 `knowledge.md`，挑与当前节点 / Issue 类型相关的条目注入执行上下文。首次无 knowledge → 返回空，零开销。

三拍之间是**单向流**：capture 永不触发 upgrade；upgrade 只在终态触发；apply 永不写文件。这保证了流程跑的时候是确定的、可审计的——任何"自我迭代"都发生在两次 run 之间，不在 run 内部。

## capture（每节点）

Leader 在每轮编排中识别并记录以下信号，写入本 run 专属的 lessons 文件：

```
<workspace.root>/.glab-flow/<iid>/lessons-<HHmm>.jsonl
```

- **每 run 一文件**：`<HHmm>` 是 run 启动时的本地时分（24h 制，如 `1432`），保证同一 Issue 多次 run 不互相覆盖。
- **格式**：JSONL（每条 lesson 一行 JSON），字段 `{node, signal, detail, at}`：
  - `node` —— 节点类型（如 `需求评审中` / `待发布`）。
  - `signal` —— 信号分类（见下文清单）。
  - `detail` —— 人类可读的具体观察，包含足够上下文（Issue iid、触发条件、发生了什么）。
  - `at` —— ISO 时间戳。
- **计数**：每写一条 lesson，`state.lessonsCaptured++`（state.json 内字段，见 `SKILL.md`「状态缓存」）。该计数不驱动任何门禁，仅供 upgrade ritual 判断本 run 是否值得升级（如阈值 < 3 条则跳过）。

**采集的信号清单**（不在捕获时分析，只记录原始事实）：

- **节点卡顿**（`signal: "node_stuck"`）——某节点连续多轮证据不齐、护栏 ok:false、或用户反复修正；记录卡在哪个节点、卡多久、缺什么证据。
- **护栏触发**（`signal: "guard_triggered"`）——哪个 G1–G13 触发、触发条件、用户如何回应（补证据 / 退回 / 改输入）。
- **证据缺失模式**（`signal: "evidence_gap"`）——反复在同一节点缺同一种证据（如"待发布总是缺 release-check 结论"），提示 sub-skill 或节点契约有结构性遗漏。
- **sub-skill 表现**（`signal: "subskill_perf"`）——某个子 skill 产出反复被改、被否、或产出质量明显高于均值；记录哪个子 skill、哪类 Issue。
- **用户修正**（`signal: "user_correction"`）——用户直接改了 Leader 起草的内容（评论 / 计划 / spec），记录改了什么、为什么（用户解释了的话）。
- **手动备注**（`signal: "manual_note"`）——`/glab-flow learn <note>` 命令记录的任意备注，用户主动想留下的话。

**capture 的边界**：只记录、不判断。Leader 不在 capture 阶段 distill 出"规律"、不修改 skill 文件、不向当前 run 注入建议——当前 run 的行为完全由 `nodes.md`/`guards.md`/`gate.md` 决定，learn 不干预。

## apply（下个 run 启动，只读）

新 run 启动（用户跑 `/glab-flow <iid>` 且该 Issue 已有历史 lessons）时，Leader 在第一轮读状态之前/之后做一次轻量 apply：

1. 读 `<workspace.root>/.glab-flow/knowledge.md`（注意：是 `knowledge.md`，不是 `lessons-*.jsonl`——apply 只读升级后的知识，不读原始 lessons）。
2. 挑出与**当前节点**、**当前 Issue 类型**（需求 / Bug / 任务）相关的条目，作为执行上下文注入 Leader 的提示。
3. 注入形式：在编排第 2 步（查契约）之后、第 3 步（判断证据）之前，加一句"历史经验提示"——例如「上次同类 Issue 在 待发布 卡了 release-check 结论，建议本节点提前委派 release-check agent」。
4. **首次无 knowledge**（`knowledge.md` 不存在或为空）→ 返回空，apply 零开销、零提示，流程照常跑。

apply 注入的是**建议**，不是命令——Leader 可以根据当前 Issue 的具体情况忽略它。注入内容必须明确标注来源（「来自 knowledge.md 第 N 条」），便于用户追溯。

## upgrade ritual（终态，已完成 / close 之后）

当 run 走到终态（节点 = 已完成，或 Issue 已 close），Leader 主动询问用户是否触发 upgrade ritual（也可由用户手动触发，见「手动命令」）。**不在非终态触发**——跑流程的时候不迭代 skill。

升级仪式分三步：

### 步骤 1：distill 本 run lessons（+ 历史累积）

Leader 读本 run 的 `lessons-<HHmm>.jsonl`，结合 `knowledge.md` 里已有的历史条目，提炼出可复用的知识条目。distill 的目标是从一次性事实提炼出模式：

- 把多条 `node_stuck` + `evidence_gap` 凝练成「节点 X 容易缺 Y 证据，建议在 Z 步提前做」。
- 把 `user_correction` 凝练成「用户偏好：起草评论时应该……」。
- 把 `subskill_perf` 凝练成「子 skill A 在 B 场景下产出质量高，可委派；在 C 场景下需人工补」。

每条 distilled 条目写入 `knowledge.md`，字段 `{id, node, type, lesson, source_runs, updated_at}`——`source_runs` 是贡献这条知识的 run 列表（lessons 文件名），便于追溯。distill **只写 `knowledge.md`**，不动 skill 文件。

### 步骤 2：spawn 临时 curator 视情况提议 skill 编辑

如果 distill 过程中发现**结构性问题**（不是单点教训，而是流程本身的缺陷）——例如某护栏在特定场景下过严/过松、某节点的契约漏了一个必填项、某子 skill 反复被改说明其方法论有错位——Leader spawn 一个**临时 curator agent**（`general-purpose`，不是常驻 agent）：

- curator 的输入：本 run 的 lessons、`knowledge.md`、以及被怀疑的 skill 文件（`SKILL.md` / `nodes.md` / `guards.md` / `sub-skills/*.md`）。
- curator 的输出：**提议的编辑**，以 unified diff 形式呈现（哪个文件、哪一行、改成什么、为什么）。
- curator 只**提议**，不执行——它没有写文件的权限，输出回到 Leader。

### 步骤 3：人工审批后才应用

Leader 把 curator 提议的 diff 展示给用户（每条 diff 一条决策）：

- **用户批准** → Leader 应用该编辑（写回 `skills/glab-flow/` 下对应文件）。
- **用户否决** → 不应用，相关教训只沉淀进 `knowledge.md`（步骤 1 已写），skill 文件保持原样。
- **用户修改** → 按用户改后版本应用。

**绝不自动改 skill 文件**——任何 SKILL.md / nodes.md / guards.md / sub-skills/*.md 的变更都必须有用户在 diff 上点头。这是 glab-flow 自我迭代的红线：自动化只到 distill + 提议为止，应用由人决定。

## 手动命令

- **`/glab-flow learn <note>`** —— 在任意节点手动记一条 `signal: "manual_note"` 的 lesson，写入本 run 的 `lessons-<HHmm>.jsonl`。用于用户想主动留下观察（如"这个 Issue 的业务背景特殊，下次同类要……”）。
- **`/glab-flow learn --upgrade`** —— 在非终态手动触发 upgrade ritual（例如用户判断这次 run 已经学到足够东西，不想等到 close）。流程同终态升级：distill → curator 提议 → 人工审批 → 应用。**仍然不改当前 run 的行为**——升级产物只对下个 run 生效（apply）。

## 数据落点

learn 闭环的数据独立于状态机，不混进 state.json：

| 文件 | 位置 | 作用 | 生命周期 |
|---|---|---|---|
| `lessons-<HHmm>.jsonl` | `<workspace.root>/.glab-flow/<iid>/` | 本 run 的原始信号采集（capture 产物） | 每 run 一文件，永不被自动删 |
| `knowledge.md` | `<workspace.root>/.glab-flow/` | 跨 run 累积的蒸馏知识（upgrade 产物） | 全局唯一，跨 Issue 共享 |
| `state.json` 里的 `lessonsCaptured` | `<workspace.root>/.glab-flow/<iid>-state.json` | 本 run 的 lesson 计数（仅阈值判断用） | 随 state 缓存，终态可删 |

**终态清理 state 不影响 learn**：state.json 只是 GitLab Issue 标签的派生缓存（见 `SKILL.md`「状态缓存」），删它不影响 `lessons-*.jsonl` 和 `knowledge.md`——这两个是 learn 闭环的持久数据，由用户决定何时清理（`/init-glab-flow` 不动它们）。

## 引擎影响

**无**。learn 闭环完全由 Leader + markdown 承载：

- capture = Leader 写 jsonl 文件。
- apply = Leader 读 markdown 文件后注入提示。
- upgrade = Leader 读 jsonl + 写 markdown + spawn curator agent + 展示 diff 给用户。

引擎（`pnpm cli node/validate/plan/render/config/state-init`）**不参与** learn——它没有任何 learn 相关的命令、字段、或分支。learn 不在状态机的确定性计算里，是在 Leader 编排层之上的旁路闭环。这保证了引擎的纯计算性质不被"学习"污染：同一个 Issue + 同一组 labels，引擎永远推出同一个节点，不管 learn 学到了什么。学到的东西只影响 Leader 怎么**执行**那个节点，不影响节点**是什么**。

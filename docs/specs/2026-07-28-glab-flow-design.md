# glab-flow 设计文档

- **状态**：设计评审中
- **创建日期**：2026-07-28
- **作者**：eliojin
- **权威规则来源**：`oa-ai-native-harness` 仓的 `docs/issue-state-machine.md` 与 `AGENTS.md`（GitLab Issue 是新事项唯一状态事实源）
- **关联**：本引擎是 oa-ai-native-harness 规则体系的「执行器」，不修改规则本身

---

## 1. 概述

`glab-flow` 是一款本地人驱动的 Claude skill，以 GitLab Issue 状态机为骨架，把 OA 需求从分诊一路驱动到上线/验收。它是 dev-flow 的 GitLab 重写版（状态机 + 内容生成一体），但以 `oa-ai-native-harness` 的状态机和 AI 护栏为单一真理源。引擎名取自 GitLab CLI `glab`，与 `jira-flow`、`quick-dev-flow` 并列，位于 `/Users/eliojin/IdeaProjects/glab-flow`（独立 git 仓）。

## 2. 背景与目标

### 2.1 背景

`oa-ai-native-harness` 是 OA 的「AI Native 工作方式运行底座」——一个 GitLab 上的流程/规则/模板/Skill 规范仓（非代码项目）。它把交付模型固化成：

- GitLab 是唯一事实源（Issue 管流转、Docs 管事实、MR 管变更、CODEOWNERS 管责任、CI/CD 管质量）。
- AI 干草稿/整理/初审/流转提议；Owner 把关口径/合并/发布/验收。

核心是 GitLab Issue 状态机（`docs/issue-state-machine.md`）+ AI 协作 17 条护栏（`AGENTS.md`）：三类标签、需求/Bug 双流、三类评审分离、状态变更评论(不可改)、Assignee 强制映射、节点冻结、AI 流转前置校验。

### 2.2 缺口（glab-flow 要补的位置）

harness 把**规则**写得很完整，但缺一个把规则**跑起来的执行器**：skills/ 下三个（oa-knowledge-intake / oa-mr-review / oa-release-check）目前只是 ~200 字 README 规格；CI 仅 grep 关键短语；loop-engineering 仍是草案；历史 Issue 上的 AI 分诊是外部 bot。

### 2.3 目标

给一个 GitLab Issue，glab-flow 按状态机驱动它走完交付全流程：AI 生成内容（草稿/方案/代码/测试/评审）+ 确定性门禁校验 + 人工确认后写回 GitLab，全程遵守 harness 护栏，每次交付反哺 context/faq/cases。

## 3. 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 引擎形态 | **本地人驱动 skill，写回 GitLab** | 复用现有 Claude/codegraph/MCP；几天出 v1；符合 harness「只读/建议先行」 |
| v1 定位 | **全包（状态机 + 内容生成一体）** | 用户要 dev-flow 等价能力，不只编排 |
| 写回粒度 | **每次写回都预览确认** | 共享 tracker，安全可审计，完全合规 harness 护栏 |
| 复用策略 | **新建独立 skill，组合复用子能力** | spec-author/git-ops/code-review/tdd-guide 等；dev-flow(Jira) 保留不动 |
| 架构方案 | **A：声明式状态机 + 专家 Agent 编排** | 护栏硬编码进模型、不靠 LLM 自律、可审计；唯一能满足「全包 + 硬门禁 + 可审计」 |

## 4. 架构总览

七层（从上到下）：

```
① 触发入口    GitLab Issue URL（或自然语言 free-flow）→ Leader 启动
② 规则权威    harness 仓(issue-state-machine.md + AGENTS.md + 模板) = 单一真理源
              引擎持有「派生的声明式状态机模型 state-machine.yaml」+ 模型↔文档一致性校验
③ 状态机驱动  读 GitLab Issue labels → 查模型 → 当前节点/允许下一节点/必填项/Assignee映射/门禁类型
④ 护栏/前置校验 确定性纯函数(非 LLM)：硬门禁强制人工证据；缺字段→停+一次性列全缺失项
⑤ 内容生成    Leader 按节点委派专家 agent，复用现有 skill（见 §6）
⑥ GitLab写回层 Leader 唯一执行对外写回：label/assignee/comment/close 由已认证 glab CLI 执行；
              引擎不持有 token、不封装 API client、不做网络/子进程 I/O；强制 preview-confirm
⑦ 持久化      GitLab Issue = 唯一状态真相(labels + 评论)；
              本地 .glab-flow/<issue>/ 只放可重建的工作产物
```

**Agent 拓扑**：Leader（编排，上下文干净，只委托）+ 每阶段一个专家 agent（独立上下文），与 dev-flow 一致。

**主数据流**：
```
GitLab Issue URL → Leader → 读 labels → 状态机模型 → 当前节点+必填项+门禁
  → 缺证据/门禁？ 停，列缺失，问用户
  → 齐了？ 委派专家 agent 生成内容 → 护栏校验
  → 起草「状态变更评论 + 标签/Assignee 变更」→ 预览 → 用户确认
  → GitLab 集成层写回 → 更新本地快照 → 下一节点
```

**两个要点**：
1. 状态机模型是 harness 文档的「可执行投影」，不是平行真理——从 `issue-state-machine.md` 派生，带一致性校验，规则改了同步模型（单 MR）。
2. GitLab 集成层是唯一写口且抽象——v1 本地驱动，未来 bot 复用这层，不重写状态机逻辑。

## 5. 状态机模型（可执行 schema）

派生自 `issue-state-machine.md` 的声明式模型。每个 transition 带 `gate_outcome: [通过, 退回]` + `return.target`——**退回是一等路径，不是异常分支**。

```yaml
# state-machine.yaml —— harness 文档的可执行投影，带 ↔文档一致性校验
story:
  states: [草稿中, 待评审, 已评审, 开发中, 测试中, 待发布, 生产验收中, 已完成]
  transitions:
    - {from: 草稿中, to: 待评审, gate: null,
       required_fields: [], assignee_map: {to: 产品}}
    - {from: 待评审, to: 已评审, gate: 需求评审, gate_outcome: [通过, 退回],
       required_fields: [评审日期, 产品确认人, 评审结论=通过, 需求文档或评审记录],
       assignee_map: {to: 研发},
       return: {target: 草稿中, assignee: 产品, comment_template: 退回评论_含问题清单}}
    - {from: 已评审, to: 开发中, gate: 技术方案评审,
       required_fields: [技术方案评审通过记录或免评审结论, 实际开始日期, 研发Assignee, 计划提测时间, 计划上线时间],
       assignee_map: {to: 研发},
       return: {target: 已评审, note: 不退回, 继续完善方案}}
    - {from: 开发中, to: 测试中, gate: 代码评审与自测,
       required_fields: [代码评审与自测结论, 提测日期, 研发Assignee, 可测试版本/环境, 测试说明],
       assignee_map: {to: 测试}}
    - {from: 测试中, to: 待发布, gate: 测试验收,
       required_fields: [测试完成日期, 测试Assignee, 结论, 回归范围/证据, 阻塞发布问题均已验证通过],
       assignee_map: {to: 研发},
       return: {target: 开发中, only_when: 整体返工}}
    - {from: 待发布, to: 生产验收中, gate: 发布, hard_gate: true,
       required_fields: [发布日期, 研发Assignee, 生产版本, 发布记录/回滚信息],
       assignee_map: {to: 产品}}
    - {from: 生产验收中, to: 已完成, gate: 产品验收, hard_gate: true, terminal: true,
       required_fields: [验收完成日期, 具体产品验收人, 产品Assignee, 验收结论, 依据],
       assignee_map: {to: 产品}}
bug:
  states: [已确认缺陷, 开发中, 测试中, 待发布, 生产验证中, 已完成]
  transitions:
    - {from: 已确认缺陷, to: 开发中, gate: null, assignee_map: {to: 研发}}
    - {from: 开发中, to: 测试中, gate: 代码评审与自测,
       required_fields: [代码评审与自测结论, 提测日期, 研发Assignee, 可测试版本/环境],
       assignee_map: {to: 测试}}
    - {from: 测试中, to: 待发布, gate: 测试验收,
       required_fields: [测试完成日期, 测试Assignee, 结论, 回归范围/证据],
       assignee_map: {to: 研发}}
    - {from: 待发布, to: 生产验证中, gate: 发布, hard_gate: true,
       required_fields: [发布日期, 研发Assignee, 生产版本, 发布记录/回滚信息],
       assignee_map: {to: 测试}}
    - {from: 生产验证中, to: 已完成, gate: 生产验证, hard_gate: true, terminal: true,
       required_fields: [验证完成日期, 具体测试验证人, 验证结论, 依据],
       assignee_map: {to: 测试}}   # Bug 终态责任=测试，不需产品
reviews:  # 三类评审边界，护栏层用
  需求评审: 推进状态
  技术方案评审: 只记录不推进
  代码评审: 不单独推进
```

**退回语义逐节点不同（模型编码 return.target，不统一退回上一节点）**：

| 门禁节点 | 不通过时退回目标 |
|---|---|
| 需求评审 | → 草稿中（重新修订评审）|
| 技术方案评审 | 保持 已评审（不退回，继续完善方案）|
| 测试（单个问题）| 不退回，挂父需求"测试问题"评论；仅整体返工 → 开发中 |
| 生产验收 | → 开发中（范围变化 → 草稿中）|

**关键点**：`hard_gate: true`（待发布、验收、关闭）引擎永不自动写；`assignee_map` 把角色→具体 GitLab 用户解析放进护栏层；`reviews` 表强制"技术方案评审通过只记录不推进"；模型派生自文档 + 一致性校验进 CI 防漂移。

## 6. 生命周期编排

### 6.1 Leader 每轮算法

```
1. 读 Issue labels → 当前节点
2. 查节点契约(必填项/门禁/assignee_map/允许流转/return_target)
3. 能否提议流转？
   ├─ 能(证据齐) → 委派「流转 agent」起草 状态变更评论 + 标签/Assignee delta
   │              → 护栏确定性校验 → 预览确认 → GitLab 集成层写回
   └─ 不能       → 委派「节点工作 agent」生成本节点内容(草稿/方案/代码/测试)
                  → 预览确认写回(评论或分支) → 等下一轮
4. 缺必填 / 门禁不满足 → 停，一次性列全缺失项问用户（不猜、不编）
5. 循环到 已完成 或用户停
```

### 6.2 节点 → 专家 agent → 产出 → 门禁 → 写回

| harness 节点 | 专家 agent（复用 skill） | 产出物 | 门禁 | 写回（预览确认）|
|---|---|---|---|---|
| 分诊 `triage::pending` | intake（harness `oa-knowledge-intake`）| 澄清问题 + 建议分类/Assignee | 团队确认性质 | `type::story`+`草稿中`，Assignee=产品 |
| 草稿中 | requirement-drafter（`spec-author`）| 需求草稿（`requirement.md` 模板 + project-flow §2「六清楚」）| 草稿门槛 | → 待评审 |
| 待评审 | review-preview | 评审意见 + 问题清单（问题反馈）| 需求评审（二值）| 通过→已评审 / 退回→草稿中（带问题清单）|
| 已评审 | tech-design（`spec-author`/`architect`）| 技术方案 `design.md` | 技术方案评审（只记录不推进）+ 开发门槛齐 | 技评记录；进开发 Assignee=研发 |
| 开发中 | dev（`git-ops`+`tdd-guide`+`codegraph`，跨仓）| 代码(特性分支) + MR 描述 + 自测 | 代码评审与自测（`code-review`+`php/java/ts-reviewer`）| → 测试中，Assignee=测试 |
| 测试中 | tester（`test-design` / `test-flow-apifox`）| 测试计划/用例；测试问题挂父需求评论 | 测试验收（阻塞问题全验证）| → 待发布，Assignee=研发 |
| 待发布 | release-check（harness `oa-release-check`）+ `jenkins-deploy` | 发布风险/必补事项/检查清单/回滚 | 发布（hard_gate）| → 生产验收中，Assignee=产品 |
| 生产验收中→已完成 | Leader 起草终态评论 | 验收记录（日期/验收人/结论/依据）| 产品验收（hard_gate·terminal）| → 已完成 + 关闭 Issue；反哺 `context/faq/cases` |

### 6.3 dev-flow 阶段 ↔ glab-flow 节点映射

```
dev-flow:    spec          design        dev         review-test     ship
glab-flow: 草稿中+待评审  已评审(技方)   开发中        测试中        待发布+验收+已完成
```

glab-flow 相对 dev-flow 多出：分诊（GitLab 入口特性）、三类评审分离 + 节点冻结、问题清单退回（二值门禁）、发布/验收 hard_gate、知识反哺闭环。

### 6.4 三条必须做硬的编排规则

1. **冻结不可改**：节点一流转，上一节点评论立即冻结。引擎只新增评论/退回建新版本，永不编辑已冻结评论（AGENTS#13）。需求进"已评审"后改动只走"需求变更申请"评论。
2. **测试问题不建 Bug**：开发/测试阶段问题一律挂父需求"测试问题"评论，单个问题不退回"开发中"，阻塞问题未验证不放"待发布"（AGENTS#14）。
3. **跨仓开发**：开发中节点，dev agent 按 `repository-map.md` 判断涉及仓库，遵守模块独立仓库分支规则（基于 master 拉分支）、前端 Jenkins 部署、migration 顺序等既有约束（复用 git-ops/oa-devops，不重新发明）。

## 7. 护栏与前置校验

### 7.1 定位：纯函数确定性校验器，关键路径不放 LLM

```
validate(当前状态, 目标流转, 结构化载荷, Issue证据, 用户指令)
  → { ok }
  → { blocked, missing: [...], reason }
```

状态变更评论**不是 LLM 自由发挥的 markdown**，而是引擎用结构化字段填进 harness 指定模板渲染出来的。护栏校验字段，不校验自然语言——这是门禁不失守的根本。LLM 只负责从 Issue 证据提议字段值，确认与校验都确定性。

### 7.2 校验规则集（每条 ← AGENTS.md/状态机条款，可单测）

| # | 规则 | 来源 | 判定（确定性）|
|---|---|---|---|
| G1 | 流转前置必填 | 状态机 required_fields | 目标节点日期/确认人/结论/证据任一空 → block |
| G2 | 门禁二值 | §4/§7.7 | gate_outcome 需"通过"；用户选"退回"→ 走 return 路径，不进下一节点 |
| G3 | hard_gate 永不自动写 | §7.4 | 发布、产品验收/Bug 生产验证、关闭 Issue（终态）必须人工证据齐全 + 预览确认 |
| G4 | 三类评审分离 | §6/AGENTS#7 | 技术方案评审通过→只记录；代码评审→不推进；不得用技评/代码评审替代需求评审 |
| G5 | 标签唯一性 | §7.1 | 任意时刻只能有一个 `story-status::*`(或 `status::*`)、一个 `type::*` |
| G6 | Assignee 强制映射 | §6/AGENTS#11 | 模型给出节点→角色(如 待评审→已评审=研发)；角色→具体 GitLab 用户**从 Issue 正文「交付协同」表解析**；未填或无账号 → block 反问，由人工输入（不维护全局映射）|
| G7 | 原始 Issue 不可改 | AGENTS#10 | 永不覆盖原标题/正文/附件；只加标签/评论/段落 |
| G8 | 冻结不可改 | §6/AGENTS#13 | 已流转节点评论只读；改内容→新增评论或退回建新版本 |
| G9 | 不猜人/结论 | §6/AGENTS#5 | 人/结论只能引用用户指令或 Issue 已有证据 |
| G10 | 日期候选确认 | §6/AGENTS#15 | 可自动带出本地日期为候选，未经"确认"不得落盘 |
| G11 | 测试问题不建 Bug | §5/AGENTS#14 | 开发/测试问题挂父需求评论；阻塞问题未验证→不放 待发布 |
| G12 | 终态原子性 | §7/AGENTS#16/17 | 已完成 = 标签替换+Assignee+评论+关闭 Issue 同一次操作；不得只关闭、不得关闭后仍挂 生产验收中 |
| G13 | 不建 Jira | AGENTS#9 | 新事项不创建/同步 Jira |

### 7.3 写计划 = 预览-确认的最小单位

引擎把每次写回算成一个写计划（一组原子 GitLab 操作），渲染成 diff：

```
写计划 (待评审 → 已评审)：
  - remove_label: story-status::待评审
  - add_label:    story-status::已评审
  - set_assignee: @产品 → @研发(eliojin)
  - add_comment:  (由结构化字段渲染的「状态变更」评论)
确认？ [y/n/编辑载荷]
```

用户 `y` → 集成层执行；`n`/编辑 → 回到载荷收集。部分失败不静默：API 失败带重试（该 host DNS 抖动），仍失败则上报 + 不留半成品状态。

### 7.4 异常 & 脏状态

- 护栏 block：停，一次性列全缺失项（G1/G6/G9），不逐项往返。
- 脏状态拒绝驱动：Issue 有 0 或 ≥2 个 `story-status::*`、或已关闭仍挂 `生产验收中` 等"待治理数据"（§11/§12）→ 拒绝推进，列给人工修，不自动补标/不批量改。
- 与外部 triage bot 共存：`ai-triage::v1` 只动 `triage::*`；glab-flow 从 `type::*` 确认后才接管，不碰分诊 bot 职责。

### 7.5 可审计性

每条规则标注源自 AGENTS.md/状态机哪一条，每条配一个单测。规则集进 CI；harness 规则改了、规则集没同步 → 测试红。

## 8. v1 范围与边界

### 8.1 IN

- 本地人驱动 skill `glab-flow`，GitLab Issue URL（或自然语言）触发
- 状态机模型（story + bug）+ 模型↔harness 文档一致性校验
- 护栏层 G1–G13 确定性校验 + 写计划预览确认
- 全生命周期内容生成：分诊/草稿/需求评审预审/技术方案/开发/测试/发布检查/验收，复用现有 skill
- GitLab 写回层：Leader read/write labels/issue/comments/assignee/close；执行用已认证 glab CLI，engine 不封装 GitLab API client
- Leader + 专家 agent 编排；跨仓开发（oa-platform/service/frontend/go）经 git-ops/codegraph

### 8.2 OUT

| 项 | 处理 |
|---|---|
| 事件驱动 bot / CI Loop | 不做（集成层已抽象，预留挂载点；属 loop-engineering Phase 2+）|
| 自动写代码/自动合并/自动发布 | 永不（hard_gate + 预览确认）|
| 批量改历史脏数据 | 不做（脏状态只拒绝驱动 + 列给人工）|
| 前端/PHP/Go/Java 的 CI 门禁补齐 | 不做（harness Phase 1 的事，不归 glab-flow）|
| 非 OA 项目 | 不服务（只对接 oa-ai-native-harness 体系）|

### 8.3 验收标准

- 给 `triage::pending` 需求 Issue → 能驱动到 已评审，并演示一次「需求评审预审 + 问题清单退回」。
- 给 已评审 Issue → 产出技术方案 + 进开发 + 跨仓分支 + MR 描述 + 代码评审。
- 任何 hard_gate 节点无人工证据 → 拒绝并一次性列出缺失项。
- 脏状态 Issue → 拒绝驱动。
- 每次写回有预览确认；状态变更评论严格符合 harness 模板。
- 护栏层单测覆盖 G1–G13。

## 9. 持久化

- 真相源 = GitLab Issue（labels + 评论）。引擎不存本地真相副本。
- 本地 `.glab-flow/<issue-key>/`：工作产物（草稿、校验报告、内容快照、写计划日志）——可重建、可删、不入真相。
- 引擎配置：状态机模型 + 规则集，进 glab-flow 仓，带 ↔harness 一致性校验。（角色→GitLab 用户**不进配置**，按 Issue 级「交付协同」表人工输入，引擎只解析，见 G6）

## 10. 测试策略（对齐 80%+ / AAA）

- 护栏层（核心，拉满）：纯函数单测，G1–G13 每条 ≥1 case，脏载荷 → 断言 block + 缺失项。
- 状态机模型：流转合法性（from→to 允许/拒绝）、return_target 正确性、标签唯一性。
- GitLab 集成层：mock API + recorded fixtures，测 labels 解析、写计划执行/部分失败/重试。
- 一致性校验：harness 文档↔模型 drift 检测。
- 端到端（集成）：fixture Issue 跑 分诊→草稿→待评审(退回)→已评审 全链路，断言每步标签/评论/Assignee。
- 编排算法：mock 专家 agent（stub 结构化载荷），测"能流转/不能流转"二分 + 缺字段停问。
- 不测：真实写 GitLab（用 mock）；LLM 措辞（测"载荷结构 + 护栏"，不测概率性文字）。

## 11. 待确认 / 后续

- glab-flow 仓初始化（git init、目录骨架、注册为本地 skill）——writing-plans 阶段处理。
- 角色→GitLab 用户：无全局标准，按 Issue 级「交付协同」表人工输入；引擎从 Issue 正文解析，缺则反问（见 G6），不维护全局映射。
- 状态机模型与 harness 文档的一致性校验实现方式（解析 markdown 还是对照清单）——实现期定。
- 未来 bot 接入：复用 §4 第⑥层 GitLab 集成层，不重写状态机/护栏。

---
name: glab-flow-tools
description: glab-flow 运行时工具依赖（非 vendor 的基础设施）。
---

# glab-flow 运行时工具依赖

## 声明

glab-flow **vendor 了 OA 方法论**——`sub-skills/` 下的 7 个子 skill（spec-author / git-ops / tdd-guide / code-review / test-design / test-flow-apifox / jenkins-deploy）是流程方法论本体，随 skill 一起拷贝，构成 glab-flow 的自包含能力栈。这些子 skill 在运行时会调用一批外部工具，它们是**运行时依赖**而非 vendor 对象：已装即用、未装按需引导安装，**不随 skill 拷贝、不在 skill 仓里维护**。下面列全清单。

### 1. `glab` CLI —— GitLab 读写

GitLab Issue 的全部读写（view / update label / note / close / `glab api`）由 Leader 直接调用 `glab` 完成详见 `SKILL.md`「GitLab 读写」一节。glab 已由环境认证（`glab auth login`），**无需 token、不在环境变量里配 token**。

- 使用方：Leader（每轮编排第 1/7 步）、`sub-skills/git-ops.md`、`sub-skills/spec-author.md`（读 Issue / 写评论）。
- 未安装 → `/init-glab-flow` 引导用户先 `brew install glab` 并 `glab auth login`，flow 不在无认证下裸跑。

### 2. `codegraph` MCP —— 符号导航 / 影响分析

CodeGraph 是基于 tree-sitter 的代码知识图谱（每个符号、边、文件都已解析）。读取亚毫秒，索引滞后写入约 1 秒。

- 使用方：`sub-skills/tdd-guide.md`（定位被测符号、查 callers/callees 判断改动影响面、找现有测试惯例——先 codegraph 再写测试）、`sub-skills/code-review.md`（按改动符号查影响面）、`agents/review-preview.md`（凡把现有系统行为作为阻塞/退回依据，先用 codegraph 或源码证据核实）。
- 工具面：`codegraph_search` / `codegraph_context` / `codegraph_callers` / `codegraph_callees` / `codegraph_impact` / `codegraph_node` / `codegraph_explore` / `codegraph_files`。
- 未初始化（`.codegraph/` 不存在）→ 提示用户跑 `codegraph init -i` 构建索引，不回退到 grep 暴力扫。

### 3. `*-reviewer` agents —— 代码评审

只读评审 agent，由 Leader spawn `~/.claude/agents/` 下的对应栈 agent 执行（不修改代码，只产出评审意见）。

- `php-reviewer` —— PHP / Laravel 专用（Eloquent / middleware / validation / queue / events / service container）。
- `typescript-reviewer` —— TS / JS / Node 专用（类型安全 / async 正确性 / Node 安全 / 惯用法）。
- `java-reviewer` —— Java / Spring Boot 专用（分层架构 / JPA / 安全 / 并发）。
- `security-reviewer` —— OWASP Top 10 / 注入 / SSRF / 不安全加密 / 凭证泄漏。
- `database-reviewer` —— MySQL / PostgreSQL（查询优化 / schema / 迁移安全 / 索引）。
- 使用方：`sub-skills/code-review.md` 按改动文件的技术栈挑选调用——glab-flow 只提供方法论与严重度框架（CRITICAL/HIGH/MEDIUM/LOW），具体检查能力依赖已安装的 reviewer。
- 未安装某栈 reviewer → code-review 退回 `code-reviewer`（通用）或人工评审，并在 lessons 里记录该栈缺失。

### 4. `apifox-*` skills —— API 测试

接口测试**执行**委托 apifox 运行时工具链（用例设计归 `sub-skills/test-design.md`，执行归 `sub-skills/test-flow-apifox.md`）。

- 相关 skill：`apifox-test-case` / `apifox-test-scenario` / `apifox-test-automation` / `apifox-cli` / `apifox-cli-checkup` / `apifox-branch` / `apifox-import-export` / `apifox-workflow-api-lifecycle`。
- 使用方：`sub-skills/test-flow-apifox.md`（执行 test-design 产出的用例，回传 pass/fail 契约）。
- glab-flow **不自带 apifox 能力**，只提供执行方法论与结果契约；apifox 未配置 → test-flow-apifox 引导 `apifox-cli-checkup` 体检并配置当前项目。

### 5. MySQL MCP —— 数据库查验（可选）

只读数据库访问（`mysql_query` 只读模式），用于验证生产/测试库的真实状态以佐证 Issue 判断。

- 使用方：可选——护栏取证（G3 阻塞验证）、bug 排查节点（`mcp__platform-test` / `mcp__tenant-*-test` 等只读实例）。
- 生产库：MCP **不直连生产**；需查生产时用 `kibana_generate_sql` 起草 SELECT → 人工执行后回贴结果（见 `SKILL.md` 配置的 `databases` 字段约定）。
- 未配置 → 不阻塞 flow，跳过 DB 佐证步骤，记录在 lessons。

## 边界说明

glab-flow 宣称「**完全零外部依赖**」指的是**零外部 skill / 方法论依赖**——整个流程的方法论本体（节点 / 护栏 / 内容生成 / 评审 / 测试 / 发布）都已 vendor 进 `sub-skills/` 与 `nodes.md`/`guards.md`/`gate.md`，没有任何外部 flow skill 或外部方法论的引用。

上述工具（glab CLI / codegraph / *-reviewer / apifox-* / MySQL MCP）是**基础设施**——同其他流程引擎依赖各自的外部 MCP（如 Atlassian MCP、Jira MCP）一样，glab-flow 依赖这批工具作为运行时支撑。它们是「环境已安装即用、未装则引导安装」的存在，文档声明即可，不破坏自包含性。子 skill 在需要时通过 `../tools.md` 反向引用本文件，避免在每个子 skill 里重复罗列工具清单。

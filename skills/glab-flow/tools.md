---
name: glab-flow-tools
description: glab-flow 运行时工具依赖（非 vendor 的基础设施）。
---

# glab-flow 运行时工具依赖

## 声明

glab-flow **内置了交付方法论**——`sub-skills/` 下的 8 个子 skill（spec-author / git-ops / code-review / test-design / test-flow-apifox / test-flow-e2e / mr-review / jenkins-deploy）是流程方法论本体，随 skill 一起拷贝，构成 glab-flow 的自包含能力栈。这些子 skill 在运行时会调用一批外部工具，它们是**运行时依赖**而非 vendor 对象：已装即用、未装按需引导安装，**不随 skill 拷贝、不在 skill 仓里维护**。下面列全清单。

### 1. `glab` CLI —— GitLab 读写

GitLab Issue 的全部读写（view / update label / note / close / `glab api`）由 Leader 直接调用 `glab` 完成详见 `SKILL.md`「GitLab 读写」一节。glab 已由环境认证（`glab auth login`），**无需 token、不在环境变量里配 token**。

- 使用方：Leader（每轮编排读状态/应用写回）、`sub-skills/git-ops.md`、`sub-skills/spec-author.md`（读 Issue / 写评论）。
- 未安装或未授权 → 先运行仓库的 `./install.sh --workspace <业务工作区>`（当前仅支持 macOS）。全量安装会安装 `glab`、执行 `glab auth login`，并由 `doctor` 验证；flow 不在无认证下裸跑。

**glab / git 写操作要点**：

- **沙箱**：`git push` / `git pull` / `git fetch` / `glab` 写操作在受限沙箱里会被拦（无网络或无 SSH key）。这类命令需 `dangerouslyDisableSandbox: true`，并确保 SSH/git 在完整 `PATH` 下运行；只读的 `glab issue view` / `glab api GET` 不必禁沙箱。
- **长评论写文件**：评论正文含 backtick / 表格 / 多行时，避开 shell 转义——写临时文件后 `glab issue note <iid> -F <file>`（等价 body=@file），不要硬塞进 `-m "..."`。
- **项目限定**：无 `harnessClone` 时给 `glab issue` 子命令带 `-R <host>/<group>/<project>`（见 `SKILL.md`「GitLab 读写」），避免默认 host 404。
- **合并评论写回**：每个节点流转写一条合并评论（状态变更头 + 内容体，见 `nodes.md`「节点内容评论」），长正文用 `-F <file>` 避开转义；不以本地文件或命令返回成功替代实际写回。

### 2. `codegraph` MCP —— 符号导航 / 影响分析

CodeGraph 是基于 tree-sitter 的代码知识图谱（每个符号、边、文件都已解析）。读取亚毫秒，索引滞后写入约 1 秒。

- 使用方：`sub-skills/git-ops.md`（定位改动符号、查 callers/callees 判断影响面）、`sub-skills/code-review.md`（按改动符号查影响面）、`agents/review-preview.md`（凡把现有系统行为作为阻塞/退回依据，先用 codegraph 或源码证据核实）。
- 工具面：`codegraph_search` / `codegraph_context` / `codegraph_callers` / `codegraph_callees` / `codegraph_impact` / `codegraph_node` / `codegraph_explore` / `codegraph_files`。
- 全量安装使用官方 `@colbymchenry/codegraph` CLI，执行 `codegraph install --target=auto --yes` 接入已发现的 Agent，并对业务工作区执行 `codegraph init`。`doctor` 要求 `.codegraph/` 和 `codegraph status` 都通过；缺失时 flow 不启动。

### 3. `*-reviewer` agents —— 可选的栈专用加速器

栈专用 reviewer 可由 Leader 从 `~/.claude/agents/` 调用（不修改代码，只产出评审意见），但不是完整 flow 的外部前置依赖：未安装时，Leader 必须将本仓 `sub-skills/code-review.md` 的对应栈检查表作为 prompt 注入 `general-purpose` reviewer，产出同样的严重度结论；不得降级成不做评审。

- `php-reviewer` —— PHP / Laravel 专用（Eloquent / middleware / validation / queue / events / service container）。
- `typescript-reviewer` —— TS / JS / Node 专用（类型安全 / async 正确性 / Node 安全 / 惯用法）。
- `java-reviewer` —— Java / Spring Boot 专用（分层架构 / JPA / 安全 / 并发）。
- `security-reviewer` —— OWASP Top 10 / 注入 / SSRF / 不安全加密 / 凭证泄漏。
- `database-reviewer` —— MySQL / PostgreSQL（查询优化 / schema / 迁移安全 / 索引）。
- 使用方：`sub-skills/code-review.md` 按改动文件的技术栈挑选调用；优先专用 agent，否则使用 vendor 的检查表生成通用 reviewer prompt。
- 未安装某栈 reviewer → 记录该加速器缺失，但仍完成完整代码评审与门禁判断。

### 4. Apifox CLI —— API 测试

接口测试**执行**直接使用全量安装的 Apifox CLI（用例设计归 `sub-skills/test-design.md`，执行归 `sub-skills/test-flow-apifox.md`）。本仓的子 skill 已包含编排、回读与证据契约，不依赖其他 Agent skill 包。

- 使用方：`sub-skills/test-flow-apifox.md`（以当前 `apifox <command> --help` 为准，执行 test-design 产出的用例并回传 pass/fail 契约）。
- glab-flow **不自带 Apifox 云端资源**，但全量安装会安装最新 Apifox CLI 并要求安全登录；`doctor` 的 `apifox whoami` 未通过时 flow 不启动。具体项目/环境/测试数据仍由 `/init-glab-flow` 现场配置和回读。
- 资产治理：场景、套件/场景分组、测试数据与场景实例由 Leader 通过当前 CLI `list/get` 回读后形成 `apifox-asset-audit`；引擎只校验该审计，不直接读写 Apifox。测试套件是否可用以当前项目 UI/CLI 为准，不硬编码为全项目必备能力。

### 5. MySQL MCP —— 数据库查验（可选）

只读数据库访问（`mysql_query` 只读模式），用于验证生产/测试库的真实状态以佐证 Issue 判断。

- 使用方：可选——护栏取证（G3 阻塞验证）、bug 排查节点（`mcp__platform-test` / `mcp__tenant-*-test` 等只读实例）。
- 生产库：MCP **不直连生产**；需查生产时用 `kibana_generate_sql` 起草 SELECT → 人工执行后回贴结果（见 `SKILL.md` 配置的 `databases` 字段约定）。
- 未配置 → 不阻塞 flow，跳过 DB 佐证步骤，记录在 lessons。

数据型需求（涉及库存/金额/统计等数据流）：技术方案必须说明代码数据流、数据源决策；如问题要求生产数据，必须附上只读生产取证与路由/授权限制。无法取得所需只读证据时，停止并请用户决定。

### 6. `mr-review-lite` —— MR 评审（可选）

feature→master MR 的评审运行时 skill（推断需求目标 / 需求↔代码一致性 / 识别需求外改动 / bug/回归）。

- 使用方：`sub-skills/mr-review.md`（测试中→待发布 的 `mr_review` 步骤，G14）。
- 优先用它；未安装 → mr-review 降级为自带 `code-review` sub-skill（含跨栈激活维度），结论标注「未用 mr-review-lite」。

### 7. `e2e-runner` / Playwright —— 前端 E2E 执行（可选）

驱动真实浏览器跑 UI 关键流程（Vercel Agent Browser 的 `e2e-runner` 首选，Playwright 降级）。

- 使用方：`sub-skills/test-flow-e2e.md`（测试中 的 e2e 用例执行）。
- 目标环境从 config 的 `test_environments` 取 URL + 账号，不依赖工作区 playwright.config 硬编码 baseURL。
- 未安装 → 用 Playwright 或项目自带 E2E runner 按 test-plan.md 手动执行，标注降级。

### 8. Jenkins 能力发现与手工降级

Jenkins 配置存在、或 skill 显示已安装，均不等于当前运行时可调用。每次 Jenkins-backed 提测前，Leader 先做**能力发现**：确认可调用的 Jenkins 工具、可读取的 job，以及已选择的 job/分支/环境参数。发现结果（automation 构建号/版本，或 manual 降级原因）写进「提测说明」合并评论。

若能力不可调用、job 不可访问或构建自动化明确不可用，不能静默跳过：进入**手工（manual）降级**，在提测说明合并评论中记录不可用原因、人工操作者与时间、部署版本/环境与验证结果。仍需遵守 `jenkins-deploy.md` 的参数确认规则。

## 边界说明

glab-flow 宣称「**完全零外部依赖**」指的是**零外部 skill / 方法论依赖**——整个流程的方法论本体（节点 / 护栏 / 内容生成 / 评审 / 测试 / 发布）都已 vendor 进 `sub-skills/` 与 `nodes.md`/`guards.md`/`gate.md`，没有任何外部 flow skill 或外部方法论的引用。

上述工具（glab CLI / codegraph / 可选 reviewer / MySQL MCP）是**基础设施**。其中 Git、Node、pnpm、glab、Apifox CLI、CodeGraph、ripgrep 与 Playwright 是全量安装器安装并强制验收的本地能力；Jenkins 与数据库访问取决于业务项目配置，必须在 `/init-glab-flow` 或对应节点完成能力发现，不能静默跳过。子 skill 在需要时通过 `../tools.md` 反向引用本文件，避免在每个子 skill 里重复罗列工具清单。

# glab-flow 流转丝滑化 + 审查问题整改（设计）

> 2026-08-07。合并两件事：(1) 方案 1——新增 `transition` 一键命令，把每节点 8 步碎调用收成一次；(2) 最初审查（4 次复盘）沉淀的 P0/P1/P2 问题，按落点并入。本文件既是设计也是实现 checklist。

## 1. 背景与目标

4 次端到端复盘（#123/#110/#146/#138）反复暴露同一类痛：**全流程推进不丝滑**。最痛的是层 1——每个状态推进都要 Leader 手工走 8 步（读状态→查契约→判证据→`validate`→`plan`→预览→确认→`apply`），payload 易错（`@`前缀、`humanConfirmed`、`{payload}` 包裹）、报错太薄。

**目标体验（用户已选 A 打底 + B/C 可选）**：

- **A 一键流转（核心）**：引擎新增 `transition` 命令，一次调用吃掉 8 步里 6 步确定性计算（推导节点 / 抽证据 / 查契约 / **预填 payload** / validate / plan / render preview）。Leader 只剩「2 读 + 1 确认 + 1 应用」。保留人在环。
- **B full-auto（可选层）**：`ok && !hardGate && runMode==='full-auto'` 时跳过确认直放；hard_gate 永远停。
- **C 批量推进（可选层）**：Leader 端循环 `transition → 应用 → 重取 → 再 transition`，遇缺口/hard_gate/终态停。引擎只提供原语，循环在 Leader（保纯计算）。

## 2. 不变量（不可破）

- **引擎纯计算、零 I/O**：`process-contract.test.ts` 禁止引擎 `.ts` 出现 `glab issue`/`glab api`/`issue update`/`issue note`/`child_process`/`fetch(`/`writeFileSync` 等字面量。⇒ **引擎不渲染 glab 命令字符串**，只输出结构化 `WritePlan` + 散文 preview；glab 翻译（含 `-R` 限定）留 Leader 侧（gate.md）。
- **状态机不动**：不改 `state-machine.yaml`（多仓库等维度走 config + render + sub-skill，不进状态机分支）。
- **GuardResult 形状不变**：保持 `{ok, missing: string[], reasons: string[]}`；actionable 信息**融进 reason 文本**，避免大面积测试重写。G11 归一化在同形状内做。
- **文档不放 Issue 特定标识**（`#数字`、`issues/数字`、`MR-数字`）——`process-contract` 会扫。

## 3. 引擎改动（Phase A，TDD）

### 3.1 `engine/src/config.ts` —— 加 `roles` + `jenkins.jobs`

- `GlabConfig` 增 `roles?: Record<string, string>`（角色→`@用户`默认，如 `{产品:'@a',研发:'@b',测试:'@c'}`）。
- `GlabConfig.jenkins` 增可选 `jobs?: Record<string, { jobName; branchParam?; envParam?; defaultParams? }>`（多仓 job 映射）。单 `jobName` 仍兼容。
- RawConfig 加 snake_case `roles`、`jenkins.jobs`。解析同现有模式。
- **测试**（`config.test.ts`）：roles 解析、jenkins.jobs 解析、单 jobName 兼容。

### 3.2 `engine/src/guard.ts` —— G11 归一化 + 报错可操作

- 新增 `normalizeAffirmative(v)`：trim+lowercase 后命中 `{是,true,yes,已验证,已通过,无阻塞,通过}` 视为肯定。G11 用它替 `!== '是'`。
- G3 reason 改：`hard-gate <gate> 需人工确认：在 payload 加 humanConfirmed: true 才能流转`。
- G6 reason 改：`Assignee 必须是具体 GitLab 用户（@前缀；角色名不行，请填 @用户 或在 config 配 roles 默认）`。
- **测试**（`guard.test.ts`）：G11 `是/已验证/无阻塞/true` 通过、`否/未/false/待确认` 拒；G3/G6 既有 `.includes('hard'|'Assignee')` 断言仍成立。

### 3.3 `engine/src/plan.ts` —— 抽出 `buildForwardPlan`

把 `cli.ts` 里 `plan` case 的内联建计划逻辑抽成 `buildForwardPlan(payload, iid): WritePlan`，cli `plan` 与 `transition` 共用。`buildReturnPlan` 已存在不动。

### 3.4 `engine/src/transition.ts` —— 新增 composer（核心）

纯函数 `runTransition(model, config, input): TransitionOutput`：

1. **推导节点** `currentNode`。**脏检测**：0/≥2 状态标签 → `dirty`；`state==='closed' && node∉终态(已完成)` → `dirty`（closed-未终态）。
2. **匹配转换** `to ?? 契约默认下一节点`；无匹配 → `validate.ok=false` 带 hint。
3. **抽证据** `extractEvidence(notes)` → `latest{日期,确认人,结论,…}`。
4. **预填字段**：把证据映射到 `requiredFields`（评审/测试/发布/验收 日期 ↔ 实际日期；各 Assignee/确认人 ↔ 确认人；各 结论 ↔ 结论；`阻塞发布问题均已验证通过` ↔ 阻塞验证）。合并 `input.fields`（用户已给优先）。
5. **解析 Assignee**：交付协同表 `parseAssigneeTable` → `config.roles[assigneeRole]` → `input.assigneeUser`；`ensureAtPrefix` 自动补 `@`。仍无 → 留空交 guard 报 + hint。
6. **组装 Payload**（prefill + provided）→ `validateTransition` → `buildForwardPlan`（或 plan-return）。
7. **preview**：散文 diff（标签增删 / Assignee / 评论摘要 / 是否 close / 还缺什么+怎么补）。**不含 glab 字面量**。
8. **shouldConfirm** = `runMode==='semi-auto' || transition.hardGate || !validate.ok`。
9. 返回 `{node,next,dirty,prefilled,missing[],payload,validate,plan,preview,shouldConfirm,applied:false}`。

### 3.5 `engine/src/cli.ts` —— `transition` 命令

stdin `{type,iid,labels,body,notes,state,to?,fields?,…,config?,runMode?}` → `runTransition` → stdout `TransitionOutput`。命令清单 help 加 `transition`。

### 3.6 `engine/src/types.ts`

加 `TransitionInput` / `TransitionOutput` 接口（含 `missing: {field,hint}[]`——transition 自己丰富，不动 GuardResult）。

### 3.7 测试 `engine/src/transition.test.ts`

脏（0/≥2 标签、closed-未终态）；预填（证据→字段）；Assignee 解析（表 / roles / `@`自动补 / 缺）；G11 归一化经 transition；plan 正确；shouldConfirm（semi/full/hardGate/!ok）。

## 4. 技能文档改动（Phase B，contract-safe）

| 文件 | 改动 | 契约注意 |
|---|---|---|
| `config.md` + `config.example.md` | 加 `roles`、`jenkins.jobs` 字段说明与示例 | — |
| `guards.md` | G11 肯定集合；G3/G6 报错样例（含补救） | — |
| `SKILL.md` | 「Leader 每轮编排」8步→3步（读→`transition`→确认/应用）；full-auto + 批量循环；GitLab 读写补第三条 `-R <host>/<group>/<project>`；closed-脏状态 | 保留 `Leader…glab`、`纯计算`；不放 `#数字` |
| `gate.md` | 门禁仪式改用 `transition`；明确 WritePlan→glab 翻译（Leader，含 `-R`、评论 `-F` 文件）；closed-脏状态 | 保留 `test_version`/`DEPLOY_ENV` 无关；保留 Leader+glab 描述 |
| `nodes.md` | 待发布「生产版本」泛化为各仓版本列表（多仓）；开发中→测试中 标注「上线步骤与配置清单」 | — |
| `resume.md` | 脏状态加 closed-未终态 检测与处置 | — |
| `sub-skills/jenkins-deploy.md` | 默认非阻塞 trigger + 延时 `jenkins_get_build` 轮询；多 job 从 `config.jenkins.jobs` 选 | **必须保留** `test_version`、`DEPLOY_ENV`、`粗粒度授权|笼统授权`、`不等于…参数确认`、`触发前必须展示清单让用户确认` |
| `sub-skills/git-ops.md` | merge→test 加 `--no-verify`(husky) + `git reset --hard origin/test` 对齐；MR 前置 feat vs master diff 检查；CI 失败 `git diff feat...test` 归因 + 删改限本地 | — |
| `sub-skills/spec-author.md` | 加「上线步骤与配置清单」section（A 随代码 / B 各环境手动） | — |
| `tools.md` | 沙箱 git/ssh 写操作（`dangerouslyDisableSandbox` + 完整 PATH）；长评论 `glab issue note -F <file>` | — |

## 5. 审查问题落点映射（一并整改）

| 审查问题 | 落点 | 阶段 |
|---|---|---|
| validate 报错太薄 / G11 精确匹配 | guard.ts G11 归一化 + reason 带补救；transition missing 带 hint | A |
| Assignee 反复反问 / 无 roles 默认 | config.roles + transition 自动解析+补@ | A |
| closed 脏状态未识别 | transition 脏检测 + resume.md/SKILL.md | A/B |
| 流转 8 步碎调用 | transition 命令 + SKILL/gate 3 步 | A/B |
| glab issue `-R` 路径缺失 | SKILL.md 第三条路径 + gate.md WritePlan→glab | B |
| Jenkins watch 阻塞不可靠 | jenkins-deploy.md 默认非阻塞 | B |
| merge test husky + 脏分支 | git-ops.md | B |
| feat 分支混入他人 commit | git-ops.md MR 前置 | B |
| test 分支失败误判己方 | git-ops.md CI 归因 | B |
| 提测缺上线配置清单 | spec-author.md + nodes.md | B |
| 多仓库未建模（轻量） | config.jenkins.jobs + nodes 待发布泛化 + jenkins-deploy 多 job | A/B |
| 沙箱 git/ssh、长评论 -F | tools.md | B |

## 6. 不在本次范围（YAGNI）

- 状态机加 `repos[]` 维度、plan 多仓写回（多仓用 config+render+sub-skill 解决，不进状态机）。
- 节点内子阶段编排（层 2 黑盒，属下一题）。
- MR 评审门禁前置（P2，需新 G + nodes 改动，单独一轮）。

## 7. 验证

`pnpm test`（vitest 全绿，含 process-contract / guard / transition / config / contract）+ `pnpm typecheck`（tsc --noEmit）。

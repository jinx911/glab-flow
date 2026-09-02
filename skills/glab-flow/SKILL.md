---
name: glab-flow
description: 当用户提供 GitLab Issue URL/编号，需要按 DeliveryUnit 驱动的 harness 流程从分诊到上线/验收时使用。引擎只做确定性计算（节点/校验/计划/渲染/配置/状态投影），GitLab 读写由 Leader 直接用 glab CLI 完成，每次写回前预览确认。自有配置与状态缓存，不依赖任何外部 skill。
---

# glab-flow：harness DeliveryUnit 驱动引擎

**Last Updated:** 2026-09-02

glab-flow 是 GitLab-native、自包含的交付引擎：DeliveryUnit（DU）保存交付事实与执行证据，状态机只负责确定性校验和 GitLab 状态投影。引擎只做确定性计算（节点推导 / 护栏校验 / 计划构建 / 文本渲染 / 配置解析 / 状态初始化），所有 GitLab 读写由 Leader 直接用 glab CLI 完成，每次写回前预览确认。项目参数走配置文件，不在代码里硬编码；文档落自有工作目录，不进代码仓。

## 权威来源

业务规则权威来自目标项目已确认的状态机与团队交付规范；glab-flow 的 `state-machine.yaml`、护栏和节点文档是其可执行投影。运行时交付事实权威是 DU 本地主档（GateSet、TestRun/AssetAudit、资源与指标）；GitLab Issue 的 labels/comments 是团队共享的状态投影与协调面，Issue 评论仅作存量证据兜底；本地 state 与 lessons 都是派生缓存或经验材料。

## 输入

`$ARGUMENTS` = GitLab Issue URL 或 iid。

为空（`/glab-flow` 无参）→ 按 `resume.md` 列出未完成 flow：扫描 `<workspace.root>/.glab-flow/*-state.json`，让用户选一个恢复，或开新 flow。

**子命令路由**：首参为 `learn` → 走 `learn.md` 手动命令分支（`/glab-flow learn <note>` 记一条 `manual_note` lesson；`/glab-flow learn --upgrade` 在非终态触发 upgrade ritual），**不进入状态机驱动**。

## 运行时版本守卫（启动第 0 件事；教训见 issue 22：本地副本静默落后，周排期门禁失效）

glab-flow 通过 `~/.claude/skills/glab-flow` 符号链接运行**本仓库当前检出的代码**——本地 master 落后 origin 时，已合并的流转契约（如周排期）会静默失效。每次启动 flow **必须**先做版本检查：

```bash
cd "$ENGINE_ROOT" && git fetch origin --quiet 2>/dev/null; pnpm cli version --fetched
```

- `upToDate: true` → 继续。
- `upToDate: false` → **停止，不推进任何节点**。把 `notes` 展示给用户，引导更新：
  ```bash
  cd <ENGINE_ROOT> && git merge --ff-only origin/master && pnpm install
  ```
  用户明确拒绝更新时，在 flow 中标注「运行于已知陈旧版本（commit=<SHA>）」再继续——但周排期等新契约缺失导致的流转失败，责任在陈旧副本而非流程。
- 非 git 安装（复制分发）→ `version` 会报无法比较；此时以 `capability` 版本人工核对，并在 lessons 记录环境限制。

## 配置（启动第一件事）

glab-flow 是配置驱动的——`host`/`project_id`/`workspace.root` 等参数因项目而异，绝不写死。每次启动 flow，**先读 config**（`$ENGINE_ROOT` 见下文「引擎与命令」节，启动时先解析一次、全局复用）：

1. 按 `config.md` 的查找链取**首个存在**的配置文件（项目级 `<workspace.root>/.glab-flow/config.md` → 全局兜底 `~/.claude/skills/glab-flow/config.md`）。
2. 解析：

   ```bash
   cd "$ENGINE_ROOT" && cat <config.md 路径> | pnpm cli config
   ```

   stdout 是 `GlabConfig` JSON，从中派生后续编排所需的全部项目参数：`gitlab.host` / `gitlab.projectId` / `workspace.root` / `runMode`（以及可选项 `harnessClone` / `deployBranch` / `jenkins` / `databases` / `testEnvironments`）。

3. 解析失败 → 把错误贴给用户，引导重跑 `/init-glab-flow`。配置文件不存在（查找链都没命中）→ 用 `AskUserQuestion` 引导运行 `/init-glab-flow <workspace.root>` 生成项目级配置后再继续——**不让 flow 在无配置下裸跑**。

配置格式、字段语义、查找链细节见 `config.md`。

## 引擎与命令（纯计算，无 I/O）

glab-flow 引擎仓库就是本 skill 所属的仓库（不依赖任何外部 skill）。引擎只做确定性计算，不做任何 GitLab 调用、不读文件系统之外的 I/O；所有副作用由 Leader 跑 glab 产生。

**引擎根解析（每次启动 flow 先做一次，后续复用）**：`install.sh` 把 `skills/glab-flow` 符号链接到 `~/.claude/skills/glab-flow`，故引擎仓库根 = 该符号链接实际目标的"上两级"。启动时解析一次 `$ENGINE_ROOT`，此后所有 `pnpm cli …` 都在它下面跑（形如 `cd "$ENGINE_ROOT" && pnpm cli …`，下文「配置」「Leader 编排」「证据抽取」等各处出现的 `pnpm cli …` 均在此前缀下执行）：

```bash
# 引擎仓库根 = glab-flow skill 符号链接实际目标的「上两级」。
# 注意：macOS 原生 readlink 不支持 -f（BSD），用 python3 realpath 跨平台解析符号链接。
LINK="$HOME/.claude/skills/glab-flow"
ENGINE_ROOT="$(dirname "$(dirname "$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$LINK")")")"
if [ ! -d "$ENGINE_ROOT/engine" ]; then ENGINE_ROOT="$(pwd)"; fi  # 开发态兜底（未安装、直接在仓库内跑）
cd "$ENGINE_ROOT" && pnpm cli <cmd>
```

> 也可先 `pnpm build` 预编译到 `engine/dist`，再用 `node engine/dist/cli.js <cmd>` 跑（省去 tsx 即时编译的冷启动开销，批量推进时更快）；默认 `pnpm cli`（tsx）即可。

命令列表：

| 命令 | 作用 |
|---|---|
| `node` | 推导当前节点：`pnpm cli node <type> <labels...>` |
| `transition` | **一键流转（首选）**：stdin 含普通 Issue 字段（`type`/`iid`/`labels`/`body`/`notes`/`state`）+ 当前 `testPlan` 全文 + 已知 `fields` + 可选 `du`/`declaredScopes`；一次产出 `{node,next,dirty,prefilled,missing[],validate,plan,comment,playbook,nodeProgress,preview,shouldConfirm,actionTier,confirmBatchTitle}`（Story `已评审→开发中` 与 Bug `已确认缺陷→开发中` 传 `declaredScopes` 时另出 `proposedGateSet`；Bug 无声明且无 frozen GateSet 时 fail-closed；Bug 有声明但 DU 未冻结时 `validate=false`、`plan` 未定义、playbook 仅含 `bind_gateset`，冻结后重跑才生成正常 WritePlan/Issue 写回）。把节点编排里的确定性计算（推导/抽证据/查契约/预填/校验/建计划/渲染合并评论/预览）全收拢 |
| `next` | 最短路径速览：stdin 同 `transition` → `{where,isTerminal,blockedOn,fastestPath,owedBy,summary}`——在哪/阻塞什么/最快下一步/谁欠什么；终态自动带资源清理清单 |
| `validate` | 护栏校验（`transition` 内部已含；单独用便于排障）：stdin `{type,labels,payload,body?,notes?,testPlan?}` → `{ok,missing,reasons}`；同时执行正式评论的公共隔离校验；开发中→测试中/测试中→待发布必须传当前 `testPlan` 与刚回读 `notes`，以验证当前环境资产审计和 TestRun |
| `render` | 渲染公共状态评论正文（状态头 + 节点交接内容 + 下一步；DU 证据摘要单独隔离） |
| `plan` | 正向建写回计划：`pnpm cli plan <iid>`，stdin `{payload,body?,notes?,testPlan?}`；周排期和 local/test TestRun 门禁均需传刚回读 `notes`，否则拒绝建计划 |
| `test-run` | 预览/校验一条环境执行记录：stdin `{plan,run}` → `{validate,comment}`；只产出评论草稿，不执行测试或写 GitLab |
| `asset-audit` | 预览/校验一条 Apifox 资产审计：stdin `{plan,audit}` → `{validate,comment}`；只解析计划与回读事实，不调用 Apifox 或写 GitLab |
| `plan-return` | 退回建写回计划：stdin `{type,from,target,issues,confirmer,date,assigneeUser?}` |
| `week-plan-change` | **独立排期变更**：stdin 提供完整排期与变更事实，返回仅含一条 `add_comment` 的 `WritePlan`；不改变状态、Assignee、Issue 正文或既有评论 |
| `change` | **变化分级入口（首选）**：stdin = change-impact 输入 + `du`；自动定级 T1–T4（tier 从 open 单 scopes 重推导、禁自报）+ GateSet 棘轮扩容（`expandedGateSet` 由 Leader 确认后写回 DU，只升不降）+ `closeRequiresPlanVersionBump`（T3+ 才要求测试计划版本递增） |
| `change-impact` | **变更影响单（兼容保留）**：stdin 提供来源、影响维度、当前节点和当前测试计划，返回仅评论的 `WritePlan`、必须同步的产物、建议回退节点和旧计划版本；不直接改状态 |
| `change-close` | **变更闭环（兼容保留）**：stdin 提供刚回读的 notes、open 变更编号及各项完成证据；测试计划受影响时必须传入版本已递增的当前计划（轻量档 T1/T2 豁免）；返回仅评论的关闭回执 |
| `reconcile` | 外部事实对账：stdin `{type,labels,state,du}` → 5 种 verdict（`in-sync`/`label-ahead`/`du-ahead`/`external-close`/`dirty-labels`+`unknown-node`），人工改标签/手动关闭不再当脏状态推倒重来 |
| `resource` | DU 资源登记表：stdin `{du,now,op}`，op=`register`/`check`/`cleanup`/`dispose`；创建即登记、终态出清理清单、处置后回写；临时 Apifox 资源强制 `TMP-<iid>-` 前缀 |
| `metrics` | 交付指标：stdin `{du,event?}`；event 存在记一条指标事件返回新 DU（Leader 落盘），否则纯汇总（确认/流转/重测/环境阻塞/返工/人工介入次数 + 周期） |
| `du` | DU 写入面：stdin `{op,...}`，op=`init`（iid+type）/`bootstrap`（iid+type+从当前 Issue 标签回读的 node，初始化对账基准）/`record`（du+entry 执行事实）/`bind-gateset`（du+scopes，推导+冻结门禁单，已冻结拒重绑）/`cached-node`（du+node，流转成功后更新对账基准）；返回新 DU 对象，落盘归 Leader。`bind-gateset` 由 Leader 执行：绑定首轮只写入并冻结 DU，不写 Issue 状态；落盘后重新运行 `transition`，待正常 `WritePlan` 生成后再执行 Issue 写回与最终回读 |
| `catalog` | workspace 资产目录（R1：复用从「全量 list+人肉比对」变检索）：stdin `{op,...}`，op=`search`（catalog 文本+domain/keyword → 匹配条目）/`upsert`（登记/更新共享资产，按 apifoxId 幂等）/`from-disposal`（du → 终态升级共享的目录条目）；目录文件 `.glab-flow/asset-catalog.md` 由 Leader 落盘——test-design 检索现有资产先查目录，终态 TMP→共享升级时登记 |
| `review-pack` | 评审上下文包：stdin 同 `next` → spec 路径 + DU 证据摘要 + 门禁缺口 + 评审指令段；与 diff 一起注入 reviewer，标准化 feeding 材料（开发中代码评审 / MR 评审共用） |
| `evidence` | 从 GitLab notes 抽证据（确认人/日期/结论/阻塞验证） |
| `config` | 解析配置 markdown → `GlabConfig` JSON |
| `version` | 运行时版本守卫（issue 22）：`--fetched` 表示 Skill 已先 `git fetch origin`；输出 `{commit, upToDate, remoteCommit, capability, notes}`；落后即阻断 |
| `test-config` | 测试上下文注入：stdin = `.glab-flow/test-config.md` 全文；`--repos a,b --env local [--iid N]` → routes 推 Apifox 项目 + 环境 ID + 账号/数据库/前端构建/测试数据，一次拿全（开发中自测步骤 0.5 / 测试中第一步用；模板见 `test-config.example.md`） |
| `state-init` | 生成 state 文件：stdin `{iid,type,host,projectId,workspaceRoot,runMode?,now?}` → `RunState` |
| `state-writeback` | 追加串行写回阶段的成功/失败审计；用于恢复时定位首个未完成阶段 |
| `progress` | 节点内进度跟踪：stdin `{state, step?, resetToNode?, now}` → 更新后的 `RunState`（标记子步骤 done / 换节点重置；引擎纯计算，Leader 落盘） |

## GitLab 读写（Leader 直接 glab CLI）

Leader 直接用 glab CLI 操作 GitLab（glab 已认证，**无需 token**，不在环境里配 token）。三条路径，由配置决定走哪条：

- **有 `gitlab.harnessClone`**：在配置提供的 harness 克隆目录跑 `glab issue …`，glab 自动从 remote 推断 host/project。

  ```bash
  glab issue view <iid> --output json        # 从克隆目录跑
  glab issue update <iid> --label ... --unlabel ... --assignee <@user>
  glab issue note <iid> -m "<正文>"
  glab issue close <iid>
  ```

- **无 `harnessClone`、又想用子命令（不用 `glab api`）**：给子命令带 `-R <host>/<group>/<project>` 限定项目（最轻量）。`<project>` 取 config 的 `project_path`；若只配了数字 `project_id` 则不适用此路，走下面的 `glab api`。

  ```bash
  glab issue view <iid> -R <host>/<group>/<project> --output json
  glab issue update <iid> -R <host>/<group>/<project> --label ... --unlabel ... --assignee <@user>
  ```

- **无 `harnessClone` 或需显式调用**：用 `glab api`，host 与 path 来自配置（`gitlab.host` / `gitlab.projectId`）：

  ```bash
  glab api --hostname <host> "projects/<id>/issues/<iid>"
  glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100&page=1"
  ```

`<host>` 与 `<id>` 一律从 `GlabConfig` 取，不在命令里硬编码域名或项目号。读取 notes 后传给引擎时必须保留每条原始 `body`、`created_at`、`id`；不得仅映射为 `{body}`。GitLab notes API 常按 newest-first 返回，引擎依赖时间戳与 ID 归一化后才可安全判定“最新”回执。

**notes 必须翻页取全（Q6：单页截断=门禁失明）**：长 Issue 的变更影响单（G16）、测试问题评论（G11b）滚出第一页后引擎看不见——open 单不再阻断、阻塞问题漏核。取法：`page=1` 起逐页请求，**返回条数 < per_page 即停**，全部合并去重（按 `id`）后喂引擎。判断截断的捷径：某页恰好返回 100 条就必须再取下一页。MR 的 notes 同样翻页。

## Leader 每轮编排（一键流转）

### 交付工作包（DU）

每个 flow 启动时分别初始化 state 与 DU：Leader 调 `state-init` 生成 `<workspace.root>/.glab-flow/<iid>-state.json`，首次读取 Issue 状态标签后调 `pnpm cli du` 的 `bootstrap` 生成带 `cachedNode` 的 `<workspace.root>/.glab-flow/<iid>/du.json`，两者均由 Leader 落盘。引擎命令只返回不可变的新 DU；Leader 在每次 `record`、`bind-gateset`、`cached-node` 后写回。此后：

- 执行明细（TestRun/AssetAudit）优先记入 DU（`transition`/`validate` 传 `du`），不再要求发独立 Issue 评论（评论瘦身）。**边界**：明细不上传 ≠ 事实不记录——Issue 公共评论的「## 证据摘要」只追加安全的计划版本与通过/失败结论；报告指针、执行明细、内部标识和凭据只留在 DU/内部记录，不能要求成员从公共评论获取。DU 未传入时不追加（存量 Issue 行为不变）。无 DU 的存量 Issue 自动回落评论解析，不迁移。
- Story `已评审→开发中` 与 Bug `已确认缺陷→开发中` 都是 GateSet 绑定边界：传入技术方案声明的 `declaredScopes` 后引擎返回 `proposedGateSet`（含 `skipStates`/`environments`/`mrReview`/`regression`/`rollbackPlan`/`minUnitCases`）。Bug 没有非空 `declaredScopes` 时，必须先传入已有 frozen GateSet；否则 transition fail-closed。若 Bug 有 `declaredScopes` 但 DU 尚未冻结，首次 transition 的 `validate.ok=false`、`plan` 未定义，playbook 只含 `bind_gateset`，不含 `issue_writeback`，因此不会先写 Issue 状态。GateSet 提案与计划提测/上线日期**同一次 L2 批量确认**后，由 Leader 调 `pnpm cli du` 的 `bind-gateset` 写入并冻结 DU；落盘后重新运行 transition，才生成正常 `WritePlan` 和 Issue 写回/最终回读。冻结后不得静默重绑。
- 随时 `pnpm cli next` 看「在哪/阻塞什么/最快下一步/谁欠什么」。
- 人工改了标签/手动部署/外部 CI 结果：`pnpm cli reconcile` 对账（label-ahead=人工推进二选一 / du-ahead=补写回 / external-close=提前关闭处理），不推倒重来。
- 中途发现改错了：`pnpm cli change`（T1 文案→T4 数据/权限自动定级，GateSet 棘轮扩容只升不降，T3+ 关闭时才要求测试计划版本递增）。
- 终态后 `pnpm cli resource --op cleanup`（或直接看 `next`）出清理清单，逐项处置（删除/升级共享/保留）。
- 收尾 `pnpm cli metrics` 看交付指标（确认次数/周期/重测/返工）。

每个节点用 `transition` 一次算完确定性部分，Leader 只做「读 → 确认 → 写」三件事（门禁细节见 `gate.md`）：

1. **读状态（只读 glab）**：`glab issue view <iid> --output json` 取 labels/description/state；`glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100&page=1"` 逐页取全父 Issue 评论（见「notes 必须翻页取全」），并将 API 原样的 `body`、`created_at`、`id` 传入引擎；有受影响 MR 时，逐个读取该 MR 的 notes（同样翻页）。读哪条路径见上文「GitLab 读写」。每次准备 `transition` 都重新读，不能以 state 缓存替代。
2. **一键 transition（1 次引擎调用）**：把 labels/body/notes/state + 已知 fields + 当前 `du` 喂给 `cd "$ENGINE_ROOT" && pnpm cli transition`（stdin JSON）。引擎一次产出：
   - `prefilled`（Assignee 按「交付协同表 → config.roles → 输入」解析并补 `@`；必填字段扫评论「- 字段：值」按精确 key 预填，标「来自评论，请核实」，user 输入优先）
   - `missing[]`（每个缺字段带 hint：来源 / 格式 / 期望值）
   - `validate`（G1–G16，`reasons` 自带补救动作；G14 按 DU GateSet 生效）
   - `plan`（WritePlan：标签 / Assignee / 评论 / 是否 close）+ `comment`（合并评论正文 = 状态变更头 + 内容体，由 `renderNodeComment` 生成）+ `playbook`（本转换副作用动作包，见下）+ `nodeProgress`（当前节点子步骤 checklist）+ `preview`（散文 diff）+ `shouldConfirm` + `actionTier`/`confirmBatchTitle`（动作分层，见 `gate.md`）
3. **执行 playbook + 确认（Leader）**：普通转换的 `playbook` 是本转换的**完整动作包**，执行相位固定为 `pre-writeback`（代码侧）→ `issue-writeback`（Issue 写回并回读）→ `post-readback`（条件同步）。绑定首轮是例外：若存在待绑定 `proposedGateSet`，playbook 只执行 `bind_gateset`，省略 `issue_writeback`，且不写 Issue 状态；Leader 落盘 DU 后重新运行 `transition`，再执行后续正常动作。Leader 必须先完成本轮 `reconcile`，并按序：
   - 代码侧步骤（`subskill` 字段指向 `git-ops` / `jenkins-deploy` / `release-check` / `mr-review`）：委派对应 sub-skill 执行（commit/push、merge→deploy_branch、Jenkins 构建、MR 评审等）。**test/非生产构建参数默认值直用不逐参数确认**（测试数据与凭据同理，已裁定打通；缺定义无默认值才一次问全）；**生产部署参数仍必须逐项确认**（L3 红线）。没配 `deploy_branch` / `jenkins` 的步骤引擎已自动滤除。`mr-review` 步骤只在 DU GateSet 的 `mrReview=true` 时必填（G14，见 `guards.md`）。
   - **issue_writeback（合并评论 + 三阶段串行，每阶段以 `state-writeback` 记录）**：**metadata**（标签 + Assignee）→ **state-comment**（合并评论 = 状态变更头 + 内容体，`renderNodeComment` 生成）→（终态时 close）→ **readback**（最终回读）。内容体按节点见 `nodes.md`「节点内容评论」。`mr-review` 的评审结论作为评论发到每个受影响 MR（G14，无 CRITICAL/HIGH 残留才放行），父 Issue 汇总不能替代 MR-local 评审。
   - **readback 后更新 DU 主档**：只有 Issue 写回各阶段成功且最终回读确认后，Leader 才调用 `pnpm cli du` 的 `cached-node`，传入本次 `next` 的**有效最终目标**（跳状态也传投影后的最终目标），并落盘返回的新 DU；随后再更新 state `cachedNode`/审计。任何写回或回读失败都不得更新该对账基准。
   - **GateSet 运行时动作**：只有当前转换命中的 GateSet 逻辑环境缺少 AssetAudit/TestRun（或要求 full 回归但缺对应证据）时，playbook 才生成 `run_affected_regression` / `run_full_regression`；动作由 `test-flow-e2e` 执行，完成后必须用 `pnpm cli du` 的 `record` 记入该环境证据并重新运行 `transition`。提测时 local 回归动作位于 feature `commit_push` 之后、merge/deploy 之前。GateSet 的逻辑环境当前仅为 `local` / `test`。
   - **生产回滚核对**：GateSet `rollbackPlan=true` 时，生产发布 playbook 使用 `verify_rollback_ready` 核对已由 `release-check` 生成且已回读的回滚方案；`release-check` 仍在 `测试中→待发布` 生成 `release-plan`，发布阶段不重新生成。
   - **post-readback `sync_week_milestone`（仅 `plan.postWriteback` 存在）**：状态或排期评论回读成功、DU/state 更新后，Leader 用最新有效、启用的 `## 周排期` 和 Asia/Shanghai 业务日期决定目标 Week：未开始取计划开始日期所在周，执行中取当天所在周，已结束跳过。目标不存在则创建，存在则关联当前 Issue；必须幂等，且只调整 Milestone。失败写入 `week-milestone-sync` 审计并重试，不撤回已确认的标签、Assignee、正文、评论或 DU/state。Harness 周一任务只接手已初始挂载的 Issue 做后续 rollover，不能替代此步骤。
   - `shouldConfirm` 由**动作分层**决定（`gate.md`）：L1（无 gate 的机械流转）且 `validate.ok` → 直接执行；L2（有业务 gate）/ L3（hard_gate）→ 以 `confirmBatchTitle` 为题做一次 `AskUserQuestion` 批量确认后再执行（计划日期、GateSet 提案、Jenkins 参数并入同一次批量对话）；有缺口按 `missing` 的 hint 委派 sub-skill 补齐，回第 1 步重取。`run_mode` 仅作审计记录，不参与确认判定。
   - 任何标签/Assignee、合并评论或最终回读失败，**立即停止**后续阶段：不更新该阶段未验证的 state/progress；恢复时先回读 GitLab 对账，只重试**首个未完成阶段**，不得重发已回读的评论。细则见 `resume.md`。
   - Issue 写回成功并完成最终回读后更新 state 缓存（见下文），循环到「已完成」或用户停。
   - **节点内进度跟踪（层 2）**：每跑完一个 `nodeProgress` 子步骤，`pnpm cli progress`（stdin `{state, step, now}`）标记 done、写回 state；节点写回成功（换节点）后 `progress`（stdin `{state, resetToNode: <新节点>, now}`）重置进度。这样跨会话 resume 时能看到「开发中：技术方案 ✓ / 编码 ✓ / 自测 ☐」。

`transition` 内部确定性编排 = 推导节点 + 评论字段扫描预填（`scanFieldsFromNotes`：精确 key 优先，缺失则按「实际日期 / 确认人 / 结论 / 依据」语义槽位回填，兼容 `render` 归一化评论）+ `validate` + `plan` + `render` + Assignee 智能预填；门禁退回（G2 二值）仍走 `plan-return`。引擎纯计算、永不写回——输出 `applied` 恒为 false。`evidence` 命令是独立的结构化取证工具（从 `## 状态变更` 块抽固定语义槽位，供 G1/G3/G11 人工排障），不参与 transition 内部预填。

### 需求/方案变更闭环（区别于实施调整）

**「三类改」决策树——改完后，proposal / design / test-plan 里有没有任何一句话变成假的？**

- **没有一句话变假 → 实施调整，不开影响单**：行为本应符合已确认方案，只是从错误实现改为正确实现。开发中=自测迭代（节点内循环，修复后重跑 local，TestRun 最新事实覆盖）；测试中=测试问题评论（renderTestIssue）挂父需求 + 阻塞修复 + 复测，G11 收口，不退回节点。
- **需求口径变假（范围/规则/验收变了）→ 变更**：`change` source=requirement（建议回退 待评审）。
- **技术方案/契约变假（接口、数据模型、权限、路由与 design 不符）→ 变更**：`change` source=technical-design（建议回退 已评审）。
- **实现/测试时才发现方案不可行 → 变更**：`change` source=implementation/test（建议回退 开发中）——注意这是「方案层偏差从实现侧暴露」，不是实现层 bug。

`source` 表达「谁发现的偏差」，`scopes` 表达「什么维度错了」——两者正交；tier 由 scopes 定级，与 source 无关。

发现产物层偏差（后三类）时，禁止仅改代码/文档后继续推进。Leader 先回读 Issue 和当前 `test-plan.md`，调用 `change`（首选；等价于 `change-impact` + 自动定级）预览并经确认新增不可变的 `glab-flow:change-impact:v1 status: open` 评论。输出的 `requiredArtifacts` 是最小闭环清单：按影响更新 proposal/design/test-plan、Apifox 资产、代码、周排期或发布材料；需要状态回退时再调用既有 `plan-return`，不得由变更单暗改标签。tier 由引擎从 open 单 scopes 重推导（禁自报）；若扩容实质改变门禁，`expandedGateSet` 经确认后写回 DU（棘轮只升不降）。

变更影响到测试计划且定级为 T3/T4 时，必须递增 `plan-version`（`closeRequiresPlanVersionBump`）；既有 local/test AssetAudit 与 TestRun 会因版本不一致自动失效。T1/T2 轻量档关闭时豁免版本严格递增检查。完成所有清单项及相应环境重测后，Leader 以刚回读的 notes 调用 `change-close` 生成 `status: closed` 回执。每一次 `transition`/`validate` 都检查未关闭影响单（G16）；任何 open 单都会阻断正向流转。排期维度仍须另走 `week-plan-change` 并将其回读证据写入 close；关闭单不能替代周排期评论或 Milestone 同步。

### 周排期（Harness 协议）

周排期是给 Harness 周滚动读取的、不可改写的 Issue 评论协议。**职责分离**：glab-flow 引擎只产生纯计算的 `postWriteback.sync_week_milestone` 意图，绝不调用 GitLab；Leader 在评论回读成功后完成周内初始挂载；Harness 受保护 master 的周一任务只负责后续 rollover。三者不能互相替代。

Story 的 `待评审 → 已评审` 除既有需求评审证据外，必须提供有效的结构化 `weekPlan`。引擎将下列区块**原样追加一次**到该次合并状态评论；`计划覆盖周`由引擎根据 ISO 周计算，日期和 `自动 rollover` 不得臆测：

```markdown
## 周排期

- 计划开始：2026-08-17
- 计划完成：2026-09-06
- 计划覆盖周：W34 ～ W36
- 自动 rollover：启用
```

Story 的 `已评审 → 开发中` 在既有「计划提测时间 / 计划上线时间」要求外，必须重新读取 Issue notes，并确认**最新** `## 周排期` 区块完整有效（`启用`或`暂停`均有效）。若最新区块无效或缺失，停止流转并报告排期缺口；绝不回退使用更早的有效区块。

排期变化不走状态流转：Leader 调用 `pnpm cli week-plan-change`，提供完整 replacement `weekPlan` 与变更日期、原排期、原因、影响、后续动作、负责人。它只产生一条含 `## 排期变更` 和 replacement `## 周排期` 的评论；按普通预览→确认→写入→回读执行，**不**改标签、Assignee、Issue 正文或既有评论。若计划为启用，引擎同时产生 `postWriteback.sync_week_milestone`，Leader 按上述规则即时重新同步。

### 批量推进（可选）

连续推进多个节点：Leader 端循环 `transition →（shouldConfirm? 确认 : 直放）→ 执行 plan → 重新拉取 → 再 transition`，遇 `!validate.ok`（缺口）/ L2·L3 需确认 / 终态即停。引擎只提供 `transition` 原语，循环在 Leader（保纯计算）。

### 状态缓存

首轮进入 flow 时，Leader 用 `state-init` 生成 state 文件，把"上次到哪一步"缓存到本地：

```bash
cd "$ENGINE_ROOT" && echo '{...}' | pnpm cli state-init
# → 写到 <workspace.root>/.glab-flow/<iid>-state.json
```

之后每轮 Issue 写回并最终回读成功后，先用 `pnpm cli du` 的 `cached-node` 更新 DU，再更新 state 的 `cachedNode`/`cachedNodeAt`/`lastActions`/`writebackAudit`/`updatedAt`；`writebackAudit` 记录串行写回阶段。门禁走 `gate.md`；恢复（无参 `/glab-flow`）走 `resume.md`。**GitLab labels 是对外状态投影的真理，DU 是执行事实与 GateSet 的主档**；state 仅是派生缓存。二者不一致时先 `reconcile`，以最新 GitLab 回读和 DU 事实确定处置，绝不以 state 反向覆盖 GitLab（对账逻辑见 `resume.md`）。

### 学习闭环（learn）

自我迭代闭环由 Leader + markdown 承载（引擎不参与），铁律是「**前面只记录，最后升级**」——run 内只采集、不干预；升级只在终态、且需人工审批。完整设计见 `learn.md`：

- **每节点**：capture lesson（见 `learn.md`），把节点卡顿 / 护栏触发 / 证据缺失 / sub-skill 表现 / 用户修正写入 `<workspace.root>/.glab-flow/<iid>/lessons-<HHmm>.jsonl`，`state.lessonsCaptured++`。只记录、不 distill、不改 skill 文件。
- **终态（已完成/close 后）**：upgrade ritual（distill + 人工审批的 skill 编辑，见 `learn.md`）——distill 本 run lessons 进 `knowledge.md`；视情况 spawn 临时 curator 提议 skill 文件 diff，**经用户审批后才应用**，绝不自动改。
- **flow 启动**：apply（只读 `knowledge.md`，见 `learn.md`）——挑与当前节点/类型相关的条目注入执行上下文；首次无 knowledge → 零开销。

### Assignee 解析与证据抽取

- **Assignee 解析**：从 Issue 正文「交付协同」表取角色对应的 `@用户`（Leader 解析 description）；缺则反问用户，不接受角色名占位（G6）。
- **证据抽取**：

  ```bash
  cd "$ENGINE_ROOT" && glab api --hostname <host> "projects/<id>/issues/<iid>/notes?per_page=100" | pnpm cli evidence
  ```

  从 notes 抽 `## 状态变更` 块的结构化证据（确认人/日期/结论/阻塞问题验证），供护栏 G1/G3/G11 取证。

## 门禁

每节点门禁仪式（取证 → 校验 → 计划 → 预览 → 确认 → 应用，6 步不可跳序）+ 动作分层（L1/L2/L3）+ hard_gate 红线，全部见 `gate.md`。SKILL.md 不重复展开。

## 硬规则

要点（完整判定见 `guards.md` G1–G16）：

- 三类评审分离（G4）：reviewType 必须等于门禁要求，防技评/代码评审替代需求评审。
- 门禁二值（G2）：通过走 `plan`，退回走 `plan-return`，没有"附带条件通过"。
- hard_gate 人工（G3，恒 L3）：生产部署转换（待发布→生产验收中/生产验证中）及终态验收/关闭转换（生产验收中/生产验证中→已完成）必须人工 `humanConfirmed`，无论何种动作分层、GateSet 或 `skipStates`，不可关闭。
- GateSet 跳状态只改变投影路径一层：校验仍按原转换执行，`next`/标签/评论头写最终投影目标；投影后的 hard gate 仍要校验，不得借此绕过 hard_gate。
- Bug `已确认缺陷→开发中` 必须带非空 `declaredScopes` 或已有 frozen GateSet；若首次绑定，Leader 先执行 `bind-gateset` 并写入/冻结 DU，binding pass 不写 Issue 状态；DU 落盘后必须重新运行 transition，待正常 WritePlan 生成后再执行 Issue 写回/回读。
- 冻结不改原文/评论（G7/G8）：永不 `update --description`，永不 edit/delete 已发评论。
- 日期需确认（G10）：`datesConfirmed` 必须为真。
- Assignee 必须 `@用户`（G6），不接受角色名占位。
- 不建 Jira（G13）：流程只在 GitLab Issue 上走，不外建工单。
- 测试问题挂父需求（G11）：阻塞发布问题全部验证通过才放行待发布。
- 变更闭环（G16）：存在未关闭的需求/方案/实现/测试变更影响单时，不得继续正向流转；变化分级 T1–T4，轻量档（T1/T2）关闭时的证据要求随级别降低（T3+ 才要求测试计划版本递增）。
- 多环境测试：按冻结 GateSet 的 `environments`、`regression` 和 `minUnitCases` 校验当前计划；要求某环境时，该环境必须有当前计划版本的 Apifox 资产审计和 TestRun（优先取 DU 证据，Issue 评论兜底）。GateSet 可使轻量路线跳过测试中，但不减少原转换校验字段；单测、构建、静态检查和代码评审不能替代真实业务闭环执行。
- feature MR 评审前置（G14，按 GateSet 生效）：DU GateSet `mrReview=true` 时，测试中→待发布 必填 `feature分支MR评审结论`（用 `code-review` sub-skill 跑 feature→master 全 MR diff，无 CRITICAL/HIGH 残留）；`mrReview=false`（如 frontend-copy）豁免该字段。
- 需求评审取证（G15）：待评审→已评审必须完成所有 Issue 图片的 OCR+视觉核查；有前端页面/菜单/路由信号必须用代码核实实际 URL、组件与分流，找不到即统一提问、不能猜；并以 grilling 决策账本覆盖五类需求分支，任何未决问题都不通过。
- 禁止测试先行仪式：不采用“先写失败测试再实现”的开发仪式；实现后必须完成定向测试、完整业务闭环、全量回归、类型检查和代码走查。

## 内容生成

节点内容生成由 `sub-skills/` 内置子 skill 提供——Leader 对每个节点 Read 对应子 skill 后内联执行，或 spawn `general-purpose` 以其为 prompt：

- 需求/方案 → `sub-skills/spec-author.md`
- 开发 → `sub-skills/git-ops.md` / `sub-skills/code-review.md`（实现后验证）
- 测试 → `sub-skills/test-design.md` / `sub-skills/test-flow-apifox.md`（API）/ `sub-skills/test-flow-e2e.md`（前端 E2E）
- 测试→待发布 MR 评审 → `sub-skills/mr-review.md`（G14，无 HIGH 残留才放行）
- 发布 → `sub-skills/jenkins-deploy.md`（test 构建参数默认值直用；生产部署前必须单独确认 job/分支/部署参数，发布流转确认不等于生产参数确认）
- 运行时工具（非 vendor）见 `tools.md`（codegraph / *-reviewer / apifox-* / glab / MySQL MCP）

自带 agent（随 skill 一起定义，直接 spawn）：

- `intake` —— 分诊/澄清，读 triage Issue 产出澄清问题 + 建议分类 + 建议 Assignee。
- `review-preview` —— 需求评审预审，对照门槛产出评审意见 + 问题清单。
- `release-check` —— 发布前检查，产出风险等级 + 必补事项 + 发布后检查清单 + 回滚方案。

证据不足时（`validate` 返回 `ok:false`），委派对应子 skill/agent 生成缺失内容，落回 Issue 评论或 spec 文档后重走门禁——**门禁不通过 → 回去干活，而不是改门禁**。

## 记忆升级边界

外部 memory / lessons 只能在**泛化、去标识化、加测试并验证通过**后进入本仓。一次性 Issue ID、MR/build 编号、个人映射、临时分支、单个业务需求细节不得写入可复用 skill/docs/agent；这些信息留在 run-local lessons 或外部 memory，升级完成并确认已有版本化承载后再清理。

## 文档落点

所有 issue 文档（需求草稿 / 技术方案 `design.md` / 测试计划 / 回滚等）统一落到：

```
<workspace.root>/.glab-flow/<iid>/spec/
```

路径来自配置（`workspace.root`，见 `config.md`）；`<iid>` 为 GitLab Issue iid。**禁止**写进业务代码仓的 `docs/`——文档归 Docs-as-Code 工作目录，代码仓只放代码。统一存储树见 `nodes.md`。

## 相关文件

glab-flow 的同伴文件（与 SKILL.md 同目录 `skills/glab-flow/`，自包含、无外部 skill 依赖）：

- `config.md` —— 配置格式、字段语义、查找链。
- `nodes.md` —— 节点契约（下一节点 / 必填项 / 门禁 / Assignee 角色 / 文档存储树）。
- `guards.md` —— 护栏 G1–G16 完整判定。
- `gate.md` —— 门禁仪式（6 步）+ 动作分层（L1/L2/L3）+ hard_gate 红线。
- `resume.md` —— 恢复 / 对账（reconcile）/ 脏状态处理 / GitLab 对账。
- `learn.md` —— 自我迭代闭环（capture / apply / upgrade ritual）。
- `tools.md` —— 运行时工具依赖清单（glab / codegraph / *-reviewer / apifox-* / MySQL MCP，非 vendor）。
- `sub-skills/*.md` —— 8 个内置子 skill（spec-author / git-ops / code-review / test-design / test-flow-apifox / test-flow-e2e / mr-review / jenkins-deploy）。

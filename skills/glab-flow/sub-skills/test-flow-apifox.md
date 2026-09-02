---
name: glab-flow-test-flow-apifox
description: local/test 环境的 API 测试执行（经 apifox 运行时工具），回读报告并写入 TestRun。
---

> 本文件是 glab-flow 自有子 skill（方法论，单 Leader）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

## Apifox 资源边界(职责四分,防"跑了但页面看起来像没跑")

| 资源 | 职责 | 关键事实 |
|---|---|---|
| 场景用例 | 多步骤业务流程**编排** | **不绑定执行环境**(environmentId 回读恒 null,页面回退显示本地)——环境只在 run 时 `-e` 指定 |
| 测试套件 | 聚合场景/用例,批量回归入口 | local/Stage 分开建套件(名含环境词的例外:回归入口本身区分环境) |
| 测试数据 | 参数矩阵/边界/迭代数据(一行一 case) | CLI 建的必须回读数据行非空,空壳即删 |
| **测试报告** | **执行证据的事实源** | **以项目级 `test-report list/get` 为准,不默认等同于场景详情页的"测试报告"页签**(该页签可能为空) |

## 执行后证据门禁(强制,不满足不得声明"测试通过")

CLI 执行完成后,**必须** `apifox test-report get <reportId> --project <projectId>` 回读,证据记录:

- 执行命令(完整参数含 `-e`/`--variables`/`--upload-report detail`)
- projectId / branch / **environmentName**(从报告回读,不是猜测)——Stage 测试必须显示 Stage
- **saveDetailType**(回读校验:`all` 才有效;`none` = 缺 `--upload-report detail`,报告页空,须重跑——见「执行后回读校验」)
- 云端 reportId + 报告链接
- **stats 回读**:requests/passed/failed/assertions 计数(与 CLI 输出核对)
- 本地 JSON/JUnit 报告路径
- **场景页签为空时必须写明「项目级报告为准,场景页签不展示执行历史」**——不得写模糊结论

禁止:只凭 CLI stdout 说通过;把"项目级报告存在"写成"场景页签可见";环境显示与实际执行环境不一致时不说明;**saveDetailType=none 的报告当证据用**。

## 测试后资产一致性检查(报告前必做)

回读三份 list 并核对:

```bash
apifox test-scenario list --project <id>   # 标签/命名区分 local vs Stage;Stage 场景在 Stage 分组
apifox test-suite list --project <id>     # 套件非空;local/Stage 各有入口
apifox test-report list --project <id>    # 报告可从项目级查到,environmentName 正确
```

不一致(如页面显示本地但实际跑的 Stage)→ 形成 `presentation` 不匹配，**停止 AssetAudit/TestRun**；只在报告中说明而继续放行是不允许的。

## 测试报告拆两类(glab-flow 合并评论的测试报告内容体)

「测试报告」评论必须拆成两组,不得混写:

1. **执行证据**:CLI 命令 + reportId + environmentName + stats + DB 回读断言——证明"真跑了、真过了"。
2. **Apifox 资产状态**:场景/套件/测试数据是否整理归位、命名分组是否区分环境、页面展示与执行是否一致——描述资产治理水平。

不得把两者混写为「Apifox 已完整沉淀」。

## 矩阵数据沉淀(≥3 组同构)

如「N 条规则 × new/renewal × 扫描件/电子」这类矩阵,落 **Apifox 云端数据集**(一行一 case,字段含员工号/合同类型/归档路径/当前与目标供应商/是否跨公司/期望值如 last_join_at):场景只写一次流程+`{{占位符}}`,执行 `-d <testDataId> -n <N>` 迭代运行。开发中矩阵还在变时可先用本地 `*-data.json` + `-d <path>` 过渡,稳定后按上文「数据集写入通道」沉淀云端。散落在场景内硬编码或 DB seed 的矩阵,复用与审计都差;临时用 seed 可接受,但报告中资产状态组要如实写「未沉淀数据集」。

---

# Test Flow (Apifox)：API 测试执行

本文件规定 API 执行：消费 test-design 产出的接口用例（见同目录 `test-design.md` 的 test-plan.md），在 local 或 test 环境经 apifox 运行时工具执行，回读报告，并将结果写入对应环境的 TestRun。

> **同一计划、两环境执行**：local 与 test 都执行当前 test-plan 中对各自环境要求的 API 用例；若计划还要求 e2e，则同时遵循 `test-flow-e2e.md`。不能把 local 单测/构建成功、test 的一段文字说明，或某个环境的结果当成另一环境的 TestRun。

## Apifox 资产治理与审计（TestRun 前置）

先以当前 CLI `--help` 和项目 UI 发现可用资源，再执行只读 `list/get`。Apifox 当前官方产品对测试套件存在版本/迁移差异：可用时它是冒烟、模块回归、发布回归等稳定聚合入口；不可用时使用场景分组/批量运行，不得伪造 suite 资源或停止复用治理。

1. 从 test-plan 的 `asset:` 声明逐项盘点：`scenario`、`suite-or-group`、`test-data`、`scenario-instance`。
2. 场景必须回读步骤非空；套件/分组必须回读成员非空；测试数据必须回读实际数据行；场景实例必须对应同一流程的环境/数据/循环配置。
3. 新需求先检索现有业务域/功能能力资产，复用或更新优先于新建；新建/更新必须按当前 Apifox schema 校验、写入后 `get` 回读。不得自动删除已有资产。
4. 发现空壳、重复、孤儿、未清理 `TMP-<iid>-` 数据或未能解释的新建资产时停止，处置后重新审计。
5. 将项目、分支、环境、回读证据、计划资产与未处置问题数喂给 `pnpm cli asset-audit`。计划若含 `presentation:` 或 `auth-profile:`，还必须写入 v2 的页面环境三方比对和非敏感认证回执；输出评论新增到 Issue 后回读。只有最新审计通过，才生成 `asset-audit: <plan-version>/<environment>` 的 TestRun。

审计 marker 例：

```text
<!-- glab-flow:apifox-asset-audit:v1
environment: local
plan-version: v3
project: 8731182
branch: main
unresolved-findings: 0
evidence: scenario:list-get:https://app.apifox.com/...
asset: TP-001 | scenario | scenario-101 | reuse
asset: TP-001 | suite-or-group | group-201 | reuse
-->
```

v2 增量（按计划声明逐项出现）：

```text
<!-- glab-flow:apifox-asset-audit:v2
...
presentation: TP-001 | scenario | stage | stage | stage
auth-profile: TP-001 | client-user | auth_token
-->
```

`auth_token` 只是临时变量名，不是 token 值。登录步骤在后置操作中断言登录成功并提取该变量；业务请求统一使用鉴权变量。跨场景运行仅在登录入口位于执行链路开头、命令包含 `--carry-runtime-variables` 时传递；其余独立场景重新登录。

## 登录处理契约（场景建模时统一遵守）

登录不是每个场景各写一套，是**可审计的共用模式**：

1. **登录场景独立且置顶**：需要认证的场景链路，登录步骤放链路开头（这样 `--carry-runtime-variables` 才能把 token 传给后续场景）；独立运行的场景各自带登录步骤。
2. **登录后置三件事**（一个后置脚本 + 一个提取器）：① `pm.test` 断言业务 code=0/HTTP 200（登录失败立即暴露，不带病跑后续）；② 提取器提取 token 到命名临时变量（如 `auth_token`）；③ 业务请求 Header 统一 `Bearer {{auth_token}}`。
3. **token 生命周期跟随执行；凭据可持久化**：token 是每次登录的产物，进运行时变量（`pm.variables.set`）即可，不特意 `pm.environment.set` 持久化（token 本来每次登录都会新取）；**账号密码等测试凭据可持久化到 Apifox 环境/全局变量**（已裁定：减少每轮注入步骤、提效），脚本不硬编码即可。
4. **401/403 = 失败，禁止自动重登**：业务步骤收到 401/403 保留为失败——静默重登会把「token 过期策略缺陷」掩盖成「通过」；确需验证过期行为，那是专门的测试用例，不是重试逻辑。
5. **多角色用多 AuthProfile**：client-user / admin / 只读等角色各一个 profile，各自登录场景提取各自变量（`admin_token` 等）；禁止一个 token 通吃多角色（测不出越权）。

## 前置/后置脚本使用规则

场景建模（test-design 建/改场景时）按职责放脚本，Apifox 脚本语法细节读 `apifox-test-scenario` skill（`preProcessors[*].data` / `postProcessors[*].data`、`pm.*` API）：

| 位置 | 放什么 | 典型例子 |
|---|---|---|
| **场景前置** | 鉴权准备、生成随机值、初始化数据状态 | `pm.variables.set('orderNo', 'TMP-' + Date.now())`；跑 fixture 前置 SQL（或数据库步骤） |
| **步骤后置·提取** | 从响应提取变量供下游引用 | 提取 `$.data.token` → `auth_token`；提取创建的单据号给查询/取消步骤 |
| **步骤后置·断言** | 业务断言（结构/字段/状态码） | `pm.test` 断言 code=0、金额分单位、列表非空 |
| **场景后置·清理** | 撤销副作用、清理测试数据 | 删除本场景创建的临时单据（`pm.variables.get` 取单号调删除接口）——**有副作用的场景必须带清理**，主流程失败也尽量执行 |

硬规则：

- **跨步骤取值用 `pm.variables.get("$.<步骤号>.response.body.<字段>")`**，不要在脚本里写 `{{...}}` 模板（脚本内不解析）。
- **脚本不写死任何环境差异值**（URL/账密/环境 ID）——环境差异走 `-e` + `--variables`，脚本只处理逻辑。
- **变量写入分级**：临时值（单次执行内）用 `pm.variables.set`；确需跨场景传递的（token/单号链）依赖 `--carry-runtime-variables`，命名加业务前缀防碰撞（`auth_token`/`order_no`）。
- **脚本步骤输入输出显式**：脚本读写哪些变量在场景描述里写明，避免隐式全局副作用；清理步骤即使主流程失败也要能执行（放 finally 语义的位置）。

## 报告上传说明

`--upload-report detail` **不需要单独授权**——它随 Apifox CLI 登录态直接创建云端报告并上传请求/响应详情，是执行命令的常规参数，正常带上即可。

1. 执行前展示本次将写入的目标（信息同步，非授权申请）：Apifox `projectId`、branch、environment、suite、数据集前缀。
2. 若 CLI 实际返回外部 AI 写入拒绝（项目侧分支未开外部 AI 编辑权限），按 apifox-cli-checkup 排查：引导在“项目设置 → 功能设置 → AI 功能设置 → 外部 AI 编辑权限”开启，或由人工在同一 suite、环境、变量和数据集下执行。
3. `--upload-report detail` 不可省略或降级（`none` 报告页空、不能当证据），也不得只凭 stdout 宣称通过。先执行 `apifox test-suite run --help` 确认当前 CLI 支持 `detail`；不支持则升级 CLI，不臆造替代值。

人工执行也必须提供 reportId 并完成下述 `test-report get` 回读；没有可回读的详情报告就不能形成 TestRun。

## 执行环（E0–E4，local 与 test 各跑一遍，环境有序不可跳）

每次进入一个环境（local 在开发中收尾、test 在测试中第一步），按固定环执行；任一步失败停在该步，指明具体段，不裸跑：

| 步 | 内容 | 失败处置 |
|---|---|---|
| **E0 上下文注入+数据整理** | `test-config --env <环境>` 拿全 envId/凭据/数据库 MCP/数据前缀；跑本环境前置 fixture（按 test-plan「前置 fixture」节顺序）；从**本环境库**取真实行值灌入本环境数据集（追加式，重灌先删旧行）；**禁跨环境行值** | 配置缺失/库不可连 → 停，报告缺口 |
| **E1 预检** | 三段链路健康（下节）+ 运行版本校验 + 凭据解析 + 命令参数完备表 | 任一失败 → 停，指明哪段 |
| **E2 审计** | 按 test-plan `asset:` 声明逐项回读盘点（上方「资产治理与审计」）；生成 `asset-audit` 记 DU | 空壳/漂移/未清理临时数据 → 停，处置后重审 |
| **E3 执行** | 全参命令跑计划用例（下方 CLI 模板，`-e` 切环境） | 失败 → 走「失败回环」 |
| **E4 回读三核** | `test-report get`：saveDetailType=all / environmentName=本环境 / stats 与 CLI 输出核对 | `none` 或环境不符 → 执行无效，带全参重跑 |

E4 三核通过 + 最新资产审计通过 → `cli du record` 记本环境 TestRun 事实（kind/environment/planVersion/outcome/detailRef=报告指针），门禁消费。

## 失败回环（执行侧规则，引擎版本失效之外的过程纪律）

执行失败后按改动对象分流，**不笼统「修了重跑」**：

1. **改了代码/环境**（实现缺陷，方案没错）→ 修复后**test 环境先重新部署并核对版本**（E1 版本校验对 Jenkins 部署产物），再该环境重跑 E3-E4，plan-version 不动——这是实施调整（见 SKILL.md「三类改」决策树），不开变更单。**禁止跳过重部署直接复测**：复测跑在修复前旧版本上，全绿也是假证据。
2. **改了资产**（场景步骤/断言/数据集结构）→ local 已跑过则**回 local 重跑** E2-E4（local 验证过的不是最终资产），再跑 test。
3. **改了计划**（用例/范围/环境要求实质变化）→ 递增 `plan-version`，旧 TestRun/AssetAudit 自动失效；是否开变更单按「三类改」判据（改完后 proposal/design/test-plan 有话变假才开，T3+ 才强制版本递增闭环）。
4. 修复动作跨环境（改了共享场景）→ 两环境都要重跑，不能只补失败的那个环境。

## 执行前预检（强制，任一失败停止执行）

1. **三段链路健康**：登录入口（PHP 站，返回登录页/JSON，HTML 404 = API 配到了前端站）→ 接口网关（业务前缀非 text/html）→ 后端 service（健康检查）。失败时指明哪段断，修好前不跑套件。
2. **运行版本校验**（每环境必做，不只 local）：优先 `/actuator/info` 读 commit SHA——local 与当前工作树 `git log -1` 比对；**test 与本次 Jenkins 部署产物比对**（提测/复测重部署的构建号或部署后 actuator 回读的 SHA）。不一致 → local 要求重建重启、test 要求重新部署，不跑源码新/旧 class 的假验证。版本值回读后作为 `du record` 的 `version` 必填字段——它就是「复测没跑在旧版本上」的核对物。
3. **凭据自动注入（非生产环境无需授权确认，可持久化）**：local/test 环境的账号密码是测试数据，从 test-config 的 `credentials` / apifox-vars.json 直接自动取用注入，**不逐次询问确认**；解析失败（引用缺失/配置错）才停下报告缺口，不跑假登录。**凭据可持久化到 Apifox 环境/全局变量**（减少每轮注入步骤、提高执行效率——测试凭据持久化已裁定可接受）；生产环境凭据不在此机制内（生产操作恒 L3 人工）。
4. **命令参数完备**：套件/场景 run 命令必须逐项含 `-e <envId>`、`--variables <vars文件>`、`--carry-runtime-variables`、`--upload-report detail`、（矩阵场景）`-d <testDataId>`——发命令前对照模板逐项核对，缺任一即废命令重拼，**不跑缺参命令**。

## 执行后回读校验（报告有效性门禁）

`apifox test-report get <reportId>` 回读时**必须检查 `saveDetailType` 字段**：

- `saveDetailType: "all"` → 合规（含请求/响应详情，可排障）
- `saveDetailType: "none"` → **本次执行视为无效**：页面看得到报告但没有详情（用户点开是空的），即使 stats 全绿也不算证据——带全参数重跑，换新 reportId 再回读

历史踩坑：Stage 验收套件跑了 7 单 `none`（执行时漏 `--upload-report detail`），页面打开全空，只能重跑。

接口用例由 test-design 设计完毕（写在 `test-plan.md` 里），本阶段只做执行。直接使用全量安装的 Apifox CLI，并先以当前 `apifox <command> --help` 核对参数：

### CLI 执行命令模板（套件/场景 run 的固定参数）

```bash
apifox test-suite run <suiteId> --project <projectId> \
  -e <envId> \                              # 环境(test-context 的 apifoxTargets[].envId,切 local/test 就是它)
  --variables .glab-flow/apifox-vars.json \  # ★环境变量注入文件:凭据+跨环境参数按环境条目存,CLI 按 -e 的 ID 自动匹配
  -d <testDataId> \                          # 矩阵场景才加:云端数据集一行一轮迭代(非矩阵场景不传)
  --carry-runtime-variables \                # ★必须:登录场景后置写的 x_client_token 跨场景可见(默认关闭,不加则业务场景全裸)
  --upload-report detail \                   # ★detail 级:上传含请求/响应详情的云端报告(排障能看当时发了什么;总览级只有计数)
  --reporters cli,json --out-dir <dir>
```

- `--variables`、`--carry-runtime-variables`、`--upload-report detail` 三参数不可省：第一个是环境切换的全部秘密（base_url 由 `-e` 切、凭据/参数由该文件按环境注入），第二个是登录 token 传递链路的一半，第三个是失败排障的证据来源；报告链接（`https://app.apifox.com/link/...`）记入执行记录。
- **切环境 = 只换 `-e` 的环境 ID**，场景/套件/变量文件全部不动。
- 数据驱动（多组同构参数）见下方「测试数据集使用规则」。

### apifox-vars.json 格式（官方 --variables 文件）

```json
{
  "environments": [
    { "id": <本地envId>, "variable": { "values": [
        {"key": "local_client_email", "value": "...", "type": "any"},
        {"key": "data_prefix", "value": "E2E{iid}L", "type": "any"}
    ]}},
    { "id": <Stage envId>, "variable": { "values": [
        {"key": "local_client_email", "value": "...", "type": "any"},
        {"key": "data_prefix", "value": "E2E{iid}T", "type": "any"}
    ]}}
  ],
  "globals": {"variable": {"values": []}}
}
```

- 文件路径记在 test-config 的 `variables_file`；`environments` 是数组——**一份文件装所有环境**，CLI 按 `-e` 匹配条目。
- ⚠️ **CLI 与环境变量的坑（实测三轮坐实）**：Apifox 环境 UI / `environment update` 写的变量，CLI 运行时**取不到**（下发时 key 被剥离，占位符解析为空、登录 1000001108）。CLI 路线的环境变量**只认 `--variables` 文件**。UI 手工配的变量只对 UI 发起的测试生效。

### 测试数据集使用规则（判断口诀）

> **随环境轴变（每环境一值）→ apifox-vars.json；随轮次轴变（同环境 N 值）→ Apifox 云端数据集（-d testDataId）；不变 → 写死在 case。**

区分标准是**参数在哪根轴上有多个值**，不是参数种类（账号和业务参数走同一机制）：

- **环境轴**（每环境恰好一个值：账号/密码、供应商ID映射、company_id、data_prefix）→ `apifox-vars.json` 对应环境条目，场景里写 `{{key}}` 占位符，`-e` 切换自动跟随。**不放测试数据**——`-d` 是"把所有行跑一遍"，放环境参数会在同一 base_url 下用别环境的凭据跑一轮，必挂。
- **轮次轴**（同环境内要跑 N 组：case_id/类型枚举/边界矩阵/员工号）→ **Apifox 云端数据集**（自动化测试 → 测试数据，按需求建目录归位），执行 `-d <testDataId>` 一行一轮迭代。**testDataId 从 test-plan 映射表当前环境行取**——行值含环境业务键（员工号/单号）时每环境各建一份（同名、环境属性区分），仅行值在两环境库都真实存在才共用一份（映射表标「共用」）。
- **逻辑常量**（如 `end_date=9999-12-31`、`years=99`）→ 留在 case 请求体，抽到数据集丢语义。
- **行值必须来自本环境真实库**（编造员工号→业务 code≠0 假失败；且数据要沉淀保留，假行值=长期毒资产）；有前置 seed 的场景先跑 SQL fixture（E0 按计划顺序）。禁跨环境行值——详见 test-design.md「数据真实性铁律」。
- **数据集写入通道**（实测打通）：元数据 CLI 建（`test-data create`，只收 name/type/folderId）；**行数据走 UI 内部 API**——浏览器登录 app.apifox.com 后同源 `POST /api/v1/projects/<pid>/test-data`，body `{relatedId:0, dataSetId, environmentId:0, data:"<CSV文本>", columns:{列:{generator:{type:"rule",config:{callee:"$special.manual"}}}}, relatedType:3}`；**POST 是追加不是覆盖**，重灌后删旧行（`DELETE /test-data/<rowId>`，先 `GET /test-data?dataSetId=` 列出）。CLI 官方 schema 无行字段。
  - ⚠️ **建数据集必须显式 `relatedType: "PUBLIC"`**：省略时服务端默认 `TEST_SCENARIO + relatedId=0`（绑定到不存在的场景）——数据集**从全局列表/目录树消失**（按 ID 直查还在，`-d` 也能跑，但页面看不见、无法管理）。踩坑实录：批量建 13 个漏了该字段，次日检查发现"只剩 1 个"，PUT 补 `relatedType:PUBLIC` 后全部恢复可见。
  - **沉淀后必检**：`test-data list` 数量与预期一致——不一致立即按 ID 直查排 relatedType。
- 返回值断言不进数据集（那是断言的事）；行值可被后置脚本提取写入全局变量供下游场景引用（与 token 同机制）。
- 本地 `*-data.json` 是云端沉淀前的过渡形态，沉淀后 `-d <testDataId>` 执行，本地文件仅留档。

| 用例形态 | Apifox CLI 入口 | 用途 |
|---|---|---|
| 单接口用例 | `apifox test-case` / `apifox run --test-case` | 跑单个接口的请求/响应/断言 |
| 多接口编排（场景流） | `apifox test-scenario` | 跑按序串联的业务场景（如登录→下单→支付） |
| 自动化测试套件 | `apifox test-suite run` | 跑一批用例的自动化集合 |
| 命令行批量执行 | `apifox run` | 在 CI 或批量场景用 CLI 跑用例集 |

Apifox CLI 是全量安装并由 `doctor` 验收的运行时工具（见 `../tools.md`）；glab-flow 不自带 Apifox 云端资源，只提供执行方法论与结果契约。调用约定：

- **同步取结果**：执行后必须拿到结构化结果（通过/失败计数 + 失败明细），不异步丢任务。
- **对齐 test-plan.md**：执行范围对齐 test-design 产出的接口用例清单，每条用例的执行结果回填到它的用例编号，便于追溯。**环境与 `-d` 参数从 test-plan.md 的「测试环境与数据集」章节读**（环境矩阵 + 场景↔数据集映射表），不在执行时现场翻 config 或猜数据集。
- **Apifox 不可用时**：停止该 API TestRun，报告缺口并请用户修复 Apifox 能力或人工在 Apifox 执行；不得以本地 HTTP 客户端输出替代要求上传详情报告的 API 证据。

## 结果收集

结果按**证据三段式**收集，作为对应环境 TestRun 的 `api` 证据。口头「接口都通了」不被接受。

**响应耗时分域统计**（防共享登录波动污染发布判断）：业务接口请求按 SLA 判定（默认 500ms）；登录/认证步骤单列基线（默认 2000ms，参考不阻断）；套件总耗时只作参考。归类按场景名（含 login/auth/token 或场景首步认证步骤归登录基线），无法归类时保守归业务 SLA 并注明。

1. **命令**：实际执行的 Apifox CLI 调用（含用例集范围、环境参数）。
2. **计数**：汇总行，形如 `接口用例: X passed, Y failed, Z skipped`（或 apifox 等价输出）。
3. **失败列表**：逐条列 `用例编号 — 接口 — 失败原因摘要（状态码/断言差异）`；全绿则写「无失败」。
4. **云端报告链接**：`--upload-report detail` 产出的 `https://app.apifox.com/link/...`（含请求/响应详情，排障与复查入口）。

结果与 test-plan.md 的用例编号一一对应，方便定位哪条验收标准的测试未过。报告回读全绿且最新资产审计通过后，以 `pnpm cli test-run` 生成当前环境的 marker（必须带 `asset-audit: <plan-version>/<environment>`）；新增到 Issue 后再次回读，才可把该 TestRun 传给 `transition`。

## 挂评论

测试问题（失败的用例、发现的缺陷）以评论形式挂父 GitLab Issue：

- **挂评论命令**：`glab issue note <iid> -m "<测试结果正文>"`（见 `../gate.md` 第 5 步）。评论只新增，不改历史（G8，见 `../guards.md`）。
- **不建 Bug Issue**（G13，见 `../guards.md`）：测试问题挂父需求评论，不为单个问题新建独立工单 Issue。glab-flow 以父需求为流转单元，问题在父需求评论里跟踪到关闭。
- **阻塞问题放行规则**（G11，见 `../guards.md`）：**阻塞发布的问题须全部验证通过**才能放行「待发布」。非阻塞问题（MEDIUM/LOW 级，不影响主流程）可记录后带过，但阻塞级（CRITICAL/HIGH）必须全部复测绿，门禁才放行。
- **正文格式**：评论正文包含计数 + 失败列表（上面的三段式），并标注哪些是阻塞级、是否已全部验证。

## glab-flow 上下文

- **节点归属**：local 执行在「开发中」收尾，test 执行在「测试中」收尾。产出是已回读的 Apifox 报告和对应环境 TestRun，不以测试结果评论代替 TestRun。
- **单 Leader**：Leader 调度 apifox 运行时工具、收集结果、判定阻塞、挂评论，不组建多 agent 团队，不引入团队编排、状态文件或阶段闸门管道。需要并行跑多场景时 spawn 至多一个 `general-purpose`。
- **门禁对齐**：local TestRun 是「开发中→测试中」门禁，test TestRun 是「测试中→待发布」门禁（见 `../gate.md`）。阻塞问题、报告详情缺失或最新 TestRun 无效 → Leader 不推进状态。

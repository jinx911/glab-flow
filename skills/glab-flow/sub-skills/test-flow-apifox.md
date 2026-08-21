---
name: glab-flow-test-flow-apifox
description: 测试中节点的 API 测试执行（经 apifox 运行时工具），收集结果并挂父需求评论。
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

- 执行命令(完整参数含 `-e`/`--env-var`/`--upload-report detail`)
- projectId / branch / **environmentName**(从报告回读,不是猜测)——Stage 测试必须显示 Stage
- 云端 reportId + 报告链接
- **stats 回读**:requests/passed/failed/assertions 计数(与 CLI 输出核对)
- 本地 JSON/JUnit 报告路径
- **场景页签为空时必须写明「项目级报告为准,场景页签不展示执行历史」**——不得写模糊结论

禁止:只凭 CLI stdout 说通过;把"项目级报告存在"写成"场景页签可见";环境显示与实际执行环境不一致时不说明。

## 测试后资产一致性检查(报告前必做)

回读三份 list 并核对:

```bash
apifox test-scenario list --project <id>   # 标签/命名区分 local vs Stage;Stage 场景在 Stage 分组
apifox test-suite list --project <id>     # 套件非空;local/Stage 各有入口
apifox test-report list --project <id>    # 报告可从项目级查到,environmentName 正确
```

不一致(如页面显示本地但实际跑的 Stage)→ 在报告中**单列说明**,不静默。

## 测试报告拆两类(glab-flow 合并评论的测试报告内容体)

「测试报告」评论必须拆成两组,不得混写:

1. **执行证据**:CLI 命令 + reportId + environmentName + stats + DB 回读断言——证明"真跑了、真过了"。
2. **Apifox 资产状态**:场景/套件/测试数据是否整理归位、命名分组是否区分环境、页面展示与执行是否一致——描述资产治理水平。

不得把两者混写为「Apifox 已完整沉淀」。

## 矩阵数据沉淀建议(≥3 组同构)

如「N 条规则 × new/renewal × 扫描件/电子」这类矩阵,优先落 **Apifox test-data**:一行一 case,字段含员工号/合同类型/归档路径/当前与目标供应商/是否跨公司/期望值(如 last_join_at);场景只写一次流程,`-d <testDataId> -n <N>` 迭代运行。散落在场景内硬编码或 DB seed 的矩阵,复用与审计都差;临时用 seed 可接受,但报告中资产状态组要如实写「未沉淀 test-data」。

---

# Test Flow (Apifox)：API 测试执行

「测试中」节点（见 `../nodes.md`）的工作 agent 是 `test-design / test-flow-apifox`。本文件规定其中 test-flow-apifox 部分：消费 test-design 产出的接口用例（见同目录 `test-design.md` 的 test-plan.md），经 apifox 运行时工具执行，收集结果并挂父 GitLab Issue 评论。

## 执行前预检（强制，任一失败停止执行）

1. **三段链路健康**：登录入口（PHP 站，返回登录页/JSON，HTML 404 = API 配到了前端站）→ 接口网关（业务前缀非 text/html）→ 后端 service（健康检查）。失败时指明哪段断，修好前不跑套件。
2. **运行版本校验**（本地环境）：优先 `/actuator/info` 读 commit SHA，与当前工作树 `git log -1` 比对；不一致 → 要求重建重启，不跑源码新/旧 class 的假验证。
3. **凭据运行时注入**：从 test-flow 项目配置读凭据（keychain:// 或环境变量引用），解析失败停下问用户，不跑假登录；凭据不持久化到 Apifox 全局变量。

## 执行

接口用例由 test-design 设计完毕（写在 `test-plan.md` 里），本阶段只做执行。用 apifox-* 运行时 skill 跑用例，按用例类型选择：

### CLI 执行命令模板（套件/场景 run 的固定参数）

```bash
apifox test-suite run <suiteId> --project <projectId> \
  -e <envId> \                              # 环境(test-context 的 apifoxTargets[].envId,切 local/test 就是它)
  --carry-runtime-variables \                # ★必须:登录场景后置写的 x_client_token 跨场景可见(默认关闭,不加则业务场景全裸)
  --env-var "local_client_email=<账号>" \    # 凭据运行时注入(变量名来自 test-config credentials.vars)
  --env-var "local_client_password=<密码>" \
  --upload-report detail \                   # ★detail 级:上传含请求/响应详情的云端报告(排障能看当时发了什么;总览级只有计数)
  --reporters cli,json --out-dir <dir>
```

- `--carry-runtime-variables`、`--upload-report detail` 两参数不可省：前者是登录 token 传递链路的一半，后者是失败排障的证据来源；报告链接（`https://app.apifox.com/link/...`）记入执行记录。
- 数据驱动（多组同构参数）见下方「测试数据集使用规则」。

### 测试数据集使用规则（判断口诀）

> **换环境变的 → test-config；每轮变的 → 测试数据集；永远不变的 → 留在 case 里。**

- **轮次变量**（每轮测试要不同的值：case_id/类型枚举/供应商/员工号等）→ Apifox「自动化测试-测试数据」建数据集（N 行 × 这些列），执行 `-d <testDataId> -n <N>` 按行循环，场景断言写一次。
- **≥3 组同构数据**（合同类型枚举、边界矩阵等）→ 优先数据集驱动，**不复制 case**。
- **环境身份**（账号/密码）→ 不进数据集，走 `--env-var`（test-config credentials）。
- **逻辑常量**（如 `end_date=9999-12-31`、`years=99`）→ 留在 case 请求体，抽到数据集丢语义。
- **CLI 创建的 test-data 必须回读数据行非空**——`test-data create` 只建元数据，空壳数据集是垃圾资产，发现即删（历史踩坑）。
- 返回值断言不进数据集（那是断言的事）；数据集列值可被后置脚本提取写入全局变量供下游场景引用（与 token 同机制）。

| 用例形态 | apifox 运行时 skill | 用途 |
|---|---|---|
| 单接口用例 | apifox-test-case | 跑单个接口的请求/响应/断言 |
| 多接口编排（场景流） | apifox-test-scenario | 跑按序串联的业务场景（如登录→下单→支付） |
| 自动化测试套件 | apifox-test-automation | 跑一批用例的自动化集合 |
| 命令行批量执行 | apifox-cli | 在 CI 或批量场景用 CLI 跑用例集 |

skill 是**运行时工具**（见 `../tools.md`），glab-flow 不自带 apifox 能力，只提供执行方法论与结果契约。调用约定：

- **同步取结果**：执行后必须拿到结构化结果（通过/失败计数 + 失败明细），不异步丢任务。
- **对齐 test-plan.md**：执行范围对齐 test-design 产出的接口用例清单，每条用例的执行结果回填到它的用例编号，便于追溯。
- **未装 apifox 时降级**：Leader 不报错中止，改为用 HTTP 客户端（如 curl / 项目自带测试客户端）按 test-plan.md 的期望契约手动执行，并在结果里标注「未用 apifox，人工执行」。降级结果同样须满足下面的证据三段式。

## 结果收集

结果按与 `tdd-guide.md` 一致的**证据三段式**收集，作为「测试验收」门禁的输入（见 `../gate.md`）。口头「接口都通了」不被接受。

**响应耗时分域统计**（防共享登录波动污染发布判断）：业务接口请求按 SLA 判定（默认 500ms）；登录/认证步骤单列基线（默认 2000ms，参考不阻断）；套件总耗时只作参考。归类按场景名（含 login/auth/token 或场景首步认证步骤归登录基线），无法归类时保守归业务 SLA 并注明。

1. **命令**：实际执行的 apifox skill / CLI 调用（含用例集范围、环境参数）。
2. **计数**：汇总行，形如 `接口用例: X passed, Y failed, Z skipped`（或 apifox 等价输出）。
3. **失败列表**：逐条列 `用例编号 — 接口 — 失败原因摘要（状态码/断言差异）`；全绿则写「无失败」。
4. **云端报告链接**：`--upload-report detail` 产出的 `https://app.apifox.com/link/...`（含请求/响应详情，排障与复查入口）。

结果与 test-plan.md 的用例编号一一对应，方便定位哪条验收标准的测试未过。

## 挂评论

测试问题（失败的用例、发现的缺陷）以评论形式挂父 GitLab Issue：

- **挂评论命令**：`glab issue note <iid> -m "<测试结果正文>"`（见 `../gate.md` 第 5 步）。评论只新增，不改历史（G8，见 `../guards.md`）。
- **不建 Bug Issue**（G13，见 `../guards.md`）：测试问题挂父需求评论，不为单个问题新建独立工单 Issue。glab-flow 以父需求为流转单元，问题在父需求评论里跟踪到关闭。
- **阻塞问题放行规则**（G11，见 `../guards.md`）：**阻塞发布的问题须全部验证通过**才能放行「待发布」。非阻塞问题（MEDIUM/LOW 级，不影响主流程）可记录后带过，但阻塞级（CRITICAL/HIGH）必须全部复测绿，门禁才放行。
- **正文格式**：评论正文包含计数 + 失败列表（上面的三段式），并标注哪些是阻塞级、是否已全部验证。

## glab-flow 上下文

- **节点归属**：「测试中」节点（`../nodes.md`），Leader Read 本文件内联执行或 spawn `general-purpose` 以本文件为 prompt。产出是测试结果评论 + test-plan.md 的结果回填，不产出新的 spec 文档。
- **单 Leader**：Leader 调度 apifox 运行时工具、收集结果、判定阻塞、挂评论，不组建多 agent 团队，不引入团队编排、状态文件或阶段闸门管道。需要并行跑多场景时 spawn 至多一个 `general-purpose`。
- **门禁对齐**：测试结果是「测试验收」门禁的输入（见 `../gate.md`）。阻塞问题未全验证 → Leader 不推进状态（见 `../gate.md`「证据不足时」）；全验证通过 → 建 plan 推向「待发布」（Assignee=研发，见 `../nodes.md`）。

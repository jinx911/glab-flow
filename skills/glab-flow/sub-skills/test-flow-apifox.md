---
name: glab-flow-test-flow-apifox
description: 测试中节点的 API 测试执行（经 apifox 运行时工具），收集结果并挂父需求评论。
---

> 本文件是 glab-flow 自有子 skill（方法论，单 Leader）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# Test Flow (Apifox)：API 测试执行

「测试中」节点（见 `../nodes.md`）的工作 agent 是 `test-design / test-flow-apifox`。本文件规定其中 test-flow-apifox 部分：消费 test-design 产出的接口用例（见同目录 `test-design.md` 的 test-plan.md），经 apifox 运行时工具执行，收集结果并挂父 GitLab Issue 评论。

## 执行

接口用例由 test-design 设计完毕（写在 `test-plan.md` 里），本阶段只做执行。用 apifox-* 运行时 skill 跑用例，按用例类型选择：

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

1. **命令**：实际执行的 apifox skill / CLI 调用（含用例集范围、环境参数）。
2. **计数**：汇总行，形如 `接口用例: X passed, Y failed, Z skipped`（或 apifox 等价输出）。
3. **失败列表**：逐条列 `用例编号 — 接口 — 失败原因摘要（状态码/断言差异）`；全绿则写「无失败」。

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

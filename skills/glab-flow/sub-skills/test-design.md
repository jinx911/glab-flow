---
name: glab-flow-test-design
description: 测试中节点的测试计划设计（用例/范围/验收→测试映射），产出 test-plan.md。
---

> 本文件是 glab-flow 自有子 skill（方法论，单 Leader）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# Test Design：测试计划设计

「测试中」节点（见 `../nodes.md`）的工作 agent 是 `test-design / test-flow-apifox`。本文件规定其中 test-design 部分：把规格（proposal.md / design.md 的验收标准）转成可执行的测试计划。产出是 `test-plan.md`，落到 spec 目录，不是代码。

## 测试计划产出

唯一产出物：

```
<workspace.root>/.glab-flow/<iid>/spec/test-plan.md
```

路径与 spec-author 的 proposal.md / design.md 同目录（见 `../nodes.md` 的工作产物落点约定：所有 issue 文档统一落 `.glab-flow/<iid>/spec/`，**禁止**写进代码仓的 `docs/`）。test-plan.md 是测试执行的输入——同目录的 `test-flow-apifox.md` 方法论消费它跑接口用例。

test-plan.md 须包含下列章节，缺一不可：

- **测试目标**：本计划验证什么（对齐 proposal.md 的背景与目标）。
- **测试范围**：范围内 / 范围外（明确列出不在本轮测试的模块与原因）。
- **用例清单**：按用例编号、标题、类型（unit/integration/e2e/API）、步骤、预期、关联验收标准。
- **验收标准 → 测试条目映射**：proposal.md 的每条 AC（AC1/AC2…）都映射到至少一个测试条目编号，确保无遗漏。
- **边界与异常用例**：空值、越界、非法输入、并发、大流量、权限越权等显式列出。
- **测试数据与前置条件**：依赖的账号、数据、环境状态。

## 设计要点

### 用例覆盖（三类 + API）

| 类型 | 范围 | 目标 |
|---|---|---|
| Unit | 单函数/方法，依赖 mock | 覆盖核心逻辑分支 |
| Integration | 端点、DB、跨模块 | 覆盖组装后的行为 |
| E2E | 关键用户流程 | 覆盖上线即用户可见的路径 |
| API | 接口契约（请求/响应/错误码） | 委托 apifox 运行时工具执行（见下） |

API 用例在设计阶段只列「用例描述 + 期望契约」，执行交给 apifox（见同目录 `test-flow-apifox.md`）。不在 test-plan.md 里手写 curl 脚本。

### 测试范围

范围按 proposal.md 的「影响模块」+ design.md 的「关键文件」推导。新增表 / 新端点 / 状态机变更 / 权限规则 必纳入范围；纯重构且行为不变的可标范围外并说明理由。回归范围覆盖受影响模块的既有功能，不只测新功能。

### 验收标准 → 测试条目映射

每条 AC 至少一个测试条目，映射关系以表格形式给出：

```
| AC | 测试条目 | 类型 | 备注 |
|----|---------|------|------|
| AC1 | T01-价格计算-正常折扣 | unit | — |
| AC1 | T02-价格计算-负数输入返回0 | unit | 边界 |
| AC2 | T03-下单接口-成功 | API | 委托 apifox |
```

无映射的 AC 视为遗漏，必须补测试条目或显式标注「本轮不测 + 理由」。

### 边界与异常用例

显式列出，不靠开发者临场判断：null/空集合、越界值（min/max）、非法类型、并发与重复提交、外部依赖失败（超时、错误码）、大数据量、特殊字符（Unicode/路径穿越）。异常路径与 happy path 同等对待，每条至少一个用例。

## API 测试

接口测试的设计（用例 + 期望契约）写进 test-plan.md，**执行**委托 apifox 运行时工具。具体执行方法论见同目录 `test-flow-apifox.md`，运行时工具清单见 `../tools.md`。test-design 不直接调用 apifox，只产出供它消费的用例描述。

## E2E 测试（前端 UI 流）

UI 渲染、弹窗文案、按钮显隐分支、交互时序这类验收标准，单测和代码评审抓不到——**必须标 `e2e` 策略**，由同目录 `test-flow-e2e.md` 经 e2e-runner / Playwright 真实点击执行。设计阶段在 test-plan.md 里列「场景 + 步骤 + 预期（可见性/文案/显隐）」，执行委托 test-flow-e2e，不在 test-plan.md 里手写浏览器脚本。覆盖范围参考 design.md 的「路由分流核查」——多套实现（web/mobile/租户灰度）都要有用例，不能只测一套。

## glab-flow 上下文

- **节点归属**：「测试中」节点（`../nodes.md`），Leader Read 本文件内联执行或 spawn `general-purpose` 以本文件为 prompt。产出 `test-plan.md` 落 `.glab-flow/<iid>/spec/`。
- **单 Leader**：不组建多 agent 团队，不引入团队编排、阶段闸门或状态机管道。需要探索时 spawn 至多一个 `general-purpose`。
- **测试问题挂评论**：测试执行中发现的问题挂父 GitLab Issue 评论（`glab issue note`，见 `../gate.md`）。**阻塞发布的问题须全部验证通过才放行待发布**（G11，见 `../guards.md`）——test-design 产出的用例是「全部验证」的依据，遗漏会导致门禁不放行。
- **门禁对齐**：test-plan.md 是「测试验收」门禁的输入（见 `../nodes.md` / `../gate.md`）；计划缺失或 AC 未全覆盖 → Leader 不推进状态。

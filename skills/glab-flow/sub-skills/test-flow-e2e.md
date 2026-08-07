---
name: glab-flow-test-flow-e2e
description: 测试中节点的 E2E 测试执行（前端 UI 流），消费 test-plan.md 的 e2e 用例，经 e2e-runner/playwright 执行，证据三段式挂父 Issue 评论。
---

> 本文件是 glab-flow 自有子 skill（方法论，单 Leader）。在测试中 由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# Test Flow (E2E)：前端端到端测试执行

「测试中」节点（见 `../nodes.md`）的工作 agent 是 `test-design / test-flow-apifox / test-flow-e2e`。本文件规定 E2E 部分：消费 test-design 产出的 **e2e 类用例**（见同目录 `test-design.md` 的 test-plan.md），经 e2e-runner / playwright 执行，收集结果并挂父 GitLab Issue 评论。

## 为什么 E2E 必须有

UI 渲染、弹窗文案、按钮显隐分支、交互时序这类验收标准，**单测和代码评审都抓不到**——只有真实点击的 E2E 才暴露（复盘已多次验证）。test-design 把这类 AC 强制标 `e2e` 策略，本子 skill 负责把它们跑掉。

## 执行

E2E 用例由 test-design 设计完毕（写在 test-plan.md，类型 = e2e），本阶段只做执行。运行时工具：

| 运行时工具 | 用途 |
|---|---|
| `e2e-runner` agent（Vercel Agent Browser，首选） | 驱动真实浏览器跑关键用户流程 |
| Playwright（降级 / CI） | e2e-runner 不可用时直接跑 Playwright 脚本 |

工具是**运行时依赖**（见 `../tools.md`），glab-flow 不自带浏览器能力，只提供执行方法论与结果契约。调用约定（与 `test-flow-apifox.md` 一致）：

- **目标环境从 config 取**：`test_environments`（见 `../config.md`）选定环境 URL + 账号，不依赖工作区 playwright.config 的硬编码 baseURL。
- **同步取结果**：执行后必须拿到结构化结果（通过/失败 + 失败明细 + 截图/trace），不异步丢任务。
- **对齐 test-plan.md**：执行范围对齐 test-design 的 e2e 用例编号，结果回填到用例编号，便于追溯。
- **未装 e2e-runner 时降级**：Leader 不报错中止，改用 Playwright（或项目自带 E2E runner）按 test-plan.md 手动执行，结果标注「未用 e2e-runner，Playwright 执行」。降级结果同样须满足下面的证据三段式。

## 结果收集（证据三段式）

与 `test-flow-apifox.md` / `tdd-guide.md` 一致，作为「测试验收」门禁输入（见 `../gate.md`）。口头「点了一遍没问题」不被接受。

1. **命令**：实际执行的 e2e-runner / Playwright 调用（含目标环境 URL、用例范围、浏览器）。
2. **计数**：`E2E 用例: X passed, Y failed, Z skipped`。
3. **失败列表**：逐条 `用例编号 — 场景 — 失败原因摘要（断言差异/元素未现/超时）`；附截图/trace 路径；全绿则写「无失败」。

## 挂评论

- 失败的 e2e 用例 / 发现的 UI 缺陷以评论挂父 Issue（`glab issue note`，G8 只新增；G13 不建独立 Bug Issue）。
- **阻塞规则（G11，见 `../guards.md`）**：阻塞发布的 UI 问题（CRITICAL/HIGH）必须全部修复 + E2E 复测绿才放行待发布；非阻塞（MEDIUM/LOW）记录带过。
- 正文含计数 + 失败列表 + 截图链接 + 阻塞级标注。

## glab-flow 上下文

- **节点归属**：「测试中」（`../nodes.md`）。nodeProgress 的「用例执行」步骤涵盖 API（test-flow-apifox）+ E2E（本文件）；Leader 用 `progress` 命令标 done。
- **单 Leader**：调度 e2e-runner/Playwright、收集结果、判定阻塞、挂评论，不组建多 agent 团队。
- **门禁对齐**：E2E 结果是「测试验收」门禁输入；UI 类 AC 的 E2E 未过 → Leader 不推进状态。

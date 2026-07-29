---
name: glab-flow-tdd-guide
description: 开发中节点的 TDD 方法论（RED→GREEN→REFACTOR，测试优先，80%+ 覆盖）。glab-flow 自有，单 Leader 内联执行。
---

> 本文件是 glab-flow 自有子 skill（方法论，单 Leader）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# TDD Guide：测试优先的开发纪律

「开发中」节点（见 `../nodes.md`）的工作 agent 是 `git-ops + tdd-guide + codegraph`。本文件规定其中 tdd-guide 的方法论：先写测试、再写实现、最后重构，并用可复现的测试证据收尾。产出是落代码仓的源码与测试，不是 spec 文档。

## TDD 三步（RED → GREEN → REFACTOR）

每一项改动都走完这三步，不跳序。测试描述行为，不测实现细节。

### 1. RED — 先写失败测试

写一条描述预期行为的测试，然后运行它，**确认它失败**（退出码 ≠ 0）。失败的根因必须是「被测逻辑尚未实现」，而不是编译错误或导入错误——先把桩（stub / 空实现 / 抛 `NotImplemented`）放到位让测试能命中目标，再断言它红。

### 2. GREEN — 写最小实现

只写让测试变绿的最小代码，不多做。不要预测性地加参数、加分支、加抽象——那些留给 REFACTOR。目标是**最快的绿**。

### 3. REFACTOR — 保持绿色重构

测试全绿的前提下，清理重复、提取函数、改命名、收敛抽象。每改一步就跑一次测试，**一旦变红立即回退**。REFACTOR 不改变行为，只改变结构。

### AAA 模式（每条测试的骨架）

测试内部统一按 Arrange / Act / Assert 三段组织，顺序固定：

- **Arrange**：构造最小输入与上下文（数据、mock、状态）。
- **Act**：调用被测目标一次，取结果。
- **Assert**：断言具体值/状态，不接受「不抛异常就算过」。

一个测试只验证一个行为点；相关断言可成组，但不同行为点拆成不同测试。

## 覆盖率

- **目标 80%+**（行/分支/函数）。覆盖率是下限不是上限，但**不追求 100% 形式覆盖**——覆盖无意义分支只是噪音。
- **三类测试齐全**：

  | 类型 | 范围 | 何时必有 |
  |---|---|---|
  | Unit | 函数/方法/类，依赖全部 mock | 恒有 |
  | Integration | 端点、DB、服务间交互，用真实或近真实依赖 | 涉及 IO / 跨模块时 |
  | E2E | 关键用户流程端到端 | 关键特性上线时 |

- **测试命名描述行为**：用 `returns X when Y` / `throws when Z missing` 这类行为短语，不用 `test1` / `testSuccess` 这类无意义名。命名读起来应像规格说明。
- **边界与异常必测**：null/空集合/越界值/非法类型/并发竞态/大数据量/特殊字符（Unicode、路径穿越字符）。不只测 happy path。

## 测试证据（完成报告的硬要求）

「开发中」节点收尾时，必须给出**可复现的三段式证据**，对齐 `../gate.md` 的取证契约。口头「测试通过」不被接受。

1. **命令**：实际执行的测试命令（含 scope、过滤参数），例如 `php artisan test --coverage` 或 `npx vitest run --coverage src/pricing`。
2. **计数**：测试汇总行，形如 `Tests: X passed, Y failed, Z skipped`（或框架等价输出）。覆盖率行：`Lines 86% / Branches 81%`。
3. **失败列表**：若有失败，逐条列 `用例名 — 失败原因摘要 — 关联文件`；全绿则写「无失败」。

证据贴在 Issue 评论（`glab issue note`，见 `../gate.md` 第 5 步）或 `.glab-flow/<iid>/spec/` 下的自测记录。代码评审节点会复核这份证据。

## 工具

- **代码导航**：用 codegraph（运行时 MCP，见 `../tools.md`）定位被测符号、查 callers/callees 判断改动影响面、找现有测试惯例。先 codegraph 再写测试，避免漏掉调用方。
- **测试框架**：按项目栈选择，不混用：

  | 栈 | 单元 / 集成 | E2E | 覆盖率 |
  |---|---|---|---|
  | TS/JS | Vitest / Jest | Playwright / Cypress | `--coverage` |
  | PHP/Laravel | PHPUnit | Laravel Dusk / Playwright | `--coverage` |
  | Java/Spring | JUnit 5 + Mockito | REST Assured / Playwright | JaCoCo |
  | Python | pytest | Playwright | `pytest --cov` |
  | Go | `go test` | Playwright | `go test -cover` |

  框架选择遵循仓库既有约定；新引入框架需在 design.md 说明理由。

## glab-flow 上下文

- **节点归属**：「开发中」节点（`../nodes.md`），Leader 在此节点 Read 本文件内联执行，或 spawn `general-purpose` 以本文件为 prompt。产出落代码仓（源码 + 测试），不产出 spec 文档。
- **单 Leader**：不组建多 agent 团队，不引入团队编排或状态机管道。需要探索/方案时 spawn 至多一个 `general-purpose`。
- **衔接**：代码与自测证据就绪后，进入代码评审（见同目录 `code-review.md`）；评审通过且无未解决 HIGH 才能流向「测试中」节点（对齐 `../gate.md` / `../guards.md`）。
- **门禁对齐**：测试证据是「代码评审与自测」门禁的输入；证据不足时 Leader 不推进状态（见 `../gate.md`「证据不足时」）。

---
name: glab-flow-code-review
description: 开发中节点代码评审方法论 + 严重度分级；可选调用栈专用 reviewer，不依赖外部 agent 包。
---

> 本文件是 glab-flow 自有子 skill（方法论，单 Leader）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# Code Review：代码评审方法论

「开发中」节点（见 `../nodes.md`）在代码与自测就绪后进入代码评审。本文件规定评审的维度、严重度分级、运行时 reviewer 工具的调用方式与通过门槛。评审结论是「代码评审与自测」门禁的输入（见 `../gate.md`）。

## 评审维度

评审按四个维度展开，每个维度都要有明确结论（通过 / 问题清单），不接受「整体看起来还行」这类笼统反馈。

1. **Correctness（正确性）**：逻辑是否实现规格（proposal.md / design.md 的验收标准）、边界与异常路径是否覆盖、并发与时序是否正确、空值与非法输入是否处理。
2. **Security（安全）**：用户输入是否校验与转义、鉴权与权限是否正确、密钥与敏感数据是否泄漏（日志/错误消息/响应体）、SQL 是否参数化、文件上传与外部调用是否受限。对应 OWASP Top 10。
3. **Performance（性能）**：是否有 N+1 查询、是否在热路径上做重复计算、数据结构选择是否合理、是否有不必要的同步阻塞、资源（连接/句柄/内存）是否释放。
4. **Stack best-practices（栈最佳实践）**：是否符合该语言/框架的惯用法——Laravel 的 Eloquent 与中间件用法、Spring 的分层与事务边界、TypeScript 的类型安全与异步正确性等。函数 <50 行、文件 <800 行、不可变模式、显式错误处理（见仓库 coding-style 约定）。
5. **Cross-stack activation（跨栈激活）**：后端新增/改动的请求字段、接口、事件，前端（或其它调用方）是否真在传/在用；前端新依赖的字段后端是否真返回。用 codegraph 查 callers/callees 核实——发现「后端加了字段但无前端调用方」「前端读的字段后端没返回」即「休眠字段」（如参考价休眠），标 HIGH：要么接通调用方，要么删字段，不要留半截。

## 严重度分级

每个问题按严重度标记，决定是否阻塞流转：

| 级别 | 含义 | 处置 |
|---|---|---|
| **CRITICAL** | 安全漏洞、数据丢失、崩溃、破坏性正确性问题 | **BLOCK** — 必须修复后才能进「测试中」 |
| **HIGH** | 明显缺陷、重要边界未处理、性能隐患 | **WARN** — 应在进「测试中」前修复；未解决须显式记录原因 |
| **MEDIUM** | 可读性、轻度坏味道、可选优化 | **INFO** — 建议修复，不阻塞 |
| **LOW** | 风格、命名、注释 | **NOTE** — 可选，记下即可 |

只有 CRITICAL 与 HIGH 影响门禁（见下「通过门槛」）。

## 运行时 reviewer 工具

评审必须由 Leader 同步 spawn 一个**只读 reviewer** 执行。若 `~/.claude/agents/` 中存在对应栈 reviewer，可优先使用；否则把本文件的对应检查项、待评审 diff、spec、test-plan 与 local TestRun 一起注入 `general-purpose`，同样产出严重度结论。完整流程不依赖外部 agent 包。

按栈选择（可多栈并行）：

| 栈 / 关注点 | reviewer agent |
|---|---|
| PHP / Laravel | php-reviewer |
| TypeScript / JavaScript | typescript-reviewer |
| Java / Spring Boot | java-reviewer |
| 安全（任意栈） | security-reviewer |
| 数据库 / SQL / 迁移 | database-reviewer |

调用约定：

- **同步调用**：用 `run_in_background: false` spawn reviewer，等它返回结果再合并结论。评审需要拿完整结果做门禁判定，不异步 fire-and-forget。
- **只读**：reviewer agent 不改代码，只产问题清单（含严重度、文件、行、问题、建议）。修复由 Leader 转 `general-purpose` 或开发者执行。
- **传入上下文**：把待评审的 diff、相关 spec（design.md 关键文件表）、当前 test-plan 与 local TestRun 证据一并喂给 reviewer，让它对齐规格而非凭空挑刺。
- **未装专用 reviewer 时**：Leader 仍须 spawn `general-purpose` 按上述四维度 + 严重度框架评审，并在结论里标注「使用内置通用评审 prompt」。

## 通过门槛

进「测试中」节点（见 `../nodes.md` / `../gate.md`）的硬条件：

- **无 CRITICAL**：任何 CRITICAL 必须修复并复审通过。
- **无未解决 HIGH**：HIGH 要么修复，要么有显式记录的「接受理由 + 确认人」并由用户拍板留下。未解决且无理由 → 不放行。
- MEDIUM / LOW 不阻塞，但须进入问题清单供后续跟踪。

门槛与护栏对齐：`../guards.md` 的门禁二值（G2）——通过走正向 plan，不通过回去修，不存在「带病通过」。

## glab-flow 上下文

- **单 Leader**：Leader 收集 reviewer 结论、合并严重度、判定门槛，不组建多 agent 团队，不引入团队编排或状态机管道。
- **评审意见落点**：合并后的评审意见（问题清单 + 严重度 + 门槛结论）挂父 GitLab Issue 评论（`glab issue note`，见 `../gate.md`），或落 `.glab-flow/<iid>/spec/` 下的评审记录文档。评论只新增不改历史（G8，见 `../guards.md`）。
- **不改原文**：评审意见不写回 Issue 正文（G7，见 `../guards.md`），Issue 正文一旦创建即冻结。
- **衔接**：门槛通过 → Leader 建 plan 推向「测试中」（Assignee=测试）；不通过 → 回到开发修问题，重新取证校验。

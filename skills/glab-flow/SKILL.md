---
name: glab-flow
description: 当用户提供 oa-ai-native-harness 的 GitLab Issue URL/编号，需要按 harness 状态机驱动需求从分诊到上线/验收时使用。本地人驱动，每次写回 GitLab 前预览确认，护栏由 engine 确定性校验。编排多 agent，Leader 只委托。
---

# glab-flow：harness GitLab 状态机驱动引擎

**输入**：`$ARGUMENTS` = GitLab Issue URL 或 iid（如 `https://git.kuainiujinke.com/oa/oa-ai-native-harness/-/issues/123` 或 `123`）。

**引擎**：`/Users/eliojin/IdeaProjects/glab-flow`，命令前缀 `cd /Users/eliojin/IdeaProjects/glab-flow && pnpm cli <cmd>`。GitLab 认证由 **glab CLI** 统一处理（无需 token 环境变量，glab 用自身配置）。可选：`GLAB_FLOW_PROJECT_ID`（默认 3915）、`GLAB_FLOW_HOST`（默认 git.kuainiujinke.com）。

## Leader 每轮编排（严格按序）

1. **读状态**：读 GitLab Issue 的 labels/description/comments；用 `pnpm cli node <type> <labels...>` 得当前节点。当前节点 = labels 里 `story-status::*`（需求）或 `status::*`（Bug）去掉前缀。0 个或 ≥2 个 → **脏状态**，停止，列给人工，不推进。
2. **查契约**：从 `nodes.md` 取「当前节点 → 允许的下一节点 / 必填项 / 门禁 / Assignee 角色」。
3. **判断能否流转**：
   - 证据齐全 → 委派**流转 agent** 起草结构化 Payload（字段从 Issue 评论/证据抽取，人/结论不得臆造）。
   - 不齐 → 委派**节点工作 agent** 生成本节点内容（见 `nodes.md`：草稿/方案/代码/测试），写回用评论/分支，不推进状态。
4. **护栏校验**：把 Payload 喂 `pnpm cli validate`（stdin: `{type,labels,payload}`）。`ok:false` → **停**，一次性列出 `missing`+`reasons` 问用户，不写。
5. **构建写计划**：`pnpm cli plan <iid>`（stdin: `{payload}`）→ 得 WritePlan JSON。
   - **退回时**（gateOutcome=退回）：用 `pnpm cli plan-return <iid>`（stdin: `{type,from,target,issues,confirmer,date,assigneeUser}`）生成退回 WritePlan（label from→target + 退回评论含问题清单），再走步骤 6 预览确认。
6. **预览确认**：把 WritePlan 渲染成 diff 给用户看（add/remove label、set assignee、add comment、close）。用户 `y` 才继续；`n`/编辑 → 回到 Payload 收集。
7. **应用**：`pnpm cli apply`（stdin: WritePlan）。引擎先 `validateWritePlan` 再调 GitLab API。
8. **下一节点**：循环到 `已完成` 或用户停。

Assignee 解析：`pnpm cli resolve-assignee <iid> <角色>` 从 Issue 正文「交付协同」表取具体 @用户；缺则反问人工补，不接受角色名。

## 硬规则（不可违反，详见 `guards.md`）

- **三类评审分离**：技术方案评审通过**只记录**，不得据此进「开发中」；代码评审不推进状态。
- **门禁二值**：需求评审结论为「退回」→ 写退回评论（含问题清单）回「草稿中」，绝不进下一节点。
- **hard_gate（待发布/验收/关闭）**：无人工证据 + humanConfirmed 不得写。
- **冻结**：永不编辑已存在评论/原文，只新增评论或退回建新版本。
- **日期**：自动带出本地日期为候选，用户「确认」后才落盘（Payload `datesConfirmed`）。
- **Assignee**：从 Issue「交付协同」表解析具体 @用户，缺则反问，不接受角色名。
- **不建 Jira**；测试问题挂父需求评论，不建 Bug Issue。

## 复用的现有 skill/agent

需求/方案 → `spec-author`；开发 → `git-ops`+`tdd-guide`+codegraph；代码评审 → `code-review`/`php-reviewer`/`java-reviewer`/`typescript-reviewer`；测试 → `test-design`/`test-flow-apifox`；发布 → `jenkins-deploy`。本 skill 自带 agent：`intake`、`review-preview`、`release-check`。

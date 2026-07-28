---
name: glab-flow
description: 当用户提供 oa-ai-native-harness 的 GitLab Issue URL/编号，需要按 harness 状态机驱动需求从分诊到上线/验收时使用。引擎只做确定性计算（节点/校验/计划/渲染），GitLab 读写由 Leader 直接用 glab CLI 完成，每次写回前预览确认。
---

# glab-flow：harness GitLab 状态机驱动引擎

**输入**：`$ARGUMENTS` = GitLab Issue URL 或 iid。

**引擎**（纯计算，无 I/O）：`/Users/eliojin/IdeaProjects/glab-flow`，`cd /Users/eliojin/IdeaProjects/glab-flow && pnpm cli <cmd>`。命令：`node`/`validate`/`plan`/`plan-return`/`render`/`evidence`。

**GitLab 读写**：Leader 直接用 glab CLI（glab 已认证，**无需 token**）。从本地克隆 `/Users/eliojin/IdeaProjects/oa-ai-native-harness` 跑 `glab issue ...` 自动识别 remote；或任意目录用 `glab api --hostname git.kuainiujinke.com "<path>"`。

## Leader 每轮编排

1. **读状态**：`glab issue view <iid> --output json`（从克隆目录）→ 取 labels/description；`pnpm cli node <type> <labels...>` 得当前节点。0 或 ≥2 个状态标签 → 脏状态，停，列给人工。
2. **查契约**：从 `nodes.md` 取当前节点的下一节点/必填项/门禁/Assignee 角色。
3. **判断能否流转**：证据齐 → 起草 Payload；不齐 → 委派节点工作 agent 生成内容（评论/分支），不推进状态。
4. **护栏校验**：`pnpm cli validate`（stdin `{type,labels,payload}`）。`ok:false` → 停，列 `missing`+`reasons` 问用户。
5. **构建写计划**：正向 `pnpm cli plan <iid>`（stdin `{payload}`）；退回 `pnpm cli plan-return <iid>`（stdin `{type,from,target,issues,confirmer,date,assigneeUser}`）。
6. **预览确认**：把计划翻译成 glab 命令，diff 给用户看。
7. **应用（Leader 直接跑 glab）**：
   - 标签+Assignee：`glab issue update <iid> --label <add1,add2> --unlabel <rm> --assignee <@user>`
   - 评论：`glab issue note <iid> -m "<由 render/plan 生成的正文>"`
   - 关闭（终态）：`glab issue close <iid>`
8. **下一节点**：循环到 已完成 或用户停。

**Assignee 解析**：从 Issue 正文「交付协同」表取角色对应 @用户（Leader 解析 description）；缺则反问，不接受角色名。

**证据抽取**：`glab api --hostname git.kuainiujinke.com "projects/3915/issues/<iid>/notes?per_page=100" | pnpm cli evidence` → 抽 `## 状态变更` 记录供护栏取证。

## 硬规则（详见 guards.md）
三类评审分离；门禁二值（退回走 plan-return）；hard_gate（待发布/验收/关闭）需人工证据；冻结不改原文/评论；日期需确认；Assignee 必须具体 @用户；不建 Jira；测试问题挂父需求。

## 复用
需求/方案 → spec-author；开发 → git-ops+tdd-guide+codegraph；代码评审 → code-review/*-reviewer；测试 → test-design/test-flow-apifox；发布 → jenkins-deploy。自带 agent：intake/review-preview/release-check。

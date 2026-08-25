---
name: glab-flow-git-ops
description: glab-flow 开发节点的 Git 操作子 skill。创建分支、提交、推送、更新、合并、清理；分支保护 + Stash 兜底 + 写操作必确认。vendor 自 ~/.claude/skills/git-ops 并按 GitLab-native 适配。
---

> 本文件是 glab-flow 自有子 skill（vendor 自 `~/.claude/skills/git-ops` 并按 GitLab-native 适配）。在对应节点由 Leader Read 本文件内联执行，或 spawn `general-purpose` 以其为 prompt。运行时工具依赖见 `../tools.md`。

# Git Ops：多仓库/单仓库 Git 操作

**输入**：`$ARGUMENTS`（可选：模块名、分支名等）

## 初始化

1. glab-flow 的配置与项目参数由 Leader 在 flow 启动时从 `<workspace.root>/.glab-flow/config.md` 解析得到（见 `../config.md`）。本子 skill 直接复用 Leader 已派生的参数，不重复解析配置文件：
   - `workspace.root` —— 业务工作区根（Git 操作的 `-C` 目标路径）
   - `branch_naming.format` —— 分支命名模板，默认 `{type}/{iid}`；`{type}` 由 `branch_naming.type_map` 按 Issue 类型映射（默认 `{ story: feat, bug: fix }`），`{iid}` 为 GitLab Issue iid
   - `deploy_branch` —— 自动部署目标分支（可选；不配则发布节点跳过合并）
2. 主分支默认 `main`（与 GitLab 项目默认分支对齐）；commit message 遵循仓库约定（Conventional Commits：`<type>: <description>`）。

## 架构检测

```
工作区下含多个独立仓库/模块（各自 .git 或独立 GitLab project）→ multi-repo：分支/推/并/清操作展示交互选择；commit 自动扫变更仓库
否则 → single-repo：[workspace.root]，所有操作直接执行
```

glab-flow 默认 single-repo（一个 GitLab project = 工作区根）。

## 触发词

| 触发 | 操作 |
|------|------|
| "创建分支"/"开始需求" | 创建分支 |
| "更新分支"/"rebase" | 更新分支 |
| "commit"/"提交" | 提交代码 |
| "push"/"推送" | 推送远程 |
| "完成需求"/"合并分支" | 合并到主分支 |
| "清理分支"/"删除分支" | 清理分支 |

## 仓库选择（仅 multi-repo）

分支/推/并/清操作前列仓库供选（后端 `[1]主仓库 [2]模块…` / 前端 / 其他），编号逗号分隔或 `all`。**commit 例外**：自动扫有变更仓库。

## 分支保护规则

### 保护分支（禁止直接 commit）

| 分支 | 角色 | 规则 |
|------|------|------|
| `master`/`main` | 源头分支 | 禁止直接 commit；所有开发分支必须从主分支创建 |
| `test` | 测试分支 | 禁止直接 commit；禁止将 test 合并到其他分支 |
| `pre` | 预发分支 | 禁止直接 commit；合并前须先同步主分支到开发分支 |

### 合并方向白名单

| 方向 | 说明 | 是否需要确认 |
|------|------|-------------|
| `dev → test` | 开发合并到测试 | 正常确认 |
| `dev → pre` | 开发合并到预发 | 正常确认（须先同步主分支） |
| `dev → master/main` | 开发合并到主分支 | 二次确认 |
| `master/main → dev` | 同步主分支到开发 | 正常确认 |
| `test → *` | **禁止** | **拦截并警告** |
| `pre → *` | **禁止** | **拦截并警告** |
| 其他方向 | 需二次确认 | 二次确认 |

### 检测逻辑

每次写操作前：
1. 当前分支是否保护分支 → 是则阻止并提示。
2. 合并方向是否在白名单 → 不在则警告并二次确认。
3. 涉及 `pre` 合并 → 自动先同步主分支。

## Stash 兜底

所有写操作前，检测到未提交变更：
```
git status --short → 有变更 → git stash --include-untracked → 执行操作 → git stash pop
```
stash pop 冲突 → 停止，提示用户手动处理。

## 各操作流程

### 创建分支
1. 解析分支名：`$ARGUMENTS` 提供→用之；否则按 `branch_naming.format`（默认 `{type}/{iid}`）生成（交互确认）。
2. multi-repo：列出仓库让用户选。
3. 每个选中仓库：`fetch origin` → stash（如有）→ `checkout {main_branch}` → `pull` → `checkout -b {branch}` → stash pop。
4. 同名分支已存在 → 提示是否切换。

### 更新分支
1. 检测活跃分支（multi-repo 各仓库 / single-repo 当前）。
2. 询问策略：merge（默认，安全）/ rebase（线性历史，已推送慎用）。
3. `git -C <path> fetch origin` → 按策略执行。
4. 冲突立即停止，列冲突文件让用户手动处理。

### 提交代码
1. 扫描变更：遍历仓库 `git -C <path> status --short` + `diff --stat`（指定模块只扫匹配仓库）。
2. 展示变更清单（**等用户确认**），每个文件附一句话描述（diff 分析得出）：
   ```
   📋 变更清单 — {仓库名}
   新增: + path/to/new.php — 新增XXX
   修改: ~ path/to/mod.php — 修改YYY
   删除: - path/to/old.php — 移除ZZZ
   Commit Message: feat(scope): description
   ```
3. 确认后 `git add <具体文件>` + `git commit`（**不用 `git add -A`**）。

### 推送远程
1. 检测各仓库当前分支 + 未推送提交数。
2. 展示推送清单（**等用户确认**）：
   ```
   📋 推送清单
   [1] sample-service   branch: feat/42   commits: 3 (↑待推送)
   ```
3. 无上游 → `git push -u origin {branch}`；有上游 → `git push`。

### 合并分支（按目标分流）
- **→ test（常规）**：选仓库与开发分支 → 清单确认 → 先 `checkout test && git fetch origin`，确认本地分支状态后再 `merge {branch}`。冲突立即停止并请求处理；不得为了绕过项目钩子或质量检查而使用 `--no-verify`。→ 询问是否推送 test。
- **→ pre（须先同步主分支）**：开发分支先 `merge origin/main`（冲突停止）→ 清单确认（标"已同步主分支"）→ `checkout pre → pull → merge {dev}` → 询问是否推 pre。
- **→ master/main（二次确认）**：清单 + 输入 "yes" 确认 → 执行。
- **禁止方向**：检测 `test→*` / `pre→*` → 拦截 + 警告（"test/pre 只读，改动请在开发分支重实现"）。

### MR 创建前置（feat 分支洁净性）

提 MR 前确认 feat 分支只含**本需求**改动，避免混入他人 commit 导致 MR 不干净：

```bash
git fetch origin
git rev-list --left-right --count origin/master...HEAD     # 期望 0 N（master 不领先 feat）
git log origin/master..HEAD --format='%an %s'               # 逐条核对 author + 文件范围是否都是自己的
git diff origin/master...HEAD --stat                         # 文件清单是否都在需求范围内
```

发现非己方 commit（他人误推、axios 修复等混入）→ cherry-pick 自己的 commit 到干净分支再提，**不要把别人的改动一起合进 MR**。

### CI 失败归因（test 分支构建失败 ≠ 自己的锅）

test 分支常含他人的失败测试/构建问题；自己 push 触发全量测试会暴露别人的问题，**切勿误判为己方改动而删自己的测试**：

```bash
git diff feat...test -- <失败文件>      # 失败是否在自己的改动范围
git log --oneline test -5               # test 最近提交是谁的
```

判定为他人问题 → 报告 + 跳过，不擅自改；判定为己方 → 修。**排障操作（删测试/改代码）限制在本地，不直接推远程**；确认无误后再推。

### 清理分支
1. 扫描本地分支（排除保护分支），标记已合并/未合并。
2. 用户选要删的；未合并的删除需额外确认，可选同时删远程。

## 全局规则（核心）

- 所有写操作**必须用户确认**，绝不擅自执行；每次前展示清单。
- 冲突**不自动解决**，立即停止。
- `master`/`main`/`test`/`pre` 禁止直接 commit；`test`/`pre` 禁止向外合并。
- 默认不 push；无变更仓库跳过；用 `git -C <path>` 执行。
- 每仓库独立操作，单个失败不影响其他。

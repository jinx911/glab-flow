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
2. 主分支（下文记 `{main_branch}`）默认 `main`（与 GitLab 项目默认分支对齐；个别仓库为 `master`）；commit message 遵循仓库约定（Conventional Commits：`<type>: <description>`）。

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
| "打开发布 MR"/"提 MR"/"创建 MR" | 只创建或确认 feature→master/main 发布 MR，不合并 |
| "完成需求"/"合并分支" | 合并到主分支 |
| "清理分支"/"删除分支" | 清理分支 |
| "创建 worktree" | 创建 worktree（仅开发分支，公共分支拒绝） |
| "worktree 状态" | 列出各仓库 worktree 分级状态 |
| "清理 worktree" | 清理 worktree（分级标记，必须用户核对） |

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
注意：stash 只作用于执行命令时所在的工作树；主仓与各 worktree 的未提交变更互不可见，各自独立兜底。

## Worktree 规则（占用检测 + 生命周期）

### 源头规则：公共分支永不建 worktree

- worktree 只允许挂开发分支（`feat/*`、`fix/*` 等）；`test` / `pre` / `master` / `main` / `deploy_branch` 永不创建。
- 查看公共分支代码一律只读，不 checkout：
  ```
  git -C <path> fetch origin
  git -C <path> log origin/test --oneline -20
  git -C <path> diff <dev>...origin/test
  ```
- 检测到公共分支已被 worktree 占用 → 标记「🔴 违规残留」，引导进「清理 worktree」流程。

### 占用检测（所有写操作前置）

每个仓库写操作前收集分支占用表：

```
git -C <path> worktree list --porcelain
```

porcelain 输出按 worktree 分块（`worktree <路径>` / `branch refs/heads/<分支>` / `detached`），解析成 `{分支 → worktree 路径}`，跳过主仓自身。条目还可能带 `locked`（锁定，prune 不清理）或 `prunable`（目录已不存在，可修剪）属性，解析时一并记录。

快速判断单个分支是否被占用：`git -C <path> branch --list <branch>`，输出前缀 `+` 即被其他 worktree 占用。

撞车处理（一律停车，报出「分支 X 在 worktree Y」，人工决策）：

| 操作 | 撞车场景 | 处理 |
|------|---------|------|
| 合并 | 目标公共分支被占用 | 违规残留：报位置，引导清理后再合并 |
| 创建/切换分支 | 目标分支被占用 | 停车：去该 worktree 里干，或先移走 worktree |
| 清理分支 | 要删的分支被占用 | 停车：先 `worktree remove` 再删分支 |

注意：merge 的**源分支**被占用不影响——merge 不需要 checkout 源分支，分支存在即可。

### 创建 worktree

1. 解析目标：仓库（multi-repo 先让用户选）+ 开发分支名。分支为公共分支（test/pre/master/main/deploy_branch）→ **拒绝**，给出只读替代命令（见源头规则）。
2. 分支不存在 → 先 `fetch origin`，从 `origin/{main_branch}` 建分支再挂；已存在 → 直接挂。
3. 路径统一：`<workspace.root>/.worktrees/<仓库名>-<分支名>`（分支名中 `/` 替换为 `-`）；single-repo 时 `workspace.root` 即仓库本身，改用仓库外路径 `<workspace.root>/../.worktrees/<仓库名>-<分支名>`，并把 `.worktrees/` 写入 `.git/info/exclude`，防止 `git add -A` 把它以 gitlink 提交。
4. 展示清单（仓库、分支、worktree 路径、是否写入 `.git/info/exclude`），用户确认后执行：
   ```
   git -C <repo> worktree add <worktree路径> <分支>
   ```
   `<worktree路径>` 必须用绝对路径（`git -C` 下相对路径按仓库目录解析）。
5. 同名 worktree 目录已存在 → 提示，不覆盖。

### worktree 状态

遍历仓库清单，每个仓库 `worktree list --porcelain`，逐条输出：

```
📋 Worktree 状态 — {仓库名}
  {路径}  分支: {branch}  未推送: {n}  最后活动: {date}  {标记}
```

- porcelain 条目带 `prunable`（目录已被手动删除）→ 标记「目录已不存在」，跳过进入该目录的命令，改从主仓取数：`git -C <repo> log -1 --format=%cs <分支>`，未推送同样记 `—`
- 未推送提交数：先 `git -C <worktree路径> rev-parse --abbrev-ref @{u} 2>/dev/null`，输出为空记 `—`；有上游再 `git -C <worktree路径> rev-list --count @{u}..HEAD`
- 最后活动：`git -C <worktree路径> log -1 --format=%cs`
- 合入判断：先 `git -C <repo> fetch origin`，再跑两条：`git -C <repo> branch --merged {main_branch} --list <分支>`、`git -C <repo> branch --merged origin/{deploy_branch} --list <分支>`；任一输出非空 → 已合入；均为空 → 未合入；未配置 `deploy_branch` 时第二条改用 `origin/test`
- 标记规则见「清理 worktree」分级表

### 清理 worktree（必须核对，绝不自动删）

**分级标记**：

| 标记 | 条件 | 含义 |
|------|------|------|
| ✅ | 分支已合入 {main_branch}/{deploy_branch} | 可删 |
| ⚠️ | 分支未合入 + 最后活动超 14 天 | 需确认 |
| 🚫 | 分支未合入 + 14 天内活跃 | 不建议 |
| 🔴 | 挂公共分支（违规残留） | 应删（还原主仓操作能力） |

**核对流程（硬性，任何删除不得先于核对）**：

1. 列出全部 worktree 分级清单（路径、分支、未推送、最后活动、标记）。
2. **等用户勾选**（逐项或批量）；未勾选前不执行任何删除。
3. 逐个执行 `git -C <repo> worktree remove <路径>`；worktree 内有未提交改动 → 默认不删，用户明确要求时 `--force` 须二次确认。目录已不存在的 prunable 条目，`worktree remove <路径>` 会自动修剪；也可经确认后 `git -C <repo> worktree prune` 批量清。
4. 删除后联动询问是否删对应分支：已合并 `branch -d`；未合并 `branch -D` 须二次确认；保护分支（`master`/`main`/`test`/`pre`/`deploy_branch`）不询问删分支，仅删 worktree；detached HEAD 无分支可删，仅删 worktree。
5. 按仓库汇报：已删 / 跳过 / 被拦（含原因）。

## 各操作流程

### 创建分支
1. 解析分支名：`$ARGUMENTS` 提供→用之；否则按 `branch_naming.format`（默认 `{type}/{iid}`）生成（交互确认）。
2. multi-repo：列出仓库让用户选。
3. 每个选中仓库：`fetch origin` → 占用检测（见 Worktree 规则，撞车停车）→ stash（如有）→ `checkout {main_branch}` → `pull` → `checkout -b {branch}` → stash pop。
4. 同名分支已存在 → 提示是否切换；若该分支被其他 worktree 占用 → 报出 worktree 路径停车，不 checkout。

### 更新分支
1. 检测活跃分支（multi-repo 各仓库 / single-repo 当前）。
2. 询问策略：merge（默认，安全）/ rebase（线性历史，已推送慎用）。
3. `git -C <path> fetch origin` → 按策略执行。
4. 冲突立即停止，列冲突文件让用户手动处理。
5. 目标分支被 worktree 占用 → 不在主仓切换，去对应 worktree 内执行更新。

### 提交代码
1. 扫描变更：遍历各仓库**主仓与该仓所有 worktree** 的 `git -C <path> status --short` + `diff --stat`（指定模块只扫匹配仓库）；改动在哪个工作树就在哪 commit，各工作树独立成 commit。
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
1. 检测各仓库主仓与各 worktree 的当前分支 + 未推送提交数（无上游记 `—`，检测方法同「worktree 状态」）。
2. 展示推送清单（**等用户确认**）：
   ```
   📋 推送清单
   [1] sample-service   branch: feat/42   commits: 3 (↑待推送)
   ```
3. 无上游 → `git push -u origin {branch}`；有上游 → `git push`。

### 打开/确认发布 MR（测试中→待发布专用，禁止合并）

此操作只服务 `open_release_mr_to_master` playbook：为发布准备 feature→master/main MR 并让 `mr-review` 有评审对象。它不是“完成需求”，也不是“合并分支”。

1. 前置核对 feat 分支洁净性（见下「MR 创建前置」）：确认 diff 只包含本 Issue 改动。
2. 确认 feature 分支已推送远程；未推送时走「推送远程」清单确认。
3. 检索是否已有同源同目标 MR：
   - 有 → 复用该 MR，必要时只补充标题/描述/关联 Issue。
   - 无 → 创建 feature→master/main MR，标题包含 Issue 地址或 iid，描述引用父 Issue + proposal/design。
4. 返回 MR 链接给 `mr-review`。
5. **禁止动作**：不得执行 `git merge`、不得点击/调用 MR merge、不得把 feature 合并进 master/main。master/main 合并只能发生在「发布」hard_gate 已确认后的发布动作中。

### 合并分支（按目标分流）
- **前置占用检测**：目标分支被 worktree 占用（公共分支被占属违规残留）→ 停车报位置，引导「清理 worktree」后再合并。源分支被占用不影响 merge。
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
1. 扫描本地分支（排除保护分支），标记已合并/未合并；被 worktree 占用的分支单独标记，须先走「清理 worktree」联动 remove 后再删。
2. 用户选要删的；未合并的删除需额外确认，可选同时删远程。

## 全局规则（核心）

- 所有写操作**必须用户确认**，绝不擅自执行；每次前展示清单。
- 冲突**不自动解决**，立即停止。
- `master`/`main`/`test`/`pre` 禁止直接 commit；`test`/`pre` 禁止向外合并。
- 默认不 push；无变更仓库跳过；用 `git -C <path>` 执行。
- 每仓库独立操作，单个失败不影响其他。
- **worktree 只挂开发分支**：`test`/`pre`/`master`/`main`/`deploy_branch` 等公共分支永不建 worktree；查看公共分支用只读命令（`fetch` + `log`/`diff origin/<分支>`），不 checkout。
- 所有写操作前用 `git worktree list --porcelain` 做分支占用检测；撞车一律停车报出「分支 X 在 worktree Y」，人工决策。
- **清理 worktree/分支必须先与用户核对**：分级清单 → 勾选确认 → 才执行删除，绝不自动删。

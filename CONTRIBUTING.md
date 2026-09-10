# 参与贡献 glab-flow

感谢参与。glab-flow 的目标不是替团队绕过交付流程，而是将已确认的流程变成可校验、可回读的确定性约束。

## 开始前

1. 从 `master` 创建 `codex/<topic>` 开发分支，不直接提交受保护分支。
2. 阅读 [README](README.md)、[项目介绍页](index.html) 和 `skills/glab-flow/SKILL.md`；状态机权威仍来自目标 Harness 的规则文档。
3. 本地配置、测试报告、脚本环境变量、账号、token 与 Issue 运行产物不得提交。`.glab-flow/` 已被忽略。

## 贡献边界

- 引擎只做解析、推导、校验、渲染和计划构建；不得在 `engine/` 中加入 GitLab 写入、网络请求或 shell 副作用。
- GitLab 读写仍由 Leader 使用已认证的 `glab` CLI 完成，并遵循预览、确认、写入、回读顺序。
- 修改状态机、护栏或输出回执时，必须同步更新对应的 skill 文档和测试。
- 测试计划是 local 与 test 的唯一版本化输入。修改需求、技术方案、接口、数据、权限或页面路由时，必须走 `change-impact` / `change-close` 闭环。

## 验证与提交

提交前执行：

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

PR 请说明：问题与范围、状态机/护栏影响、测试证据、文档同步情况，以及是否新增或更新了回执格式。不要把真实 Issue、内部 URL、凭据或客户数据写入可复用文档。

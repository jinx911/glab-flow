# 完整安装就绪实施计划

> **面向执行 Agent：** 在本会话直接实施；先完成实现，再用干净环境模拟安装验证。

**目标：** 让 glab-flow 拒绝不完整环境，为每项必需本地能力提供唯一、完整、可审计的安装路径。

**架构：** 安装器保持为轻量、幂等的 Bash 入口；新增专职的 `scripts/doctor.sh`，输出机器可读的检查结果，并在依赖安装后由安装器复用。仓库只校验凭据和项目访问能力，绝不收集或存储凭据。

**技术栈：** Bash、Homebrew/apt/winget 适配层、Node/pnpm、GitLab CLI、Apifox CLI、CodeGraph、Playwright、TypeScript/Vitest。

---

### 任务 1：定义完整安装契约

**涉及文件：**
- 新增：`scripts/doctor.sh`
- 修改：`install.sh`
- 修改：`README.md`

- [x] 修改用户环境前，识别受支持的操作系统与包管理器组合。
- [x] 将 Git、Node、pnpm、glab、Apifox CLI、CodeGraph、ripgrep、Playwright 浏览器、项目依赖、技能链接、GitLab 登录、Apifox 登录与 CodeGraph 初始化全部视为必检项。
- [x] 任一工具、凭据或目标工作区初始化缺失时，以非零退出码停止。
- [x] 除非传入 `--yes`，全局安装软件包前必须明确确认。

### 任务 2：安装并配置全部本地能力

**涉及文件：**
- 修改：`install.sh`
- 修改：`uninstall.sh`

- [x] 用探测到的包管理器安装缺失的基础工具。
- [x] 从官方软件源安装或更新 pnpm、Apifox CLI、CodeGraph 与 Playwright。
- [x] 为可用的 Agent 客户端注册 CodeGraph，并且只在给定目标工作区后创建初始索引。
- [x] 创建非破坏性的技能链接，拒绝覆盖用户已有文件。

### 任务 3：使分发与运行时检查可移植

**涉及文件：**
- 修改：`engine/src/version.test.ts`
- 必要时修改：`engine/src/version.ts`
- 修改：`package.json`

- [x] 允许源码 ZIP 作为非 Git 分发方式通过校验，同时保留“无法自动比较新旧版本”的运行时提示。
- [x] 声明已验证的 Node 与 pnpm 兼容性，锁定包管理器版本，并配置 pnpm 构建脚本批准项，保证干净安装可复现。

### 任务 4：发布首次使用指南并验证

**涉及文件：**
- 修改：`README.md`
- 修改：`skills/glab-flow/tools.md`
- 修改：`skills/init-glab-flow/SKILL.md`

- [x] 记录唯一的“克隆 → 安装 → 安全登录 → 诊断 → 初始化”顺序和支持的操作系统矩阵。
- [x] 以安全的交互式登录指引替换命令中传 Token 的示例。
- [x] 明确接口测试和 CodeGraph 是必须安装并检查的能力，而 Jenkins/数据库访问属于项目配置，在初始化阶段校验。
- [x] 验证 Shell 语法、干净 Git 克隆安装、ZIP 安装、引擎检查与既有 TypeScript 测试/构建套件。

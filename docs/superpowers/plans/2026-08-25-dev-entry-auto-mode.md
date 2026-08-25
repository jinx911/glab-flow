# 开发入口自动模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **用户约束优先：** 不采用测试先行。每个任务均按“直接实现 → 补充针对性测试 → 完整验证”执行；不得先写失败测试。

**Goal:** 在“已评审 → 开发中”前让每个 Issue 选择并锁定半自动或自动模式；自动模式连续完成开发、双环境测试、提交推送与测试环境构建，并在不可安全自动处理的情况暂停。

**Architecture:** 纯引擎新增“模式选择状态”和“自动处置决策”两个确定性原语；Leader 仍是唯一 I/O 执行者。`transition` 接收 state 中已选择的模式并决定是否可免确认，技能文档负责把自动循环、重试和暂停边界落实为可审计的执行协议。

**Tech Stack:** TypeScript、Vitest、YAML 状态机、Markdown skill 文档、GitLab CLI、Apifox CLI、Jenkins。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `engine/src/state.ts` | 保存一次性的 Issue 模式选择，并提供不可覆写的选择函数。 |
| `engine/src/automation.ts` | 将执行事件确定性归类为继续、一次重试、自动修复或暂停。 |
| `engine/src/types.ts` | 定义选择、自动事件和决策的公开类型；扩展 transition 输入输出。 |
| `engine/src/transition.ts` | 在开发入口强制先选择模式；按已锁定模式计算 `shouldConfirm`。 |
| `engine/src/cli.ts` / `engine/src/cli-commands.ts` | 暴露 state 选择与自动决策命令，保持引擎无 I/O。 |
| `skills/glab-flow/{SKILL,gate,resume,nodes}.md` | 规定 Leader 选择时机、自动循环、暂停回执和恢复行为。 |
| `skills/init-glab-flow/SKILL.md`、`skills/glab-flow/config*.md` | 将 `run_mode` 明确为旧 state 的默认值，取消初始化阶段的全局模式询问。 |

### Task 1: 持久化并锁定 Issue 级模式选择

**Files:**
- Modify: `engine/src/state.ts`
- Modify: `engine/src/types.ts`
- Modify: `engine/src/cli-commands.ts`
- Modify: `engine/src/cli.ts`
- Modify: `engine/src/state.test.ts`

- [ ] **Step 1: 增加选择类型和 state 字段**

  在 `engine/src/types.ts` 定义：

  ```ts
  export interface RunModeSelection {
    mode: RunMode;
    selectedAt: string;
    selectedBy: string;
  }
  ```

  在 `RunState` 增加可选 `runModeSelection?: RunModeSelection`。保留已有 `runMode`，它仅表示 state 初始化时从 config 得到的兼容默认值。

- [ ] **Step 2: 实现 state 选择和有效模式解析**

  在 `engine/src/state.ts` 新增：

  ```ts
  export function effectiveRunMode(state: RunState): RunMode {
    return state.runModeSelection?.mode ?? state.runMode;
  }

  export function selectRunMode(
    state: RunState,
    selection: RunModeSelection,
  ): RunState
  ```

  `selectRunMode` 对相同选择幂等；若已有选择但 mode、selectedAt 或 selectedBy 不同，抛出 `runModeSelection is immutable`。`normalizeRunState` 必须接受没有该字段的旧 state，且不改变旧 state 的 `runMode`。

- [ ] **Step 3: 提供纯 CLI 命令**

  在 `engine/src/cli-commands.ts` 新增 `runModeSelectCommand({ state, mode, selectedBy, now })`，内部调用 `selectRunMode`；在 `engine/src/cli.ts` 增加 `run-mode-select` 分支，stdin 为该对象，stdout 为更新后的完整 state。无效 mode、空 `selectedBy` 或空 `now` 必须以 JSON 错误和非零退出码结束。

- [ ] **Step 4: 补充实现后的针对性测试**

  在 `engine/src/state.test.ts` 覆盖：

  ```ts
  expect(effectiveRunMode(legacySemiAutoState)).toBe('semi-auto');
  expect(selectRunMode(state, selection).runModeSelection).toEqual(selection);
  expect(selectRunMode(selected, selection)).toBe(selected);
  expect(() => selectRunMode(selected, differentSelection)).toThrow('immutable');
  ```

  在 CLI 测试中新建一组 `run-mode-select` 输入：合法选择返回完整 state；空操作者、非法模式和二次改选返回非零退出码。

- [ ] **Step 5: 验证并提交**

  ```bash
  pnpm vitest run engine/src/state.test.ts engine/src/cli-commands.test.ts
  pnpm typecheck
  git add engine/src/state.ts engine/src/types.ts engine/src/cli.ts engine/src/cli-commands.ts engine/src/state.test.ts engine/src/cli-commands.test.ts
  git commit -m "feat: persist issue run-mode selection"
  ```

  期望：目标测试、类型检查通过；提交不包含任何 `.glab-flow/` 运行 state。

### Task 2: 建立自动恢复与暂停的纯决策契约

**Files:**
- Create: `engine/src/automation.ts`
- Create: `engine/src/automation.test.ts`
- Modify: `engine/src/types.ts`
- Modify: `engine/src/cli.ts`

- [ ] **Step 1: 定义事件和决策类型**

  在 `engine/src/types.ts` 定义：

  ```ts
  export type AutomationEvent =
    | { kind: 'completed' }
    | { kind: 'transient_failure'; detail: string }
    | { kind: 'test_failed'; detail: string }
    | { kind: 'git_conflict'; detail: string }
    | { kind: 'missing_evidence'; detail: string; autoRecoverable: boolean }
    | { kind: 'material_change'; detail: string }
    | { kind: 'permission_denied'; detail: string }
    | { kind: 'hard_gate'; detail: string };

  export type AutomationDecision =
    | { action: 'continue'; reason: string }
    | { action: 'retry'; remainingRetries: number; reason: string }
    | { action: 'repair'; reason: string }
    | { action: 'pause'; code: string; reason: string; requiredInput: string };
  ```

  暂停代码固定为：`transient_failure_exhausted`、`test_failed`、`git_conflict`、`missing_human_evidence`、`material_change`、`permission_denied`、`hard_gate`；不得由调用方任意传入。

- [ ] **Step 2: 实现唯一决策函数**

  在 `engine/src/automation.ts` 实现：

  ```ts
  export function decideAutomation(
    event: AutomationEvent,
    attempt: number,
  ): AutomationDecision
  ```

  规则固定为：`completed` → continue；可自动补齐且不涉及人工结论的 `missing_evidence` → repair；首次 `transient_failure` → retry（remainingRetries 为 0）；第二次 transient failure、test_failed、git_conflict、需人工结论的 missing_evidence、material_change、permission_denied、hard_gate → pause。暂停结果须含稳定 code 和明确 `requiredInput`。

- [ ] **Step 3: 提供 CLI 入口**

  在 `engine/src/cli.ts` 增加 `automation-decision`：stdin `{ event, attempt }`，stdout 为 `AutomationDecision`。任何未知 event 或负数 attempt 返回非零退出码，不产生副作用。

- [ ] **Step 4: 补充实现后的针对性测试**

  在 `engine/src/automation.test.ts` 精确断言：

  ```ts
  expect(decideAutomation({ kind: 'transient_failure' }, 0)).toMatchObject({ action: 'retry', remainingRetries: 0 });
  expect(decideAutomation({ kind: 'transient_failure' }, 1)).toMatchObject({ action: 'pause' });
  expect(decideAutomation({ kind: 'test_failed' }, 0)).toMatchObject({ action: 'pause', code: 'test_failed' });
  expect(decideAutomation({ kind: 'missing_evidence', autoRecoverable: true }, 0)).toMatchObject({ action: 'repair' });
  expect(decideAutomation({ kind: 'material_change' }, 0)).toMatchObject({ action: 'pause' });
  ```

- [ ] **Step 5: 验证并提交**

  ```bash
  pnpm vitest run engine/src/automation.test.ts
  pnpm typecheck
  git add engine/src/automation.ts engine/src/automation.test.ts engine/src/types.ts engine/src/cli.ts
  git commit -m "feat: add deterministic automation decisions"
  ```

### Task 3: 将开发入口选择接入 transition

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/transition.ts`
- Modify: `engine/src/transition.test.ts`
- Modify: `engine/src/cli.test.ts`

- [ ] **Step 1: 扩展 transition 输入与输出**

  为 `TransitionInput` 增加 `runModeSelection?: RunModeSelection`；为 `TransitionOutput` 增加 `modeSelectionRequired: boolean`。调用方传 state 的已锁定选择，不能只传裸 `runMode` 冒充已经在开发入口确认。

- [ ] **Step 2: 在唯一入口实施阻断**

  在 `runTransition` 找到目标 transition 后增加判断：仅当 `current === '已评审' && tr.to === '开发中' && !input.runModeSelection` 时，返回 `modeSelectionRequired: true`、`shouldConfirm: true`、`plan: undefined`，并在 `missing` 写入：

  ```ts
  {
    field: 'runModeSelection',
    hint: '在进入开发中前选择 semi-auto 或 full-auto，并用 run-mode-select 写入 Issue state',
  }
  ```

  已有选择时用 `input.runModeSelection.mode` 作为 effective mode；其他旧调用仍用 `input.runMode ?? 'semi-auto'`，确保老 Issue 不会意外自动化。

- [ ] **Step 3: 保留原有安全判定**

  `shouldConfirm` 仅在 effective mode 是 `full-auto`、`validate.ok` 为真、非 `hardGate`、且 `modeSelectionRequired` 为 false 时为 false。任何脏状态、门禁缺口、hard gate 都保持 true；`applied` 永远 false。

- [ ] **Step 4: 补充实现后的针对性测试**

  在 `engine/src/transition.test.ts` 加入：

  ```ts
  expect(runTransition(model, reviewedToDevWithoutSelection).modeSelectionRequired).toBe(true);
  expect(runTransition(model, reviewedToDevWithoutSelection).plan).toBeUndefined();
  expect(runTransition(model, reviewedToDevWithFullAuto).shouldConfirm).toBe(false);
  expect(runTransition(model, hardGateWithFullAuto).shouldConfirm).toBe(true);
  ```

  在 `engine/src/cli.test.ts` 通过真实 `transition` CLI 验证 `runModeSelection` 的 JSON 传入、遗漏时无 WritePlan、选择后返回可解析预览。

- [ ] **Step 5: 验证并提交**

  ```bash
  pnpm vitest run engine/src/transition.test.ts engine/src/cli.test.ts
  pnpm typecheck
  git add engine/src/types.ts engine/src/transition.ts engine/src/transition.test.ts engine/src/cli.test.ts
  git commit -m "feat: require mode choice at development entry"
  ```

### Task 4: 将 Leader 自动循环与暂停回执写入流程协议

**Files:**
- Modify: `skills/glab-flow/SKILL.md`
- Modify: `skills/glab-flow/gate.md`
- Modify: `skills/glab-flow/resume.md`
- Modify: `skills/glab-flow/nodes.md`
- Modify: `skills/init-glab-flow/SKILL.md`
- Modify: `skills/glab-flow/config.md`
- Modify: `skills/glab-flow/config.example.md`
- Modify: `README.md`
- Test: `engine/src/process-contract.test.ts`

- [ ] **Step 1: 规定开发入口交互**

  在 `gate.md` 与 `SKILL.md` 声明唯一提示时机：已评审进入开发中前读取 state；无 `runModeSelection` 时只问一次。Leader 从 state 文件读取 JSON 后执行：

  ```bash
  node -e 'const fs=require("node:fs"); const state=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(JSON.stringify({state,mode:"full-auto",selectedBy:"@requester",now:new Date().toISOString()}))' "$STATE_FILE" \
    | pnpm cli run-mode-select
  ```

  Leader 落盘返回 state 后重新读取 Issue 并调用 `transition`，把 `runModeSelection` 一并传入。已选择时禁止重复询问或静默改选。

- [ ] **Step 2: 规定自动动作包与审计顺序**

  在 `nodes.md` 写明自动模式可连续执行：方案/测试计划 → 编码 → local API+E2E → commit/push → MR → 测试分支合并 → 可唯一推导参数的 Jenkins 测试环境构建 → test API+E2E → Issue 写回回读。每个步骤先 `progress`，完成后记录原始证据；写回仍遵守 metadata → state-comment → readback → milestone sync 的固定顺序。

- [ ] **Step 3: 规定自动决策和暂停评论模板**

  在 `gate.md` 写入每个失败调用 `automation-decision`；首次临时失败重试一次，可安全补齐的证据自动修复并重验，其余暂停。统一暂停回执模板必须包含：停止步骤、decision code、已验证事实、错误原文、尝试次数、`requiredInput`、恢复命令。明确 test failed、语义冲突、人工证据、实质变更、权限不足和 hard gate 不可自动放行。

- [ ] **Step 4: 规定变更闭环与恢复**

  在 `SKILL.md` / `resume.md` 规定 material_change 先 `change-impact` 并暂停；确认后更新所有受影响产物、递增测试计划版本、重跑失效环境证据，`change-close` 后再恢复。恢复时读取 state 的有效选择，绝不根据全局 config 覆盖。

- [ ] **Step 5: 更新初始化和公开说明**

  删除 `/init-glab-flow` 的 run mode 选择步骤，改为说明 `run_mode` 仅是无 state 的向后兼容默认值；`config.md`、模板和 README 同步该语义。Jenkins 参数不可唯一推导时，即使 full-auto 也必须暂停，而生产部署/验收/关闭始终人工。

- [ ] **Step 6: 补充文档契约测试并验证**

  在 `engine/src/process-contract.test.ts` 断言流程文档同时出现 `run-mode-select`、`automation-decision`、`runModeSelection`、`material_change` 与 hard gate 人工确认；运行：

  ```bash
  pnpm vitest run engine/src/process-contract.test.ts
  git diff --check
  git add skills/glab-flow skills/init-glab-flow README.md engine/src/process-contract.test.ts
  git commit -m "docs: define development-entry automation protocol"
  ```

### Task 5: 全链路模拟与发布验证

**Files:**
- Modify: `engine/src/e2e.test.ts`
- Modify: `engine/src/cli-commands.test.ts`
- Modify: `README.md`（仅在验证发现命令示例与实现不一致时）

- [ ] **Step 1: 实现双路径模拟**

  在 `e2e.test.ts` 用已有 fixture 构造两个从已评审进入开发中的 Story：半自动选择和自动选择。断言半自动每次 `shouldConfirm=true`；自动选择在非 hard gate 的开发入口、提测和测试完成节点得到 `shouldConfirm=false`，而待发布仍为 true。

- [ ] **Step 2: 实现异常模拟**

  用 `automation-decision` 覆盖首次临时错误、第二次临时错误、测试失败、自动可补证据、实质变更及权限失败；每条 pause 决策都必须有 `code`、`reason` 和 `requiredInput`。

- [ ] **Step 3: 运行完整验证**

  ```bash
  bash -n install.sh uninstall.sh scripts/doctor.sh
  pnpm typecheck
  pnpm test --run
  pnpm build
  git diff --check
  ```

  期望：所有测试通过、构建成功、无 whitespace 错误；未追踪 `.apifox/`、业务工作区 state 或本地草稿不得加入提交。

- [ ] **Step 4: 创建发布 PR**

  ```bash
  git add engine/src/e2e.test.ts engine/src/cli-commands.test.ts README.md
  git commit -m "test: cover development-entry automation flow"
  git push -u origin codex/dev-entry-auto-mode
  ```

  创建 `codex/dev-entry-auto-mode → master` 的 PR，正文列出自动授权范围、暂停边界、完整验证结果及“生产 hard gate 未自动化”。合并前必须重新确认 CI 与用户授权。

## 自检

- 规格中的 Issue 级一次选择、自动执行范围、三层异常处置、变更闭环、生产红线和七项验收均至少对应一个任务。
- 所有公开类型、命令、文件路径和测试断言在前置任务中定义；没有占位项。
- 计划遵循用户“不采用测试先行”的明确要求：实现后补测试并进行完整验证。

# 交付工作包核心模型重设计 实施计划

> **For agentic workers:** 逐任务执行本计划（每任务派独立实现 agent + 规格审查 + 质量审查，或本会话内按序执行）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 glab-flow 从「状态机中心」重构为「交付工作包（DU）中心」：动作分层（L1/L2/L3）、维度推导门禁集（GateSet）、资源一等模型、最短路径视图、变化分级与对账。

**Architecture:** 引擎保持纯计算（零 I/O、GitLab 写回仍由 Leader 跑 glab）。新增 `DuState`（本地主档：事实/门禁集/资源/指标）；`transition` 输入接入 DU 后按 GateSet 跳状态、按动作分层决定确认；Issue 评论只保留状态流转。护栏 G1–G16 不删，改为按 GateSet 生效。

**Tech Stack:** TypeScript (Node 20+, ESM)、yaml、vitest、tsx CLI。spec 见 `docs/specs/2026-09-01-delivery-unit-redesign.md`。

**验证方式（用户明确不要测试先行）:** 每任务先写实现，再写验证测试（实现后验证），跑定向测试 + `pnpm test` 全量 + `pnpm typecheck`，绿了才 commit。禁止测试先行仪式。

**术语:** DU = DeliveryUnit 交付工作包；DU 本地文件 = `<workspace.root>/.glab-flow/<iid>/du.json`（Leader 落盘，引擎只算，与 state 文件同目录同模式）。

---

## 文件结构总览

| 阶段 | 新建 | 修改 |
|---|---|---|
| P1 动作分层 | `engine/src/action-policy.ts` (+test) | `types.ts`、`transition.ts` |
| P2 DU 事实 + next + 评论瘦身 | `engine/src/du.ts`、`engine/src/next-step.ts` (+tests) | `types.ts`、`guard.ts`、`cli.ts`、`test-run.ts`、`asset-audit.ts` |
| P3 GateSet | `engine/src/gate-set.ts` (+test) | `state-machine.yaml`、`model.ts`、`types.ts`、`guard.ts`、`transition.ts`、`contract.ts` |
| P4 资源登记 | `engine/src/resource.ts` (+test) | `du.ts`、`types.ts`、`transition.ts`、`cli.ts` |
| P5 变化分级 + 对账 | `engine/src/change.ts`、`engine/src/reconcile.ts` (+tests) | `types.ts`、`change-impact.ts`、`cli.ts` |
| P6 指标 | `engine/src/metrics.ts` (+test) | `du.ts`、`types.ts`、`cli.ts` |
| 收尾 | — | `skills/glab-flow/*.md` 文档对齐 |

---

# 阶段 1：动作分层（ActionPolicy）

目标：`shouldConfirm` 不再由 run_mode 决定，改由动作层级决定。无门禁流转（如 bug 已确认缺陷→开发中）自动执行；有门禁流转 L2 批量确认（Jenkins 参数并入同一批，由 skill 文档约定 Leader 行为）；hard_gate 恒 L3。标准需求确认 15+ → 7。

分层规则（与已确认流程图一致）：
- **L3**：`transition.hardGate === true`
- **L2**：`transition.gate !== null`（该流转承载业务判断：评审结论/放行/验收）
- **L1**：其余（gate === null 的流转；如 草稿中→待评审、bug 已确认缺陷→开发中）

### Task 1.1: action-policy 模块

**Files:**
- Create: `engine/src/action-policy.ts`
- Test: `engine/src/action-policy.test.ts`

- [ ] **Step 1: 实现 `classifyAction`**

```typescript
// engine/src/action-policy.ts
import type { Transition } from './types.js';

/** 动作分层（spec §3.3）：L1 可逆/非生产自动执行；L2 业务判断批量确认；L3 不可逆恒人工。 */
export type ActionTier = 'L1' | 'L2' | 'L3';

export interface ActionDecision {
  tier: ActionTier;
  /** L2/L3 时给 Leader 的一次性批量确认文案标题。 */
  batchTitle: string;
}

export function classifyAction(tr: Pick<Transition, 'gate' | 'hardGate'>): ActionDecision {
  if (tr.hardGate) {
    return { tier: 'L3', batchTitle: `硬门放行：${tr.gate ?? '不可逆动作'}（生产/终态，必须人工确认）` };
  }
  if (tr.gate) {
    return { tier: 'L2', batchTitle: `业务判断：${tr.gate}（评审结论/放行，一次批量确认）` };
  }
  return { tier: 'L1', batchTitle: '' };
}

/** 确认判定：L1 且校验通过 → 自动执行；其余需人工。run_mode 不再参与（spec §3.3）。 */
export function shouldConfirmFor(tr: Pick<Transition, 'gate' | 'hardGate'>, validateOk: boolean): boolean {
  if (!validateOk) return true;
  return classifyAction(tr).tier !== 'L1';
}
```

- [ ] **Step 2: 写验证测试（实现后验证）**

```typescript
// engine/src/action-policy.test.ts
import { describe, expect, it } from 'vitest';
import { classifyAction, shouldConfirmFor } from './action-policy.js';

describe('classifyAction', () => {
  it('classifies hardGate as L3 regardless of gate', () => {
    expect(classifyAction({ gate: '发布', hardGate: true }).tier).toBe('L3');
    expect(classifyAction({ gate: '产品验收', hardGate: true }).tier).toBe('L3');
  });
  it('classifies gated transition as L2', () => {
    expect(classifyAction({ gate: '需求评审', hardGate: false }).tier).toBe('L2');
  });
  it('classifies gateless transition as L1', () => {
    expect(classifyAction({ gate: null, hardGate: false }).tier).toBe('L1');
  });
});

describe('shouldConfirmFor', () => {
  it('auto-executes L1 when validation passes', () => {
    expect(shouldConfirmFor({ gate: null, hardGate: false }, true)).toBe(false);
  });
  it('confirms L1 when validation fails', () => {
    expect(shouldConfirmFor({ gate: null, hardGate: false }, false)).toBe(true);
  });
  it('always confirms L2 and L3 even in full-auto style passing validation', () => {
    expect(shouldConfirmFor({ gate: '需求评审', hardGate: false }, true)).toBe(true);
    expect(shouldConfirmFor({ gate: '发布', hardGate: true }, true)).toBe(true);
  });
});
```

- [ ] **Step 3: 跑定向测试**

Run: `cd /Users/eliojin/IdeaProjects/glab-flow && pnpm vitest run engine/src/action-policy.test.ts`
Expected: 6 passed

- [ ] **Step 4: Commit**

```bash
git add engine/src/action-policy.ts engine/src/action-policy.test.ts
git commit -m "feat(action-policy): 动作分层 L1/L2/L3 纯函数"
```

### Task 1.2: transition 接入动作分层

**Files:**
- Modify: `engine/src/types.ts`（TransitionOutput 增加 `actionTier`）
- Modify: `engine/src/transition.ts:276-285`
- Modify: `engine/src/transition.test.ts`（补 2 个用例）

- [ ] **Step 1: types.ts 给 TransitionOutput 加字段**

在 `TransitionOutput` 的 `shouldConfirm: boolean;` 行后加：

```typescript
  /** 动作分层（spec §3.3）：L1 自动 / L2 批量确认 / L3 硬门。 */
  actionTier: 'L1' | 'L2' | 'L3';
  /** L2/L3 的批量确认标题；L1 为空串。 */
  confirmBatchTitle: string;
```

- [ ] **Step 2: transition.ts 替换 shouldConfirm 计算**

在 `transition.ts` 顶部 import 区加：

```typescript
import { classifyAction, shouldConfirmFor } from './action-policy.js';
```

把 `transition.ts` 中（runTransition 内，约 276-285 行）：

```typescript
  const runMode = input.runMode ?? 'semi-auto';
  const plan = validate.ok
```

改为：

```typescript
  const runMode = input.runMode ?? 'semi-auto';
  const action = classifyAction(tr);
  const shouldConfirm = shouldConfirmFor(tr, validate.ok);
  const plan = validate.ok
```

并把同函数内原有行 `const shouldConfirm = runMode === 'semi-auto' || !!tr.hardGate || !validate.ok;` 删除。`previewText(...)` 调用保持不变（`shouldConfirm` 仍作为参数传入）。两个提前 return（dirty / 无转换）的返回对象各补字段：

```typescript
      actionTier: 'L2', confirmBatchTitle: '', applied: false,
```

主返回对象（约 287-303 行）在 `shouldConfirm,` 后加：

```typescript
    actionTier: action.tier,
    confirmBatchTitle: action.batchTitle,
```

- [ ] **Step 3: 修 previewText 的 run 模式行**

`transition.ts` previewText 内：

```typescript
  lines.push(`run 模式：${runMode} → ${shouldConfirm ? '需 AskUserQuestion 确认后再写回' : '护栏 ok 即可自动写回'}`);
```

改为：

```typescript
  lines.push(`动作分层：${tier} → ${shouldConfirm ? '批量确认后写回（Jenkins 参数并入本次确认）' : '自动写回（可逆/非门禁流转）'}；run 模式 ${runMode} 仅作审计记录`);
```

previewText 参数表把 `runMode: string` 前加 `tier: string`，调用处传 `action.tier`。

- [ ] **Step 4: 更新既有测试并补用例**

在 `engine/src/transition.test.ts` 末尾追加：

```typescript
describe('action tier (P1)', () => {
  it('marks gateless bug transition L1 with shouldConfirm=false when validation passes', () => {
    const out = runTransition(loadModel(), {
      type: 'bug', iid: 1, labels: ['type::bug', 'status::已确认缺陷'],
      body: '|角色|用户|\\n|--|--|\\n|研发|@dev|\\n|测试|@qa|', state: 'opened',
      notes: [], fields: {}, datesConfirmed: true,
    });
    expect(out.actionTier).toBe('L1');
    expect(out.shouldConfirm).toBe(false);
  });
  it('marks hard gate L3 and requires confirmation even when validation passes', () => {
    const out = runTransition(loadModel(), {
      type: 'bug', iid: 1, labels: ['type::bug', 'status::待发布'],
      body: '|角色|用户|\\n|--|--|\\n|研发|@dev|\\n|测试|@qa|', state: 'opened',
      notes: [], datesConfirmed: true, humanConfirmed: true,
      fields: { 发布日期: '2026-09-01', 研发Assignee: '@dev', 生产版本: 'v1.0', 发布记录或回滚信息: '见 release-check' },
    });
    expect(out.actionTier).toBe('L3');
    expect(out.shouldConfirm).toBe(true);
  });
});
```

注意：既有 transition.test.ts 中断言 `shouldConfirm` 与 run_mode 关系的用例，凡断言「semi-auto ⇒ shouldConfirm=true」且转换本身 gate===null 的，按新语义改为断言 `actionTier`；gate!==null 的行为不变（仍 true）。逐个跑、按失败输出修断言，不得跳过失败测试。

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `pnpm test && pnpm typecheck`
Expected: 全部通过（既有用例修断言后）

- [ ] **Step 6: Commit**

```bash
git add engine/src/types.ts engine/src/transition.ts engine/src/transition.test.ts
git commit -m "feat(transition): shouldConfirm 改由动作分层决定，run_mode 仅审计"
```

---

# 阶段 2：DU 事实层 + `next` 最短路径 + 评论瘦身

目标：执行明细（TestRun/AssetAudit）不再要求发 Issue 评论，降为 DU 本地事实；新增 `next` 命令输出「在哪/阻塞/下一步/谁欠什么」。

### Task 2.1: DuState 类型与本地事实记录

**Files:**
- Create: `engine/src/du.ts`
- Test: `engine/src/du.test.ts`
- Modify: `engine/src/types.ts`

- [ ] **Step 1: types.ts 加 DU 类型**

```typescript
/** DU 本地执行事实（spec §3.1）：Issue 只留流转评论，明细归 DU。 */
export interface DuEvidenceEntry {
  kind: 'test-run' | 'asset-audit';
  environment: TestEnvironment;
  planVersion: string;
  outcome: string;
  recordedAt: string;
  /** 本地明细文件/报告指针（报告 ID、链接）。 */
  detailRef?: string;
}

export interface DuState {
  iid: number;
  type: IssueType;
  /** DU 记录的最近节点（对账用，P5 reconcile）；Leader 每次流转成功后写回。 */
  cachedNode: string;
  /** 技术方案声明的受影响维度（GateSet 输入，P3 使用）。 */
  affectedScopes: ChangeScope[];
  /** 冻结后的门禁单（P3 写入；空 = 尚未绑定）。 */
  gateSet?: GateSet;
  /** 执行事实流水（append-only，引擎只算不写盘）。 */
  evidence: DuEvidenceEntry[];
  /** 资源登记表（P4 使用）。 */
  resources: DuResourceEntry[];
  /** 指标事件（P6 使用）。 */
  metricEvents: DuMetricEvent[];
  updatedAt: string;
}
```

（`GateSet`/`DuResourceEntry`/`DuMetricEvent` 在 P3/P4/P6 定义；本阶段先在 types.ts 用最小占位类型保证编译——`export type GateSet = unknown;` 等是不允许的，改用前向声明方式：P2 阶段直接把这三个类型写全最简形态，后续阶段再扩字段。最简形态见各阶段任务。）

- [ ] **Step 2: 实现 du.ts**

```typescript
// engine/src/du.ts
import type { DuState, DuEvidenceEntry, IssueType } from './types.js';

export interface InitDuInput {
  iid: number;
  type: IssueType;
  now: string;
}

export function initDu(input: InitDuInput): DuState {
  return {
    iid: input.iid,
    type: input.type,
    cachedNode: '',
    affectedScopes: [],
    evidence: [],
    resources: [],
    metricEvents: [],
    updatedAt: input.now,
  };
}

/** 追加一条执行事实（幂等：同 kind+environment+planVersion+recordedAt 不重复追加）。不可变。 */
export function recordEvidence(du: DuState, entry: DuEvidenceEntry, now: string): DuState {
  const dup = du.evidence.some((e) =>
    e.kind === entry.kind && e.environment === entry.environment
    && e.planVersion === entry.planVersion && e.recordedAt === entry.recordedAt);
  if (dup) return du;
  return { ...du, evidence: [...du.evidence, entry], updatedAt: now };
}

/** 某环境当前计划版本的最新事实（无则 undefined）。 */
export function latestEvidence(du: DuState, kind: DuEvidenceEntry['kind'], environment: string): DuEvidenceEntry | undefined {
  return [...du.evidence].reverse().find((e) => e.kind === kind && e.environment === environment);
}
```

- [ ] **Step 3: 验证测试（追加到新文件 du.test.ts）**

```typescript
// engine/src/du.test.ts
import { describe, expect, it } from 'vitest';
import { initDu, recordEvidence, latestEvidence } from './du.js';

const base = { iid: 88, type: 'story' as const, now: '2026-09-01T00:00:00Z' };

describe('du evidence', () => {
  it('appends evidence immutably', () => {
    const du = initDu(base);
    const next = recordEvidence(du, { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: base.now }, base.now);
    expect(du.evidence).toHaveLength(0);
    expect(next.evidence).toHaveLength(1);
  });
  it('is idempotent for identical entry', () => {
    const du = recordEvidence(initDu(base), { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: base.now }, base.now);
    expect(recordEvidence(du, { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: base.now }, base.now).evidence).toHaveLength(1);
  });
  it('latestEvidence returns newest matching entry', () => {
    let du = initDu(base);
    du = recordEvidence(du, { kind: 'asset-audit', environment: 'test', planVersion: 'v1', outcome: 'v2-audit', recordedAt: '2026-09-01T01:00:00Z' }, base.now);
    du = recordEvidence(du, { kind: 'asset-audit', environment: 'test', planVersion: 'v2', outcome: 'v2-audit', recordedAt: '2026-09-01T02:00:00Z' }, base.now);
    expect(latestEvidence(du, 'asset-audit', 'test')?.planVersion).toBe('v2');
    expect(latestEvidence(du, 'asset-audit', 'local')).toBeUndefined();
  });
});
```

- [ ] **Step 4: 跑测试 + commit**

Run: `pnpm vitest run engine/src/du.test.ts` → 3 passed；`pnpm typecheck` → 通过

```bash
git add engine/src/du.ts engine/src/du.test.ts engine/src/types.ts
git commit -m "feat(du): 交付工作包本地事实层（证据流水）"
```

### Task 2.2: 门禁证据源切换——Issue 评论 → DU（评论瘦身核心）

**Files:**
- Modify: `engine/src/guard.ts`（validateTransition 签名与 validateTestRun/AssetAudit 系列）
- Modify: `engine/src/types.ts`（Payload/TransitionInput 加 `du?: DuState`）
- Modify: `engine/src/transition.ts`（透传 du）
- Modify: `engine/src/cli.ts`（transition case 透传）

- [ ] **Step 1: types.ts 扩输入**

`Payload` 接口 `testPlan?: string;` 行后加：

```typescript
  /** DU 本地事实（P2 起：TestRun/AssetAudit 证据优先取本地，不再要求 Issue 评论）。 */
  du?: DuState;
```

`TransitionInput` 同样加 `du?: DuState;`（放在 `testPlan?: string;` 之后）。

- [ ] **Step 2: guard.ts 证据选择**

`validateTestRunTransition` 与 `validateApifoxAssetAuditTransition` 改为双源读取——**DU 优先，Issue 评论兜底**（存量 Issue 无 DU，回读评论仍可用，满足「回读推导不迁移」）：

```typescript
import { latestEvidence } from './du.js';

function duTestRunFor(payload: Payload, environment: string) {
  const entry = payload.du ? latestEvidence(payload.du, 'test-run', environment) : undefined;
  return entry ? { environment: entry.environment, planVersion: entry.planVersion, version: '', outcome: entry.outcome as 'passed' | 'failed', assetAudit: `${entry.planVersion}/${entry.environment}`, cases: {}, evidence: {} } : undefined;
}

function duAssetAuditFor(payload: Payload, environment: string) {
  const entry = payload.du ? latestEvidence(payload.du, 'asset-audit', environment) : undefined;
  return entry ? { environment: entry.environment, planVersion: entry.planVersion, project: '', branch: '', unresolvedFindings: 0, evidence: entry.detailRef ?? '', assets: [] } : undefined;
}
```

在 `validateTestRunTransition` 内，读取行改为：

```typescript
  const fromDu = duTestRunFor(payload, environment);
  const parsedLatest = fromDu
    ? { kind: 'valid' as const, run: fromDu }
    : parseLatestTestRun(notes, environment);
  const validation = validateTestRun(parsedPlan.plan, environment, parsedLatest);
```

`validateApifoxAssetAuditTransition` 同理替换 `parseLatestApifoxAssetAudit(notes, environment)`。

- [ ] **Step 3: transition.ts / cli.ts 透传**

`transition.ts` 的 payload 组装（`...(input.testPlan !== undefined ? ...)` 一段）加：

```typescript
    ...(input.du ? { du: input.du } : {}),
```

`cli.ts` 无需改（transition case 直接 `JSON.parse` 整个 TransitionInput，`du` 自动透传）。验证 `pnpm typecheck`。

- [ ] **Step 4: 验证测试（guard.test.ts 追加）**

```typescript
describe('DU-first evidence (P2)', () => {
  const basePayload = (du?: DuState): Payload => ({
    type: 'story', from: '开发中', to: '测试中',
    fields: { 代码评审结论: '通过', 提测日期: '2026-09-01', 研发Assignee: '@dev', 可测试版本或环境: 'test http://t', 测试说明: '见 spec' },
    assigneeUser: '@qa', datesConfirmed: true,
    testPlan: '<!-- glab-flow:test-plan:v1\nplan-version: v1\ncase: TP-001 | local | api\n-->',
    ...(du ? { du } : {}),
  });

  it('accepts local TestRun from DU evidence without Issue comments', () => {
    const du = recordEvidence(initDu({ iid: 88, type: 'story', now: T }), { kind: 'test-run', environment: 'local', planVersion: 'v1', outcome: 'passed', recordedAt: T }, T);
    const result = validateTransition(loadModel(), facts(['type::story', 'story-status::开发中']), basePayload(du), []);
    expect(result.ok).toBe(true);
  });
  it('still falls back to Issue comment evidence when DU absent', () => {
    const note = [{ body: '<!-- glab-flow:test-run:v1\nenvironment: local\nplan-version: v1\nversion: svc:abc\noutcome: passed\nasset-audit: v1/local\ncases: TP-001=passed\nevidence: api=report:1\n-->', created_at: T, id: 1 }];
    const result = validateTransition(loadModel(), facts(['type::story', 'story-status::开发中']), basePayload(), note);
    expect(result.ok).toBe(true);
  });
});
```

（`facts`/`T`/import 按既有 guard.test.ts 的局部约定取；`recordEvidence`/`initDu` 从 `./du.js` import。注意 AssetAudit 同样需要 DU 记录才通过——两个 describe 的 du 都要 `recordEvidence` 两条：kind 'asset-audit' 与 'test-run'。按失败输出补齐。）

- [ ] **Step 5: 全量回归 + commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add engine/src/types.ts engine/src/guard.ts engine/src/transition.ts engine/src/guard.test.ts
git commit -m "feat(guard): TestRun/AssetAudit 证据 DU 优先、Issue 评论兜底（评论瘦身）"
```

### Task 2.3: `next` 最短路径命令

**Files:**
- Create: `engine/src/next-step.ts`
- Test: `engine/src/next-step.test.ts`
- Modify: `engine/src/cli.ts`（新增 case）

- [ ] **Step 1: 实现 next-step.ts**

```typescript
// engine/src/next-step.ts
import type { StateMachine, IssueType, DuState, MissingItem, TransitionOutput } from './types.js';
import { runTransition } from './transition.js';
import { TERMINAL } from './constants.js';

export interface NextStepInput {
  type: IssueType;
  iid: number;
  labels: string[];
  body: string;
  notes: Parameters<typeof runTransition>[1]['notes'];
  state: 'opened' | 'closed';
  du?: DuState;
  testPlan?: string;
  fields?: Record<string, string>;
  config?: Parameters<typeof runTransition>[1]['config'];
}

export interface NextStepOutput {
  where: string;
  isTerminal: boolean;
  blockedOn: MissingItem[];
  /** 最快路径：从当前节点到终态还要经过的节点序列（按 state-machine 顺序）。 */
  fastestPath: string[];
  /** 谁欠什么：缺失字段按角色归组。 */
  owedBy: { role: string; items: string[] }[];
  /** 投影漂移：labels 与 DU/事实不一致时的对账提示（P5 前仅脏状态透传）。 */
  drift?: string;
  summary: string;
}

export function computeNextStep(model: StateMachine, input: NextStepInput): NextStepOutput {
  const out = runTransition(model, { ...input, to: undefined });
  if (out.dirty) {
    return { where: out.node ?? '?', isTerminal: false, blockedOn: [], fastestPath: [], owedBy: [], drift: out.dirtyReason, summary: `状态标签异常，需人工对账：${out.dirtyReason}` };
  }
  const node = out.node as string;
  if (TERMINAL.has(node)) {
    return { where: node, isTerminal: true, blockedOn: [], fastestPath: [], owedBy: [], summary: '已完成（终态）。剩余动作：资源清理（P4 起由 du.resources 驱动）。' };
  }
  const chain: string[] = [];
  let cur = node;
  for (let i = 0; i < 12; i++) {
    const trs = model[input.type].transitions.filter((t) => t.from === cur);
    const fwd = trs.find((t) => t.to !== undefined && !TERMINAL.has(t.from)) ?? trs[0];
    if (!fwd) break;
    chain.push(fwd.to);
    cur = fwd.to;
    if (TERMINAL.has(cur)) break;
  }
  const byRole = new Map<string, string[]>();
  for (const m of out.missing) {
    const owner = /评审|需求|验收|产品/.test(m.field) ? '产品' : /测试|复测|用例/.test(m.field) ? '测试' : '研发';
    byRole.set(owner, [...(byRole.get(owner) ?? []), m.field]);
  }
  const owedBy = [...byRole.entries()].map(([role, items]) => ({ role, items }));
  const nextAction = out.validate.ok
    ? `可推进到「${out.next}」（${out.actionTier}：${out.actionTier === 'L1' ? '自动执行' : '批量确认'}）`
    : out.missing.length ? `补齐缺口后推进「${out.next}」` : `门禁未过：${out.validate.reasons[0] ?? ''}`;
  const summary = [`你在：${node}（#${input.iid}）`, `最快下一步：${nextAction}`, ...owedBy.map((o) => `待 ${o.role}：${o.items.join('、')}`)].join('\n');
  return { where: node, isTerminal: false, blockedOn: out.missing, fastestPath: chain, owedBy, summary };
}
```

- [ ] **Step 2: cli.ts 加 case（default 前插入）**

```typescript
    case 'next': {
      const input = JSON.parse(readStdin()) as NextStepInput;
      console.log(JSON.stringify(computeNextStep(model, input)));
      break;
    }
```

顶部加 `import { computeNextStep } from './next-step.js';` 与 `import type { NextStepInput } from './next-step.js';`（或并入现有 type import 行）。default 帮助串补 `| next`。

- [ ] **Step 3: 验证测试 next-step.test.ts**

```typescript
import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { computeNextStep } from './next-step.js';

const base = { type: 'story' as const, iid: 88, labels: ['type::story', 'story-status::开发中'], state: 'opened' as const, notes: [], body: '|角色|用户|\n|--|--|\n|研发|@dev|\n|测试|@qa|\n|产品|@pm|' };

describe('computeNextStep', () => {
  it('reports where/blocked/owed for a mid-flight story', () => {
    const out = computeNextStep(loadModel(), base);
    expect(out.where).toBe('开发中');
    expect(out.isTerminal).toBe(false);
    expect(out.blockedOn.length).toBeGreaterThan(0);
    expect(out.fastestPath[0]).toBe('测试中');
    expect(out.owedBy.length).toBeGreaterThan(0);
    expect(out.summary).toContain('你在：开发中');
  });
  it('surfaces dirty labels as drift', () => {
    const out = computeNextStep(loadModel(), { ...base, labels: ['type::story'] });
    expect(out.drift).toBeDefined();
  });
  it('terminal node reports cleanup hint', () => {
    const out = computeNextStep(loadModel(), { ...base, labels: ['type::story', 'story-status::已完成'] });
    expect(out.isTerminal).toBe(true);
    expect(out.summary).toContain('资源清理');
  });
});
```

Run: `pnpm vitest run engine/src/next-step.test.ts` → 3 passed

- [ ] **Step 4: 手工冒烟（真实 CLI）**

```bash
echo '{"type":"bug","iid":9,"labels":["type::bug","status::待发布"],"state":"opened","notes":[],"body":"|角色|用户|\n|--|--|\n|研发|@dev|\n|测试|@qa|","fields":{"发布日期":"2026-09-01","研发Assignee":"@dev","生产版本":"v1","发布记录或回滚信息":"r"}}' | pnpm cli next | python3 -m json.tool | head -20
```

Expected: JSON 含 `"where": "待发布"`、`fastestPath` 指向生产验证中/已完成。

- [ ] **Step 5: 全量回归 + commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add engine/src/next-step.ts engine/src/next-step.test.ts engine/src/cli.ts
git commit -m "feat(next): 最短路径查询命令（在哪/阻塞/最快下一步/谁欠什么）"
```

---

# 阶段 3：GateSet 维度推导门禁

目标：技术方案声明的受影响维度 → 确定性推导门禁单 → 状态路径可跳过。G14/G11/G15 按 GateSet 生效。

### Task 3.1: gate-set 模块 + state-machine.yaml 矩阵

**Files:**
- Create: `engine/src/gate-set.ts`
- Test: `engine/src/gate-set.test.ts`
- Modify: `engine/state-machine.yaml`
- Modify: `engine/src/types.ts`

- [ ] **Step 1: state-machine.yaml 追加矩阵（文件末尾）**

```yaml
# 维度 → 门禁推导矩阵（spec §3.2）。GateSet 决定状态路径/环境执行范围/MR评审/回归深度。
gateMatrix:
  defaults:
    skipStates: []
    environments: [local, test]
    mrReview: true
    regression: full
  rules:
    - scopes: [frontend-copy]
      skipStates: [测试中]
      environments: [local]
      mrReview: false
      regression: affected-cases
    - scopes: [functional]
      skipStates: []
      environments: [local, test]
      mrReview: false
      regression: affected-cases
    - scopes: [api-contract]
      environments: [local, test]
      mrReview: true
      regression: full
    - scopes: [data-model, permission]
      environments: [local, test]
      mrReview: true
      regression: full
      rollbackPlan: true
```

注意：`frontend-copy` 是新增维度（文案级），加入 types.ts 的 `ChangeScope` 联合：`| 'frontend-copy'`，并同步 `change-impact.ts` 的 `SCOPES` Set。

- [ ] **Step 2: types.ts 定义 GateSet 与推导输入**

```typescript
/** 维度推导出的门禁单（spec §3.2）；已评审→开发中 绑定并冻结。 */
export interface GateSet {
  scopes: ChangeScope[];
  skipStates: string[];
  environments: TestEnvironment[];
  mrReview: boolean;
  regression: 'affected-cases' | 'full';
  rollbackPlan: boolean;
  /** 显式改判记录（增/删门禁都留痕）。 */
  overrides: { field: string; from: string; to: string; by: string; at: string }[];
  frozenAt?: string;
}
```

StateMachine 接口加可选字段：`gateMatrix?: GateMatrix;`，并定义：

```typescript
export interface GateMatrixRule {
  scopes: string[];
  skipStates?: string[];
  environments?: string[];
  mrReview?: boolean;
  regression?: 'affected-cases' | 'full';
  rollbackPlan?: boolean;
}
export interface GateMatrix {
  defaults: Required<Pick<GateMatrixRule, 'environments' | 'mrReview' | 'regression'>> & GateMatrixRule;
  rules: GateMatrixRule[];
}
```

（Task 2.1 若已给 `GateSet` 留了最简形态，此处替换为完整定义。）

- [ ] **Step 3: 实现 gate-set.ts**

```typescript
// engine/src/gate-set.ts
import type { ChangeScope, GateMatrix, GateSet } from './types.js';

const RANK: Record<string, number> = { 'frontend-copy': 0, functional: 1, 'api-contract': 2, 'data-model': 3, permission: 3, 'frontend-route': 2, schedule: 0, release: 4 };

/** 从声明维度推导 GateSet：取命中的最高档规则为基准；未命中走 defaults。纯函数。 */
export function deriveGateSet(matrix: GateMatrix, scopes: ChangeScope[]): GateSet {
  const ranked = [...new Set(scopes)].sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0));
  const hit = matrix.rules.find((rule) => rule.scopes.some((s) => ranked.includes(s as ChangeScope)));
  const base = hit ?? matrix.defaults;
  const merged: ChangeScope[] = [...new Set([...(hit?.scopes ?? []).filter((s) => ranked.includes(s as ChangeScope)) as ChangeScope[], ...ranked.filter((s) => (hit?.scopes ?? []).includes(s))])];
  return {
    scopes: ranked,
    skipStates: base.skipStates ?? [],
    environments: (base.environments ?? matrix.defaults.environments).slice(),
    mrReview: base.mrReview ?? matrix.defaults.mrReview,
    regression: base.regression ?? matrix.defaults.regression,
    rollbackPlan: base.rollbackPlan ?? false,
    overrides: [],
  };
}

/** 棘轮（spec §3.2）：只升不降——并集维度重推导；显式降级必须走 overrideGateSet 留痕。 */
export function ratchetGateSet(current: GateSet, matrix: GateMatrix, newScopes: ChangeScope[]): GateSet {
  const merged = [...new Set([...current.scopes, ...newScopes])];
  const next = deriveGateSet(matrix, merged);
  return { ...next, overrides: current.overrides, frozenAt: current.frozenAt };
}

/** 显式改判（增/删门禁）：记录 override 并返回新 GateSet。 */
export function overrideGateSet(current: GateSet, field: 'mrReview' | 'regression' | 'rollbackPlan', value: GateSet[field], by: string, at: string): GateSet {
  const from = String(current[field]);
  return { ...current, [field]: value, overrides: [...current.overrides, { field, from, to: String(value), by, at }] };
}

export function freezeGateSet(gs: GateSet, at: string): GateSet {
  return gs.frozenAt ? gs : { ...gs, frozenAt: at };
}
```

- [ ] **Step 4: 验证测试 gate-set.test.ts**

```typescript
import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { deriveGateSet, ratchetGateSet, overrideGateSet, freezeGateSet } from './gate-set.js';

const matrix = loadModel().gateMatrix!;

describe('deriveGateSet', () => {
  it('frontend-copy skips 测试中 and disables MR review', () => {
    const gs = deriveGateSet(matrix, ['frontend-copy']);
    expect(gs.skipStates).toContain('测试中');
    expect(gs.mrReview).toBe(false);
    expect(gs.environments).toEqual(['local']);
  });
  it('data-model wins over frontend-copy (highest rank)', () => {
    const gs = deriveGateSet(matrix, ['frontend-copy', 'data-model']);
    expect(gs.skipStates).toEqual([]);
    expect(gs.mrReview).toBe(true);
    expect(gs.rollbackPlan).toBe(true);
  });
  it('unknown-only scopes fall back to defaults', () => {
    const gs = deriveGateSet(matrix, ['schedule']);
    expect(gs.environments).toEqual(['local', 'test']);
    expect(gs.mrReview).toBe(true);
  });
});

describe('ratchet', () => {
  it('never drops requirements when scopes grow', () => {
    const base = freezeGateSet(deriveGateSet(matrix, ['frontend-copy']), 'T0');
    const up = ratchetGateSet(base, matrix, ['api-contract']);
    expect(up.mrReview).toBe(true);
    expect(up.skipStates).toEqual([]);
  });
  it('override leaves audit trail', () => {
    const gs = overrideGateSet(deriveGateSet(matrix, ['api-contract']), 'mrReview', false, '@pm', 'T1');
    expect(gs.mrReview).toBe(false);
    expect(gs.overrides).toHaveLength(1);
    expect(gs.overrides[0]).toMatchObject({ field: 'mrReview', from: 'true', to: 'false', by: '@pm' });
  });
});
```

Run: `pnpm vitest run engine/src/gate-set.test.ts` → 5 passed

- [ ] **Step 5: Commit**

```bash
git add engine/state-machine.yaml engine/src/gate-set.ts engine/src/gate-set.test.ts engine/src/types.ts engine/src/change-impact.ts
git commit -m "feat(gate-set): 维度→门禁推导矩阵 + 棘轮/改判留痕"
```

### Task 3.2: transition/guard 按 GateSet 生效

**Files:**
- Modify: `engine/src/guard.ts`（G11/G14 按 gateSet；跳状态放行）
- Modify: `engine/src/transition.ts`（GateSet 跳状态：目标节点推进时穿过 skipStates）
- Modify: `engine/src/guard.test.ts`、`engine/src/transition.test.ts`

- [ ] **Step 1: guard.ts G11/G14 挂 GateSet**

`validateTransition` 里 G11 段（测试中→待发布）与 requiredFields 中的 `feature分支MR评审结论`（G14）按 `payload.du?.gateSet` 生效：

```typescript
  const gateSet = payload.du?.gateSet;
  // G14: MR 评审仅在 GateSet 要求时为必填字段（skipStates 含 测试中 的路线永远不触发本转换）
  const effectiveRequired = t.requiredFields.filter((f) =>
    !(gateSet && gateSet.mrReview === false && f === 'feature分支MR评审结论'));
```

G1 必填循环改用 `effectiveRequired`。G11 保持原样（能走到 测试中→待发布 说明路线没跳过测试，语义自洽）。

- [ ] **Step 2: transition.ts 跳状态投影**

`runTransition` 里目标节点解析后（`const target = input.to ?? ...` 之后）加：

```typescript
  // GateSet 跳状态（spec §3.2）：skipStates 中的节点被投影穿过——直接推进到跳过段之后的下一节点
  const skip = input.du?.gateSet?.skipStates ?? [];
  let effectiveTarget = target;
  if (skip.includes(target)) {
    const path = model[input.type].transitions.filter((t) => t.from === target);
    effectiveTarget = path[0]?.to ?? target;
  }
```

`transitionFor` 查询改用 `effectiveTarget`；`next` 输出 `effectiveTarget`。同时 `buildForwardPlan(payload)` 的 payload `to` 已是 `tr.to`，无需另改。

- [ ] **Step 3: 绑定点——已评审→开发中 接受维度声明**

`TransitionInput` 加 `declaredScopes?: ChangeScope[];`。transition.ts 在 story 已评审→开发中 且提供 `declaredScopes` 时，输出 `proposedGateSet: GateSet`（`deriveGateSet(model.gateMatrix!, input.declaredScopes)`）供 Leader 在 L2 批量确认里过目。`TransitionOutput` 加 `proposedGateSet?: GateSet;`。

- [ ] **Step 4: 验证测试（两个文件各追加）**

guard.test.ts：

```typescript
describe('GateSet-scoped guards (P3)', () => {
  it('drops MR-review requirement when GateSet disables mrReview', () => {
    const payload: Payload = { type: 'story', from: '测试中', to: '待发布', fields: { /* 不含 feature分支MR评审结论 */ 测试完成日期: '2026-09-01', 测试Assignee: '@qa', 测试结论: '通过', 回归范围或证据: 'r', 阻塞发布问题均已验证通过: '是' }, assigneeUser: '@dev', datesConfirmed: true, testPlan: PLAN, du: { ...initDu({ iid: 1, type: 'story', now: T }), gateSet: deriveGateSet(loadModel().gateMatrix!, ['functional']) } };
    const result = validateTransition(loadModel(), facts(['type::story', 'story-status::测试中']), payload, []);
    expect(result.missing).not.toContain('feature分支MR评审结论');
  });
});
```

transition.test.ts：

```typescript
describe('GateSet skip states (P3)', () => {
  it('frontend-copy DU skips 测试中: 开发中 advances straight to 待发布', () => {
    const gs = deriveGateSet(loadModel().gateMatrix!, ['frontend-copy']);
    const out = runTransition(loadModel(), { type: 'story', iid: 88, labels: ['type::story', 'story-status::开发中'], body: TABLE, state: 'opened', notes: [], fields: { 代码评审结论: '通过', 提测日期: '2026-09-01', 研发Assignee: '@dev', 可测试版本或环境: 'local', 测试说明: 's' }, assigneeUser: '@qa', datesConfirmed: true, du: { ...initDu({ iid: 88, type: 'story', now: T }), gateSet: gs } });
    expect(out.next).toBe('待发布');
  });
});
```

注意：该转换的 local TestRun/AssetAudit 门禁仍生效（frontend-copy environments=[local]），测试 du 里要 recordEvidence local 的 test-run + asset-audit 两条（同 Task 2.2 方式）。skipStates 含 测试中 的 DU 走 开发中→测试中 转换时，按 Step 2 直接投影到 待发布——但必填字段仍是 开发中→测试中 的（保守：字段不减少，风险靠门禁分层减）。

- [ ] **Step 5: contract.ts 契约同步**

`process-contract.test.ts` / `contract.ts` 若断言 yaml 结构，补 gateMatrix 存在性断言：

```typescript
it('state machine carries the gate matrix', () => {
  expect(loadModel().gateMatrix?.rules?.length).toBeGreaterThan(0);
});
```

Run: `pnpm test && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add engine/src/guard.ts engine/src/transition.ts engine/src/types.ts engine/src/guard.test.ts engine/src/transition.test.ts engine/src/process-contract.test.ts
git commit -m "feat(gates): G14/G11 按 GateSet 生效 + 跳状态投影 + 方案维度绑定"
```

---

# 阶段 4：资源登记表（ResourceRegistry）

目标：分支/worktree/Apifox 资产/测试数据/报告/部署版本显式登记进 DU；终态自动出清理清单。

### Task 4.1: resource 模块

**Files:**
- Create: `engine/src/resource.ts`
- Test: `engine/src/resource.test.ts`
- Modify: `engine/src/types.ts`（DuResourceEntry 完整定义，替换 Task 2.1 最简形态）
- Modify: `engine/src/cli.ts`

- [ ] **Step 1: types.ts 定义**

```typescript
/** DU 资源登记项（spec §3.4）：创建即登记，终态出清理清单。 */
export interface DuResourceEntry {
  id: string;
  kind: 'branch' | 'worktree' | 'apifox-scenario' | 'apifox-suite' | 'apifox-test-data' | 'apifox-scenario-instance' | 'auth-profile-ref' | 'test-data' | 'report' | 'deploy-version';
  scope: 'non-prod' | 'prod';
  lifecycle: 'temporary' | 'shared-candidate' | 'permanent';
  createdAt: string;
  detail?: string;
  disposedAt?: string;
  disposal?: 'deleted' | 'promoted-shared' | 'kept';
}

export interface ResourceCheckIssue {
  resourceId: string;
  issue: string;
}
```

- [ ] **Step 2: 实现 resource.ts**

```typescript
// engine/src/resource.ts
import type { DuResourceEntry, DuState, ResourceCheckIssue } from './types.js';

export function registerResource(du: DuState, entry: Omit<DuResourceEntry, 'disposedAt' | 'disposal'>, now: string): DuState {
  if (du.resources.some((r) => r.id === entry.id)) return du;
  return { ...du, resources: [...du.resources, { ...entry }], updatedAt: now };
}

/** 登记校验（spec §3.4）：临时资源命名/前缀与归属一致性。 */
export function checkResources(du: DuState, iid: number): ResourceCheckIssue[] {
  const issues: ResourceCheckIssue[] = [];
  const tmpPrefix = `TMP-${iid}-`;
  for (const r of du.resources) {
    if (r.lifecycle === 'temporary' && r.kind.startsWith('apifox') && !r.id.startsWith(tmpPrefix)) {
      issues.push({ resourceId: r.id, issue: `临时 Apifox 资源应以 ${tmpPrefix} 前缀命名` });
    }
    if (r.scope === 'prod' && r.lifecycle === 'temporary') {
      issues.push({ resourceId: r.id, issue: '生产资源不允许 temporary 生命周期' });
    }
  }
  return issues;
}

/** 终态清理清单（spec §3.4）：未处置的 temporary/shared-candidate 逐项列出处置选项。 */
export function cleanupChecklist(du: DuState): { resourceId: string; kind: DuResourceEntry['kind']; suggestion: '删除' | '升级为共享资产' | '保留并说明' }[] {
  return du.resources
    .filter((r) => !r.disposedAt)
    .map((r) => ({
      resourceId: r.id,
      kind: r.kind,
      suggestion: r.lifecycle === 'temporary' ? '删除' : r.lifecycle === 'shared-candidate' ? '升级为共享资产' : '保留并说明',
    }));
}

export function disposeResource(du: DuState, resourceId: string, disposal: NonNullable<DuResourceEntry['disposal']>, now: string): DuState {
  return {
    ...du,
    resources: du.resources.map((r) => (r.id === resourceId ? { ...r, disposedAt: now, disposal } : r)),
    updatedAt: now,
  };
}
```

- [ ] **Step 3: cli.ts 加 `resource` case（default 前插入）**

```typescript
    case 'resource': {
      // stdin: {du, op: 'register'|'check'|'cleanup'|'dispose', entry?, resourceId?, disposal?, now}
      const input = JSON.parse(readStdin()) as { du: DuState; op: 'register' | 'check' | 'cleanup' | 'dispose'; entry?: Parameters<typeof registerResource>[1]; resourceId?: string; disposal?: 'deleted' | 'promoted-shared' | 'kept'; now: string };
      const { registerResource, checkResources, cleanupChecklist, disposeResource } = await import('./resource.js');
      switch (input.op) {
        case 'register': console.log(JSON.stringify(registerResource(input.du, input.entry!, input.now))); break;
        case 'check': console.log(JSON.stringify(checkResources(input.du, input.du.iid))); break;
        case 'cleanup': console.log(JSON.stringify(cleanupChecklist(input.du))); break;
        case 'dispose': console.log(JSON.stringify(disposeResource(input.du, input.resourceId!, input.disposal!, input.now))); break;
      }
      break;
    }
```

（顶部静态 import 更符合本仓风格——cli.ts 全部为静态 import，改为顶部 `import { registerResource, checkResources, cleanupChecklist, disposeResource } from './resource.js';` + 直接调用。`DuState` 类型 import 补进现有 type import 行。）

- [ ] **Step 4: 验证测试 resource.test.ts**

```typescript
import { describe, expect, it } from 'vitest';
import { initDu } from './du.js';
import { registerResource, checkResources, cleanupChecklist, disposeResource } from './resource.js';

const T = '2026-09-01T00:00:00Z';
const base = () => initDu({ iid: 88, type: 'story', now: T });

describe('resource registry', () => {
  it('registers immutably and dedupes by id', () => {
    const du = registerResource(base(), { id: 'TMP-88-members', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    expect(du.resources).toHaveLength(1);
    expect(registerResource(du, { id: 'TMP-88-members', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T).resources).toHaveLength(1);
  });
  it('flags temporary apifox resource without TMP prefix', () => {
    const du = registerResource(base(), { id: 'members-data', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    expect(checkResources(du, 88)).toHaveLength(1);
  });
  it('cleanup checklist lists undisposed only', () => {
    let du = registerResource(base(), { id: 'TMP-88-a', kind: 'apifox-test-data', scope: 'non-prod', lifecycle: 'temporary', createdAt: T }, T);
    du = registerResource(du, { id: 'branch-feature-88', kind: 'branch', scope: 'non-prod', lifecycle: 'permanent', createdAt: T }, T);
    du = disposeResource(du, 'branch-feature-88', 'kept', T);
    const list = cleanupChecklist(du);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ resourceId: 'TMP-88-a', suggestion: '删除' });
  });
});
```

Run: `pnpm vitest run engine/src/resource.test.ts` → 3 passed

- [ ] **Step 5: 终态钩子接入 next-step.ts**

`computeNextStep` 终态分支的 summary 改为带清理清单：

```typescript
  if (TERMINAL.has(node)) {
    const pending = input.du ? require('./resource.js').cleanupChecklist(input.du) : [];
```

不允许 require（ESM）——改为顶部 `import { cleanupChecklist } from './resource.js';`，终态分支：

```typescript
    const pending = input.du ? cleanupChecklist(input.du) : [];
    return { where: node, isTerminal: true, blockedOn: [], fastestPath: [], owedBy: [], summary: pending.length ? `已完成（终态）。资源清理待办 ${pending.length} 项：${pending.map((p) => `${p.resourceId}(${p.suggestion})`).join('、')}` : '已完成（终态），无待清理资源。' };
  }
```

next-step.test.ts 终态用例断言同步改（构造带资源的 du 断言「资源清理待办」字样）。

Run: `pnpm test && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add engine/src/resource.ts engine/src/resource.test.ts engine/src/types.ts engine/src/cli.ts engine/src/next-step.ts engine/src/next-step.test.ts
git commit -m "feat(resource): 资源一等模型——登记/校验/终态清理清单 + next 集成"
```

---

# 阶段 5：变化分级 + 对账

### Task 5.1: change 命令（分级 + GateSet 扩容）

**Files:**
- Create: `engine/src/change.ts`
- Test: `engine/src/change.test.ts`
- Modify: `engine/src/cli.ts`、`engine/src/change-impact.ts`

- [ ] **Step 1: 实现 change.ts（复用 deriveChangeImpact，叠加定级与棘轮）**

```typescript
// engine/src/change.ts
import type { ChangeImpactInput, ChangeScope, DuState, GateSet, GuardResult, StateMachine } from './types.js';
import { deriveChangeImpact, validateChangeImpactInput } from './change-impact.js';
import { ratchetGateSet } from './gate-set.js';

/** 变化级别（spec §4.3）：由 scopes 决定关闭证据深度。 */
export type ChangeTier = 'T1' | 'T2' | 'T3' | 'T4';

const TIER_BY_SCOPE: Record<ChangeScope, ChangeTier> = {
  'frontend-copy': 'T1', functional: 'T2', 'frontend-route': 'T2',
  'api-contract': 'T3', 'data-model': 'T4', permission: 'T4',
  schedule: 'T1', release: 'T4',
};
const TIER_RANK: Record<ChangeTier, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

export function classifyChangeTier(scopes: ChangeScope[]): ChangeTier {
  return scopes.reduce<ChangeTier>((acc, s) => (TIER_RANK[TIER_BY_SCOPE[s]] > TIER_RANK[acc] ? TIER_BY_SCOPE[s] : acc), 'T1');
}

export interface ChangePlanInput extends ChangeImpactInput {
  du: DuState;
}

export interface ChangePlanOutput {
  tier: ChangeTier;
  impact: ReturnType<typeof deriveChangeImpact>;
  /** 棘轮扩容后的 GateSet（若 open 单影响维度超出已冻结集）。 */
  expandedGateSet?: GateSet;
  /** 按级别的关闭要求：T1 不要求 test-plan 版本递增。 */
  closeRequiresPlanVersionBump: boolean;
}

export function planChange(model: StateMachine, input: ChangePlanInput): GuardResult & { plan?: ChangePlanOutput } {
  const base = validateChangeImpactInput(input);
  if (!base.ok) return base;
  const matrix = model.gateMatrix;
  const tier = classifyChangeTier(input.scopes);
  const impact = deriveChangeImpact(input);
  const current = input.du.gateSet;
  const expanded = matrix && current ? ratchetGateSet(current, matrix, input.scopes) : undefined;
  const changed = expanded !== undefined && (expanded.mrReview !== current!.mrReview || expanded.skipStates.join() !== current!.skipStates.join() || expanded.regression !== current!.regression);
  return {
    ok: true, missing: [], reasons: [],
    plan: { tier, impact, ...(changed && expanded ? { expandedGateSet: expanded } : {}), closeRequiresPlanVersionBump: TIER_RANK[tier] >= 3 },
  };
}
```

- [ ] **Step 2: change-impact.ts 轻量关闭**

`validateChangeClose` 增加可选 `tier?: ChangeTier` 输入（`ChangeCloseInput` 加字段）：tier 为 T1/T2 时跳过「测试计划版本严格递增」检查（源码中定位 `previousPlanVersion` 比较段，用 `if (input.tier && RANK[input.tier] < 3) 跳过` 方式包裹——具体行以当前源码为准，比较逻辑集中在 validateChangeClose 内）。未传 tier 时行为不变（向后兼容）。

- [ ] **Step 3: cli.ts 加 `change` case**

```typescript
    case 'change': {
      const input = JSON.parse(readStdin()) as ChangePlanInput;
      const result = planChange(model, input);
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
      break;
    }
```

顶部 `import { planChange } from './change.js';`，default 帮助串补 `| change`。

- [ ] **Step 4: 验证测试 change.test.ts**

```typescript
import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { planChange, classifyChangeTier } from './change.js';
import { initDu } from './du.js';
import { deriveGateSet, freezeGateSet } from './gate-set.js';

const T = '2026-09-01T00:00:00Z';
const model = loadModel();

describe('classifyChangeTier', () => {
  it('takes the highest tier among scopes', () => {
    expect(classifyChangeTier(['frontend-copy', 'api-contract'])).toBe('T3');
    expect(classifyChangeTier(['data-model'])).toBe('T4');
    expect(classifyChangeTier(['frontend-copy'])).toBe('T1');
  });
});

describe('planChange', () => {
  it('ratchets GateSet when scopes exceed frozen set', () => {
    const du = { ...initDu({ iid: 88, type: 'story', now: T }), gateSet: freezeGateSet(deriveGateSet(model.gateMatrix!, ['frontend-copy']), T) };
    const out = planChange(model, { iid: 88, type: 'story', currentNode: '开发中', changeId: 'C-1', proposer: '@dev', changeDate: T, source: 'implementation', reason: '接口字段变更', scopes: ['api-contract'], du });
    expect(out.ok).toBe(true);
    expect(out.plan!.tier).toBe('T3');
    expect(out.plan!.expandedGateSet?.mrReview).toBe(true);
    expect(out.plan!.closeRequiresPlanVersionBump).toBe(true);
  });
  it('T1 copy change does not require plan version bump', () => {
    const du = { ...initDu({ iid: 88, type: 'story', now: T }), gateSet: freezeGateSet(deriveGateSet(model.gateMatrix!, ['frontend-copy']), T) };
    const out = planChange(model, { iid: 88, type: 'story', currentNode: '开发中', changeId: 'C-2', proposer: '@dev', changeDate: T, source: 'implementation', reason: '文案调整', scopes: ['frontend-copy'], du });
    expect(out.plan!.closeRequiresPlanVersionBump).toBe(false);
  });
});
```

Run: `pnpm vitest run engine/src/change.test.ts` → 4 passed；`pnpm test`（既有 change-impact.test.ts 全绿，未传 tier 的行为不变）

- [ ] **Step 5: Commit**

```bash
git add engine/src/change.ts engine/src/change.test.ts engine/src/change-impact.ts engine/src/cli.ts engine/src/types.ts
git commit -m "feat(change): 变化分级 T1-T4 + GateSet 棘轮扩容 + 轻量关闭"
```

### Task 5.2: reconcile 对账命令

**Files:**
- Create: `engine/src/reconcile.ts`
- Test: `engine/src/reconcile.test.ts`
- Modify: `engine/src/cli.ts`

- [ ] **Step 1: 实现 reconcile.ts**

```typescript
// engine/src/reconcile.ts
import type { IssueType, DuState } from './types.js';
import { currentNode } from './model.js';
import { STATUS_PREFIX, TERMINAL } from './constants.js';

export interface ReconcileInput {
  type: IssueType;
  labels: string[];
  state: 'opened' | 'closed';
  du: DuState;
}

export type ReconcileVerdict =
  | { kind: 'in-sync' }
  | { kind: 'label-ahead'; labelNode: string; duNode: string; resolution: string }
  | { kind: 'du-ahead'; duNode: string; labelNode: string; resolution: string }
  | { kind: 'external-close'; resolution: string };

/** 对账（spec §3.5）：labels 与 DU 推导节点不一致 = 投影漂移，给出二选一处理。 */
export function reconcileLabels(model: Parameters<typeof currentNode>[0], input: ReconcileInput): ReconcileVerdict {
  const prefix = STATUS_PREFIX[input.type];
  const status = input.labels.filter((l) => l.startsWith(prefix));
  if (status.length !== 1) return { kind: 'external-close', resolution: '状态标签缺失/冲突：人工修标签后重跑' };
  const labelNode = currentNode(model, input.type, input.labels) as string;
  const duNode = input.du.cachedNode ?? '';
  if (input.state === 'closed' && !TERMINAL.has(labelNode)) return { kind: 'external-close', resolution: 'Issue 被人工关闭：确认验收事实后补终态评论，或 reopen' };
  if (!duNode || labelNode === duNode) return { kind: 'in-sync' };
  const labelAhead = modelIndex(model, input.type, labelNode) > modelIndex(model, input.type, duNode);
  if (labelAhead) return { kind: 'label-ahead', labelNode, duNode, resolution: '将 DU 对齐到标签（接受人工推进）或回改标签（以 DU 为准）——一次 L2 确认' };
  return { kind: 'du-ahead', duNode, labelNode, resolution: '补发流转评论并写回标签' };
}

function modelIndex(model: Parameters<typeof currentNode>[0], type: IssueType, node: string): number {
  return model[type].states.indexOf(node);
}
```

（`DuState.cachedNode` 已在 P2 定义——Leader 每次流转成功后写回；initDu 初始 `''`。）

- [ ] **Step 2: cli.ts 加 `reconcile` case**

```typescript
    case 'reconcile': {
      const input = JSON.parse(readStdin()) as ReconcileInput;
      console.log(JSON.stringify(reconcileLabels(model, input)));
      break;
    }
```

顶部 `import { reconcileLabels } from './reconcile.js';`，default 帮助串补 `| reconcile`。

- [ ] **Step 3: 验证测试 reconcile.test.ts**

```typescript
import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { reconcileLabels } from './reconcile.js';
import { initDu } from './du.js';

const model = loadModel();
const T = '2026-09-01T00:00:00Z';

describe('reconcileLabels', () => {
  it('in-sync when DU has no cached node yet (legacy bootstrap)', () => {
    expect(reconcileLabels(model, { type: 'story', labels: ['type::story', 'story-status::开发中'], state: 'opened', du: initDu({ iid: 88, type: 'story', now: T }) }).kind).toBe('in-sync');
  });
  it('detects label-ahead drift when human advanced label', () => {
    const du = { ...initDu({ iid: 88, type: 'story', now: T }), cachedNode: '已评审' };
    expect(reconcileLabels(model, { type: 'story', labels: ['type::story', 'story-status::开发中'], state: 'opened', du }).kind).toBe('label-ahead');
  });
  it('detects du-ahead drift', () => {
    const du = { ...initDu({ iid: 88, type: 'story', now: T }), cachedNode: '测试中' };
    expect(reconcileLabels(model, { type: 'story', labels: ['type::story', 'story-status::开发中'], state: 'opened', du }).kind).toBe('du-ahead');
  });
  it('external close flags non-terminal closed issue', () => {
    const du = { ...initDu({ iid: 88, type: 'story', now: T }), cachedNode: '待发布' };
    expect(reconcileLabels(model, { type: 'story', labels: ['type::story', 'story-status::待发布'], state: 'closed', du }).kind).toBe('external-close');
  });
});
```

Run: `pnpm vitest run engine/src/reconcile.test.ts` → 4 passed；`pnpm test && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add engine/src/reconcile.ts engine/src/reconcile.test.ts engine/src/cli.ts engine/src/types.ts engine/src/du.ts
git commit -m "feat(reconcile): 外部事实对账——投影漂移二选一 + 提前关闭识别"
```

---

# 阶段 6：指标

### Task 6.1: metrics 模块

**Files:**
- Create: `engine/src/metrics.ts`
- Test: `engine/src/metrics.test.ts`
- Modify: `engine/src/types.ts`（DuMetricEvent 完整定义，替换最简形态）、`engine/src/cli.ts`

- [ ] **Step 1: types.ts 定义**

```typescript
/** DU 指标事件（指标事件）：Leader 记事件，引擎终态算汇总。 */
export interface DuMetricEvent {
  at: string;
  kind: 'confirm' | 'transition' | 'rerun' | 'env-block' | 'rework' | 'manual-intervention';
  detail?: string;
}
```

- [ ] **Step 2: 实现 metrics.ts**

```typescript
// engine/src/metrics.ts
import type { DuState, DuMetricEvent } from './types.js';

export interface DeliveryMetrics {
  confirmations: number;
  transitions: number;
  reruns: number;
  envBlocks: number;
  reworks: number;
  manualInterventions: number;
  /** 从首个 transition 到最后 transition 的时长（ms）；<2 个事件时 undefined。 */
  cycleMs?: number;
}

export function recordMetric(du: DuState, event: DuMetricEvent): DuState {
  return { ...du, metricEvents: [...du.metricEvents, event], updatedAt: event.at };
}

export function summarizeMetrics(du: DuState): DeliveryMetrics {
  const count = (kind: DuMetricEvent['kind']) => du.metricEvents.filter((e) => e.kind === kind).length;
  const stamps = du.metricEvents.filter((e) => e.kind === 'transition').map((e) => Date.parse(e.at)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  return {
    confirmations: count('confirm'),
    transitions: count('transition'),
    reruns: count('rerun'),
    envBlocks: count('env-block'),
    reworks: count('rework'),
    manualInterventions: count('manual-intervention'),
    ...(stamps.length >= 2 ? { cycleMs: stamps[stamps.length - 1] - stamps[0] } : {}),
  };
}
```

- [ ] **Step 3: cli.ts 加 `metrics` case**

```typescript
    case 'metrics': {
      const input = JSON.parse(readStdin()) as { du: DuState };
      const { summarizeMetrics, recordMetric } = await import('./metrics.js');
      console.log(JSON.stringify(input.du.metricEvents === undefined ? { error: 'du required' } : summarizeMetrics(input.du)));
      break;
    }
```

（同样改为顶部静态 import 风格：`import { summarizeMetrics } from './metrics.js';`，case 里直接 `summarizeMetrics(input.du)`。default 帮助串补 `| metrics`。）

- [ ] **Step 4: 验证测试 metrics.test.ts**

```typescript
import { describe, expect, it } from 'vitest';
import { initDu } from './du.js';
import { recordMetric, summarizeMetrics } from './metrics.js';

const T0 = '2026-09-01T00:00:00Z';
const T1 = '2026-09-05T00:00:00Z';

describe('metrics', () => {
  it('counts event kinds and computes cycle from transition stamps', () => {
    let du = initDu({ iid: 88, type: 'story', now: T0 });
    du = recordMetric(du, { at: T0, kind: 'transition' });
    du = recordMetric(du, { at: T0, kind: 'confirm' });
    du = recordMetric(du, { at: T0, kind: 'confirm' });
    du = recordMetric(du, { at: T0, kind: 'rerun' });
    du = recordMetric(du, { at: T1, kind: 'transition' });
    const m = summarizeMetrics(du);
    expect(m.transitions).toBe(2);
    expect(m.confirmations).toBe(2);
    expect(m.reruns).toBe(1);
    expect(m.cycleMs).toBe(4 * 24 * 3600 * 1000);
  });
  it('omits cycleMs with fewer than two transitions', () => {
    const du = recordMetric(initDu({ iid: 88, type: 'story', now: T0 }), { at: T0, kind: 'transition' });
    expect(summarizeMetrics(du).cycleMs).toBeUndefined();
  });
});
```

Run: `pnpm vitest run engine/src/metrics.test.ts` → 2 passed；`pnpm test && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add engine/src/metrics.ts engine/src/metrics.test.ts engine/src/types.ts engine/src/cli.ts
git commit -m "feat(metrics): 交付指标汇总——确认/周期/重测/返工"
```

---

# 收尾：skill 文档与 Leader 编排对齐

### Task 7.1: skills/glab-flow 文档更新

**Files:**
- Modify: `skills/glab-flow/SKILL.md`、`gate.md`、`nodes.md`、`guards.md`、`resume.md`

- [ ] **Step 1: SKILL.md 命令表与编排更新**

命令表加四行（next / reconcile / change / resource / metrics 的作用一句话），并在「Leader 每轮编排」章节头部插入 DU 生命周期说明：

```markdown
### 交付工作包（DU）

每个 flow 启动时用 `state-init` 同步初始化 DU（`pnpm cli` 目前由 Leader 手动落盘
`.glab-flow/<iid>/du.json`，模式与 state 文件一致）。此后：

- 执行明细（TestRun/AssetAudit）优先记入 DU，不再要求发 Issue 评论；Issue 只保留状态流转评论。
- `已评审→开发中` 时把技术方案声明的受影响维度传入 `transition`（`declaredScopes`），
  引擎返回 `proposedGateSet`——与计划提测/上线日期**同一次批量确认**。
- 随时 `pnpm cli next` 看「在哪/阻塞/最快下一步/谁欠什么」。
- 人工改了标签/手动部署后，`pnpm cli reconcile` 对账二选一，不推倒重来。
- 终态后 `pnpm cli resource --op cleanup` 出清理清单，逐项处置。
```

`shouldConfirm` 判定描述更新为动作分层（L1 自动 / L2 批量 / L3 硬门；run_mode 仅审计记录）。

- [ ] **Step 2: gate.md 更新**

「run 模式（表）」一节替换为「动作分层（表）」：三行 L1/L2/L3 定义 + 「Jenkins 参数确认并入同一次 L2 批量对话（不再逐参数单独问）」+ hard_gate 红线保留表述。

- [ ] **Step 3: guards.md / nodes.md / resume.md**

- guards.md：G14 标注「仅在 GateSet.mrReview=true 时生效」；G11 标注「仅进入过测试环境的路线」；新增 P2 双源证据（DU 优先、评论兜底）说明。
- nodes.md：「节点内容评论」表保持；「多环境 Apifox 证据链」一节补「证据优先记 DU，Issue 评论仅在流转时携带摘要」。
- resume.md：脏状态一节改为指向 `reconcile`（对账二选一），保留原人工修复路径为兜底。

- [ ] **Step 4: README 与 flow.md**

`docs/flow.md` 的「Leader 每轮编排（8 步）」图更新：插入 DU 读取步骤与 `next` 视图；七层架构图的「④ 护栏」标注 G14/G11 按 GateSet 生效。

- [ ] **Step 5: 全量回归 + 手工冒烟**

Run: `pnpm test && pnpm typecheck && pnpm build`

手工冒烟（在仓库内直接跑，不需要真实 GitLab）：

```bash
echo '{"type":"story","iid":88,"labels":["type::story","story-status::已评审"],"state":"opened","notes":[],"body":"|角色|用户|\n|--|--|\n|研发|@dev|\n|测试|@qa|\n|产品|@pm|","fields":{"技术方案评审通过记录或免评审结论":"免评审","实际开始日期":"2026-09-01","研发Assignee":"@dev","计划提测时间":"2026-09-05","计划上线时间":"2026-09-10"},"declaredScopes":["frontend-copy"],"datesConfirmed":true}' | pnpm cli transition | python3 -c 'import json,sys; o=json.load(sys.stdin); print(o["next"], o["actionTier"], bool(o.get("proposedGateSet")))'
```

Expected: `开发中 L2 True`（proposedGateSet 存在，skipStates 含 测试中）

```bash
echo '{"type":"story","labels":["type::story","story-status::开发中"],"state":"opened","du":{"iid":88,"type":"story","affectedScopes":["frontend-copy"],"evidence":[],"resources":[],"metricEvents":[],"updatedAt":"T","cachedNode":"已评审"}}' | pnpm cli reconcile
```

Expected: `{"kind":"du-ahead",...}`

- [ ] **Step 6: Commit**

```bash
git add skills/glab-flow docs/flow.md README.md
git commit -m "docs: glab-flow 文档对齐 DU 核心模型（动作分层/GateSet/对账/清理）"
```

---

## 验收对照（spec 目标 → 落点）

| spec 目标 | 落点 |
|---|---|
| 降人工介入（≤7 次） | P1 action-policy；P2 next |
| 变化分级闭环 | P5 change（T1-T4 + 棘轮 + 轻量关闭） |
| 环境资源一等模型 | P4 resource（登记/校验/清理清单） |
| 最短路径视图 | P2 next-step |
| Issue 评论只在流转时发 | P2 guard 双源证据（DU 优先） |
| 路线从维度推导 + 棘轮 | P3 gate-set + transition 跳状态投影 |
| 外部事实对账 | P5 reconcile |
| 存量 Issue 回读推导不迁移 | P2 兜底（DU 缺失时读 Issue 评论）+ P5 reconcile in-sync bootstrap |
| 指标 | P6 metrics |
| 铁律保留（纯计算/preview-confirm/G7G8/G13/hard_gate） | 全程未触碰：新模块全部纯函数；WritePlan 白名单不变；G3 在 action-policy L3 中恒生效 |

## 回滚策略

每阶段独立 commit，可按阶段 revert。P2 的双源证据设计保证回滚后（DU 缺失）Issue 评论路径仍完整可用。

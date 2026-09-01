# glab-flow 流程图

> GitLab / GitHub 直接渲染下面的 Mermaid；本地用支持 Mermaid 的 MD 阅读器查看。

## 1. 状态机全流（story + bug + 退回路径）

```mermaid
flowchart TD
    T["triage::pending<br/>分诊(intake)"] -->|"团队确认=需求"| S1
    T -->|"团队确认=生产缺陷"| B1
    T --> 重复或无需处理["关闭"]

    subgraph Story["需求流  type::story + story-status::*"]
      direction LR
      S1["草稿中"] -->|"草稿门槛"| S2["待评审"]
      S2 -->|"门禁:需求评审 通过"| S3["已评审"]
      S2 -.->|"需求评审 退回(带问题清单)"| S1
      S3 -->|"门禁:技术方案评审(只记录)<br/>+实际开始+计划提测/上线"| S4["开发中"]
      S4 -.->|"需求/方案/实现发现变更<br/>影响单→同步→必要回退/重测→闭环"| S4
      S4 -->|"门禁:代码评审 + local 资产审计 + TestRun"| S5["测试中"]
      S5 -->|"门禁:test 资产审计 + TestRun + 阻塞问题全验证"| S6["待发布"]
      S5 -.->|"整体返工"| S4
      S5 -.->|"变更影响单要求返工"| S4
      S6 -->|"门禁:发布 (hard)"| S7["生产验收中"]
      S7 -->|"门禁:产品验收 (hard·终态)"| S8["已完成 ✅关闭Issue"]
      S7 -.->|"验收不通过"| S4
    end

    subgraph Bug["Bug流  type::bug + status::*"]
      direction LR
      B1["已确认缺陷"] --> B2["开发中"]
      B2 -->|"代码评审 + local 资产审计 + TestRun"| B3["测试中"]
      B3 -->|"test 资产审计 + TestRun"| B4["待发布"]
      B4 -->|"发布 (hard)"| B5["生产验证中"]
      B5 -->|"生产验证 (hard·终态)"| B6["已完成 ✅关闭Issue"]
    end

    classDef hard fill:#fde2e4,stroke:#c9184a,stroke-width:2px;
    class S6,S7,B4,B5 hard;
    classDef done fill:#d8f3dc,stroke:#2d6a4f;
    class S8,B6 done;
```

- 实线 = 正向流转；虚线 = 退回路径。
- `(hard)` = hard_gate，恒 L3 动作分层，引擎永不自动写，必须人工证据 + humanConfirmed。
- GateSet `skipStates` 命中的节点被跳状态投影（如 frontend-copy 直推待发布）；校验仍按原转换 fail-closed。
- 技术方案评审不通过 **不退回**（停在「已评审」继续完善方案）。
- 测试单问题 **不退回**（挂父需求评论）；仅整体返工才回「开发中」。
- 终态（已完成）= 标签替换 + Assignee + 评论 + 关闭 Issue **同一次操作**。
- 引擎只产出节点/校验/计划/渲染结果；GitLab 写回由 Leader 预览后用已认证的 `glab` CLI 执行。

## 2. Leader 每轮编排（8 步）

```mermaid
flowchart TD
    A["① 读状态<br/>glab issue view + cli node"] --> B{"当前节点?<br/>(labels)"}
    B -->|"0 或 ≥2 个状态标签"| REC["cli reconcile 对账<br/>5 种 verdict 给处理方向"]
    REC -->|"dirty-labels/unknown-node"| DIRTY(["人工修标签兜底"])
    REC -->|"label-ahead/du-ahead/external-close"| A
    B --> 正常 --> C["② 查契约 nodes.md<br/>(必填项/门禁/Assignee角色)"]
    C --> D{"③ 证据齐全?<br/>(执行明细记 DU)"}
    D -->|"否"| WORK["委派节点工作 agent<br/>(草稿/方案/代码/测试)<br/>事实记 DU，不推进状态"]
    WORK --> A
    D --> 是 --> PAYLOAD["委派流转 agent<br/>起草结构化 Payload"]
    PAYLOAD --> VAL["④ 护栏校验  cli validate<br/>(G14 等按 DU GateSet 生效)"]
    VAL -->|"ok:false"| ASK["停，一次性列 missing+reasons 问用户"]
    ASK --> PAYLOAD
    VAL --> ok:true --> TIER{"动作分层?<br/>(actionTier)"}
    TIER -->|"L1 无业务 gate"| APP["⑦ 自动应用  Leader 跑 glab CLI<br/>(WritePlan → glab issue update/note/close)"]
    TIER -->|"L2 业务 gate / L3 hard_gate"| PREV["⑥ 一次批量确认<br/>(confirmBatchTitle：结论+日期+GateSet+Jenkins 参数)"]
    PREV -->|"n / 编辑"| PAYLOAD
    PREV --> y确认 --> APP
    APP --> NEXT{"⑧ 下一节点?<br/>(cli next 看最短路径)"}
    NEXT --> 未到已完成 --> A
    NEXT --> 已完成 --> DONE(["终态：资源清理清单<br/>+ 交付指标 metrics"])
```

- 确认与否由**动作分层**决定：L1（gate=null）自动执行；L2（业务 gate）一次批量确认；L3（hard_gate）恒人工（G3）。`run_mode` 只作审计记录。
- `已评审→开发中` 的 `declaredScopes` → `proposedGateSet` 与计划日期同一次 L2 确认后冻结进 DU；GateSet.skipStates 命中的节点直接投影到下一节点（校验仍按原转换 fail-closed）。

## 3. 七层架构

```mermaid
flowchart TD
    L1["① 触发入口<br/>GitLab Issue URL / free-flow"] --> L2
    L2["② 规则权威<br/>harness: issue-state-machine.md + AGENTS.md<br/>派生 state-machine.yaml + 一致性校验"] --> L3
    L3["③ 状态机驱动<br/>读 labels → 查模型 → 节点/必填/门禁/Assignee角色"] --> L4
    L4["④ 护栏 / 前置校验（按 DU GateSet 生效）<br/>确定性纯函数  G1–G16 + G6b（关键路径不放 LLM）"] --> L5
    L5["⑤ 内容生成<br/>专家 agent（spec-author / git-ops / code-review / test-flow ...；实现后验证）"] --> L6
    L6["⑥ GitLab 写回层<br/>Leader 直接 glab CLI · preview-confirm · 引擎零 I/O"] --> L7
    L7["⑦ 持久化<br/>GitLab Issue = 唯一真相 · .glab-flow/&lt;issue&gt;/ = 工作产物"]
```

## 4. 护栏速查（G1–G16 + G6b）

| 门禁类 | 规则 |
|---|---|
| **流转前置** | G1 必填字段齐全 · G2 门禁二值(通过/退回) · G3 hard_gate 需 humanConfirmed · G4 三类评审分离 |
| **事实/标签** | G5 标签唯一(脏状态拒绝) · G6 Assignee 是具体 @用户 · **G6b 有交付协同表时校验角色匹配** |
| **不臆造** | G9 禁「待确认」占位 · G10 日期需 datesConfirmed |
| **写计划** | G7 不改原文 · G8 不编评论 · G12 终态原子(标签+Assignee+评论+关闭同次) · G13 不建 Jira |
| **发布门** | G11 阻塞发布问题全验证才放行(需求+Bug；仅进入过测试环境的路线) · G14 feature→master MR 评审前置(无 CRITICAL/HIGH 残留才放行；仅 DU GateSet `mrReview=true` 时必填) |
| **变更闭环** | G16 未关闭的变更影响单阻断正向流转；变化分级 T1–T4（`change` 自动定级+GateSet 棘轮扩容），T3+ 测试计划受影响时必须版本递增并按影响范围重跑相关环境 |

> 引擎权威来源：`engine/state-machine.yaml`（模型）+ `engine/src/guard.ts`（护栏）。规则与 harness 文档漂移由 `engine/src/contract.ts` 检测。

## 5. 多环境 Apifox 证据链

```text
TestPlan（逻辑环境）
  → Apifox CLI -e（目标环境）
  → Report environmentName（实际运行）
  → Apifox 列表/详情（用户可见投影）
  → AssetAudit v2（展示 + AuthProfile）
  → TestRun（状态门禁）
```

- 四层任一不一致即停止：例如 Stage 入口的页面列显示 local，或报告环境与计划入口不符。
- 场景步骤、套件成员与数据集优先复用；跨环境只有配置差异时使用场景实例或环境入口，不复制完整流程。
- 登录是可复用 AuthProfile：运行时变量注入账号密码，登录后置提取临时 token，业务接口统一引用鉴权变量；401/403 不静默重试。

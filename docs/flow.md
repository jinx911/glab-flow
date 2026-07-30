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
      S4 -->|"门禁:代码评审与自测"| S5["测试中"]
      S5 -->|"门禁:测试验收(阻塞问题全验证)"| S6["待发布"]
      S5 -.->|"整体返工"| S4
      S6 -->|"门禁:发布 (hard)"| S7["生产验收中"]
      S7 -->|"门禁:产品验收 (hard·终态)"| S8["已完成 ✅关闭Issue"]
      S7 -.->|"验收不通过"| S4
    end

    subgraph Bug["Bug流  type::bug + status::*"]
      direction LR
      B1["已确认缺陷"] --> B2["开发中"]
      B2 -->|"代码评审与自测"| B3["测试中"]
      B3 -->|"测试验收"| B4["待发布"]
      B4 -->|"发布 (hard)"| B5["生产验证中"]
      B5 -->|"生产验证 (hard·终态)"| B6["已完成 ✅关闭Issue"]
    end

    classDef hard fill:#fde2e4,stroke:#c9184a,stroke-width:2px;
    class S6,S7,B4,B5 hard;
    classDef done fill:#d8f3dc,stroke:#2d6a4f;
    class S8,B6 done;
```

- 实线 = 正向流转；虚线 = 退回路径。
- `(hard)` = hard_gate，引擎永不自动写，必须人工证据 + humanConfirmed。
- 技术方案评审不通过 **不退回**（停在「已评审」继续完善方案）。
- 测试单问题 **不退回**（挂父需求评论）；仅整体返工才回「开发中」。
- 终态（已完成）= 标签替换 + Assignee + 评论 + 关闭 Issue **同一次操作**。
- 引擎只产出节点/校验/计划/渲染结果；GitLab 写回由 Leader 预览后用已认证的 `glab` CLI 执行。

## 2. Leader 每轮编排（8 步）

```mermaid
flowchart TD
    A["① 读状态<br/>glab issue view + cli node"] --> B{"当前节点?<br/>(labels)"}
    B -->|"0 或 ≥2 个状态标签"| DIRTY(["脏状态：停，列给人工修复"])
    B --> 正常 --> C["② 查契约 nodes.md<br/>(必填项/门禁/Assignee角色)"]
    C --> D{"③ 证据齐全?"}
    D -->|"否"| WORK["委派节点工作 agent<br/>(草稿/方案/代码/测试)<br/>写评论或分支，不推进状态"]
    WORK --> A
    D --> 是 --> PAYLOAD["委派流转 agent<br/>起草结构化 Payload"]
    PAYLOAD --> VAL["④ 护栏校验  cli validate"]
    VAL -->|"ok:false"| ASK["停，一次性列 missing+reasons 问用户"]
    ASK --> PAYLOAD
    VAL --> ok:true --> PLAN["⑤ 构建写计划  cli plan"]
    PLAN --> PREV["⑥ 预览确认  WritePlan diff"]
    PREV -->|"n / 编辑"| PAYLOAD
    PREV --> y确认 --> APP["⑦ 应用  Leader 跑 glab CLI<br/>(WritePlan → glab issue update/note/close)"]
    APP --> NEXT{"⑧ 下一节点?"}
    NEXT --> 未到已完成 --> A
    NEXT --> 已完成 --> DONE(["结束"])
```

## 3. 七层架构

```mermaid
flowchart TD
    L1["① 触发入口<br/>GitLab Issue URL / free-flow"] --> L2
    L2["② 规则权威<br/>harness: issue-state-machine.md + AGENTS.md<br/>派生 state-machine.yaml + 一致性校验"] --> L3
    L3["③ 状态机驱动<br/>读 labels → 查模型 → 节点/必填/门禁/Assignee角色"] --> L4
    L4["④ 护栏 / 前置校验<br/>确定性纯函数  G1–G13 + G6b（关键路径不放 LLM）"] --> L5
    L5["⑤ 内容生成<br/>专家 agent（复用 spec-author / git-ops / code-review / tdd-guide ...）"] --> L6
    L6["⑥ GitLab 写回层<br/>Leader 直接 glab CLI · preview-confirm · 引擎零 I/O"] --> L7
    L7["⑦ 持久化<br/>GitLab Issue = 唯一真相 · .glab-flow/&lt;issue&gt;/ = 工作产物"]
```

## 4. 护栏速查（G1–G13 + G6b）

| 门禁类 | 规则 |
|---|---|
| **流转前置** | G1 必填字段齐全 · G2 门禁二值(通过/退回) · G3 hard_gate 需 humanConfirmed · G4 三类评审分离 |
| **事实/标签** | G5 标签唯一(脏状态拒绝) · G6 Assignee 是具体 @用户 · **G6b 有交付协同表时校验角色匹配** |
| **不臆造** | G9 禁「待确认」占位 · G10 日期需 datesConfirmed |
| **写计划** | G7 不改原文 · G8 不编评论 · G12 终态原子(标签+Assignee+评论+关闭同次) · G13 不建 Jira |
| **发布门** | G11 阻塞发布问题全验证才放行(需求+Bug) |

> 引擎权威来源：`engine/state-machine.yaml`（模型）+ `engine/src/guard.ts`（护栏）。规则与 harness 文档漂移由 `engine/src/contract.ts` 检测。

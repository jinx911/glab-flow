# 需求评审输入取证 Implementation Plan

> 按用户要求实施优先，随后做定向模拟、全量测试、类型检查和构建；不采用 TDD。

**Goal:** 将 Issue 图片、前端页面地址和需求 grilling 变为可验证的评审通过条件。

**Architecture:** `review-evidence.ts` 只解析 Issue 图像引用和校验证据；`guard.ts` 在需求评审转换时调用它；Leader 负责 OCR、代码探索和一次性澄清问题。

### Task 1: 定义证据契约

- [ ] 在 `engine/src/types.ts` 增加图片 OCR、前端路由和 grilling 决策类型。
- [ ] 在 `engine/src/review-evidence.ts` 解析 Markdown/HTML 图片并校验逐图取证、路由证据和五类 grilling 覆盖。

### Task 2: 接入门禁与回执

- [ ] 在 `engine/src/guard.ts` 的 Story 需求评审路径执行 G15。
- [ ] 在 `engine/src/transition.ts` 输出缺口提示，在 `engine/src/render.ts` 写入不泄露 OCR 原文的回执。

### Task 3: 执行协议与验证

- [ ] 更新 review-preview、spec-author 与流程文档，规定原图 OCR、代码路线探索和统一问题清单。
- [ ] 用图片缺失、OCR 不可读、多路由、未决 grilling 和完整证据回放验证，再执行全量测试、类型检查和构建。

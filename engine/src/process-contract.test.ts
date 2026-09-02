import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import { loadModel } from './model.js';
import { SCOPE_RANK } from './gate-set.js';
import { TIER_BY_SCOPE } from './tier.js';
import type { ChangeScope } from './types.js';

const ALL_SCOPES: ChangeScope[] = ['frontend-copy', 'functional', 'api-contract', 'data-model', 'permission', 'frontend-route', 'schedule', 'release'];

const PROJECT_ROOT = process.cwd();
const ENGINE_SRC = 'engine/src';

const REUSABLE_DOCS = [
  'README.md',
  'docs/flow.md',
  'docs/architecture.md',
  'docs/specs/2026-07-28-glab-flow-design.md',
  'docs/specs/2026-07-29-glab-flow-isolation-design.md',
  'docs/plans/2026-07-28-glab-flow.md',
  'docs/plans/2026-07-29-glab-flow-isolation-infra.md',
  'skills/glab-flow/SKILL.md',
  'skills/glab-flow/gate.md',
  'skills/glab-flow/guards.md',
  'skills/glab-flow/nodes.md',
  'skills/glab-flow/resume.md',
  'skills/glab-flow/tools.md',
  'skills/glab-flow/learn.md',
  'skills/glab-flow/sub-skills/spec-author.md',
  'skills/glab-flow/sub-skills/test-design.md',
  'skills/glab-flow/sub-skills/test-flow-apifox.md',
  'skills/glab-flow/sub-skills/test-flow-e2e.md',
  'skills/glab-flow/sub-skills/code-review.md',
  'skills/glab-flow/sub-skills/mr-review.md',
  'skills/glab-flow/sub-skills/jenkins-deploy.md',
  'agents/review-preview.md',
  'agents/release-check.md',
];

const FORBIDDEN_ENGINE_TERMS = [
  'child_process',
  'fetch(',
  'node:http',
  'node:https',
  'applyWritePlan',
  'issue update',
  'issue note',
  'glab issue',
  'glab api',
  'writeFileSync',
  'mkdirSync',
  'rmSync',
];

const STALE_WRITEBACK_PATTERNS = [
  /cli apply/,
  /pnpm cli apply/,
  /applyWritePlan/,
  /resolve-assignee/,
  /validateWritePlan\s*→\s*GitLab API/,
  /GitLab API\)/,
  /GLAB_FLOW_TOKEN（GitLab token/,
  /export GLAB_FLOW_TOKEN=/,
  /封装 token\/重试/,
  /token\/重试/,
];

function readProjectFile(filePath: string): string {
  // Git checkout 可能使用 CRLF；文档契约只关心内容而非换行格式。
  return readFileSync(join(PROJECT_ROOT, filePath), 'utf8').replace(/\r\n/g, '\n');
}

function listFiles(dirPath: string): string[] {
  const absoluteDir = join(PROJECT_ROOT, dirPath);

  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(absoluteDir, entry.name);
    // 流程契约中的路径约定统一为 POSIX 形式，避免路径分隔符导致豁免名单和断言失效。
    const relativePath = relative(PROJECT_ROOT, absolutePath).replace(/\\\\/g, '/');

    if (entry.isDirectory()) {
      return listFiles(relativePath);
    }

    return statSync(absolutePath).isFile() ? [relativePath] : [];
  });
}

function assertNoPattern(text: string, patterns: RegExp[]): void {
  const matchedPatterns = patterns.filter((pattern) => pattern.test(text));

  expect(matchedPatterns.map(String)).toEqual([]);
}

describe('glab-flow process contracts', () => {
  it('state machine carries the gate matrix (P3 维度→门禁推导)', () => {
    const matrix = loadModel().gateMatrix;
    expect(matrix?.rules?.length).toBeGreaterThan(0);
    // defaults 必须齐备：deriveGateSet 未命中规则时以其为基准
    expect(matrix?.defaults).toMatchObject({ mrReview: true, regression: 'full', rollbackPlan: false });
    expect(matrix?.defaults.environments.length).toBeGreaterThan(0);
    // frontend-copy 规则必须可跳过测试中并免 MR 评审（轻量需求直达待发布）
    const frontendCopy = matrix?.rules.find((rule) => rule.scopes.includes('frontend-copy'));
    expect(frontendCopy).toMatchObject({ mrReview: false, regression: 'affected-cases' });
    expect(frontendCopy?.skipStates).toContain('测试中');
    // 高危维度必须全量回归 + 回滚方案
    const dataModel = matrix?.rules.find((rule) => rule.scopes.includes('data-model'));
    expect(dataModel).toMatchObject({ mrReview: true, regression: 'full', rollbackPlan: true });
  });

  it('keeps gate-matrix scopes aligned with the ChangeScope union and SCOPE_RANK (I5)', () => {
    const matrix = loadModel().gateMatrix;
    expect(matrix).toBeDefined();
    const ruleScopes = matrix!.rules.flatMap((rule) => rule.scopes);
    // 1) rules 中每个 scope 都是合法 ChangeScope（yaml 手写不漂移）
    expect(ruleScopes.every((scope) => ALL_SCOPES.includes(scope as ChangeScope))).toBe(true);
    // 2) SCOPE_RANK 编译期穷尽 ChangeScope；运行时同样核对无遗漏/无多余
    expect(Object.keys(SCOPE_RANK).sort()).toEqual([...ALL_SCOPES].sort());
    // 3) 同一 scope 不得出现在两条 rule（否则最高档命中哪条取决于 rules 顺序，破坏确定性）
    const duplicated = ruleScopes.filter((scope, index) => ruleScopes.indexOf(scope) !== index);
    expect(duplicated).toEqual([]);
  });

  it('keeps TIER_BY_SCOPE exhaustive over the ChangeScope union (P5 定级)', () => {
    // 编译期 Record<ChangeScope, ChangeTier> 已强制穷尽；运行时同样核对无遗漏/无多余。
    expect(Object.keys(TIER_BY_SCOPE).sort()).toEqual([...ALL_SCOPES].sort());
    // 每个维度都必须落在合法档位（yaml/手写漂移防呆）。
    expect(Object.values(TIER_BY_SCOPE).every((tier) => ['T1', 'T2', 'T3', 'T4'].includes(tier))).toBe(true);
  });

  it('keeps the engine free of GitLab writeback and shell/network side effects', () => {
    // issue 22 豁免:version.ts 用 execFileSync 只读本地 git ref(零网络/零写入),
    // 用于运行时版本守卫——检测本地副本是否落后 origin/master,防静默漂移(issue 22)。
    const exempt = new Set(['engine/src/version.ts']);
    const productionFiles = listFiles(ENGINE_SRC)
      .filter((filePath) => filePath.endsWith('.ts'))
      .filter((filePath) => !filePath.endsWith('.test.ts'))
      .filter((filePath) => !exempt.has(filePath));

    const filesWithForbiddenTerms = productionFiles
      .map((filePath) => ({ filePath, content: readProjectFile(filePath) }))
      .filter(({ content }) => FORBIDDEN_ENGINE_TERMS.some((term) => content.includes(term)))
      .map(({ filePath }) => filePath);

    expect(filesWithForbiddenTerms).toEqual([]);
    // 豁免文件本身必须无网络/写副作用——只允许 child_process(只读 git)。
    const versionSrc = readProjectFile('engine/src/version.ts');
    expect(versionSrc).not.toMatch(/fetch\(|node:http|node:https|writeFileSync|mkdirSync|rmSync/);
  });

  it('documents Leader-owned glab writeback and forbids stale engine apply wording', () => {
    const combinedDocs = REUSABLE_DOCS.map(readProjectFile).join('\n');

    expect(combinedDocs).toMatch(/Leader[\s\S]{0,80}glab|glab[\s\S]{0,80}Leader/);
    expect(combinedDocs).toMatch(/纯计算|pure-computation|deterministic/);
    assertNoPattern(combinedDocs, STALE_WRITEBACK_PATTERNS);
  });

  it('documents merged comment model (状态变更头 + 内容体) replacing local-path receipt', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');
    const gate = readProjectFile('skills/glab-flow/gate.md');
    const nodes = readProjectFile('skills/glab-flow/nodes.md');
    for (const doc of [skill, gate, nodes]) {
      expect(doc).toMatch(/合并评论|内容评论/);
    }
    // 内容体标题(每节点产出作为 Issue 评论)
    expect(nodes).toMatch(/技术方案/);
    expect(nodes).toMatch(/提测说明/);
    expect(nodes).toMatch(/测试报告/);
    expect(nodes).toMatch(/上线操作手册/);
    // receipt marker 不再作为产物证明模板
    expect(nodes).not.toMatch(/唯一可执行的回执模板/);
  });

  it('documents three-stage writeback (metadata/state-comment/readback) + resume recovery', () => {
    const gate = readProjectFile('skills/glab-flow/gate.md');
    const resume = readProjectFile('skills/glab-flow/resume.md');
    for (const doc of [gate, resume]) {
      expect(doc).toMatch(/metadata/);
      expect(doc).toMatch(/state-comment/);
      expect(doc).toMatch(/readback/);
    }
    expect(resume).toMatch(/writebackAudit/);
    expect(resume).toMatch(/首个未完成|第一个未完成/);
  });

  it('keeps reusable docs free of artifact-receipt marker as content source', () => {
    const nodes = readProjectFile('skills/glab-flow/nodes.md');
    expect(nodes).not.toMatch(/<!-- glab-flow:artifact-receipt:v1/);
  });

  it('documents the canonical Week Plan protocol and Leader initial sync / Harness rollover boundary', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');
    const nodes = readProjectFile('skills/glab-flow/nodes.md');
    const gate = readProjectFile('skills/glab-flow/gate.md');
    const resume = readProjectFile('skills/glab-flow/resume.md');
    const canonicalWeekPlan = [
      '## 周排期',
      '',
      '- 计划开始：2026-08-17',
      '- 计划完成：2026-09-06',
      '- 计划覆盖周：W34 ～ W36',
      '- 自动 rollover：启用',
    ].join('\n');

    expect(skill).toContain(canonicalWeekPlan);
    expect(nodes).toMatch(/待评审[\s\S]{0,80}已评审[\s\S]{0,160}周排期/);
    expect(nodes).toMatch(/已评审[\s\S]{0,80}开发中[\s\S]{0,160}(最新|latest).*周排期/);
    expect(gate).toMatch(/week-plan-change[\s\S]{0,160}(仅评论|comment-only)/i);
    expect(gate).toMatch(/最新[\s\S]{0,80}(无效|invalid)[\s\S]{0,120}(停止|停)/);
    expect(resume).toMatch(/最新[\s\S]{0,80}周排期[\s\S]{0,120}(无效|invalid)/);
    expect(resume).toMatch(/不得[\s\S]{0,80}(回退|fallback)[\s\S]{0,80}(旧|更早)/);
    const docs = [skill, nodes, gate, resume].join('\n');
    expect(docs).toMatch(/初始挂载/);
    expect(docs).toMatch(/postWriteback/);
    expect(docs).toMatch(/周一[\s\S]{0,120}rollover/i);
    expect(docs).toMatch(/Week YYYY-Www/);
    expect(docs).toMatch(/milestone_id/);
    expect(docs).toMatch(/不回滚[\s\S]{0,120}(状态|标签|评论)/);

    const engineProduction = listFiles(ENGINE_SRC)
      .filter((filePath) => filePath.endsWith('.ts'))
      .filter((filePath) => !filePath.endsWith('.test.ts'))
      .map(readProjectFile)
      .join('\n');
    expect(engineProduction).toMatch(/sync_week_milestone/);
    expect(engineProduction).not.toMatch(/glab\s+(api|issue)|fetch\(/i);
  });

  it('documents notes for legacy CLI Week Plan validation and planning', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');

    expect(skill).toMatch(/`validate`[\s\S]{0,360}notes/);
    expect(skill).toMatch(/`plan`[\s\S]{0,360}notes/);
    expect(skill).toMatch(/已评审\s*→\s*开发中[\s\S]{0,240}(最新|latest).*周排期/);
  });

  it('requires one versioned plan and separately evidenced local/test TestRuns', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');
    const nodes = readProjectFile('skills/glab-flow/nodes.md');
    const gate = readProjectFile('skills/glab-flow/gate.md');
    const testDesign = readProjectFile('skills/glab-flow/sub-skills/test-design.md');

    expect(skill).toMatch(/local[\s\S]{0,100}TestRun/);
    expect(skill).toMatch(/test[\s\S]{0,100}TestRun/);
    expect(nodes).toContain('<!-- glab-flow:test-plan:v1');
    expect(nodes).toContain('<!-- glab-flow:test-run:v1');
    expect(readProjectFile('skills/glab-flow/sub-skills/test-flow-apifox.md')).toContain('<!-- glab-flow:apifox-asset-audit:v1');
    expect(testDesign).toContain('plan-version');
    expect(testDesign).toMatch(/同一.*test-plan|同一.*计划/);
    expect(gate).toMatch(/testPlan/);
    expect(gate).toMatch(/local TestRun/);
    expect(gate).toMatch(/test TestRun/);
  });

  it('blocks forward flow until a versioned change impact has been closed', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');
    const nodes = readProjectFile('skills/glab-flow/nodes.md');
    const guards = readProjectFile('skills/glab-flow/guards.md');
    const changeImpact = readProjectFile('engine/src/change-impact.ts');
    const model = readProjectFile('engine/state-machine.yaml');

    expect(skill).toMatch(/change-impact/);
    expect(skill).toMatch(/change-close/);
    expect(nodes).toMatch(/变更影响单/);
    expect(nodes).toMatch(/测试计划变更必须递增[\s\S]{0,80}plan-version/);
    expect(guards).toMatch(/G16[\s\S]{0,160}(open|闭环)/i);
    expect(changeImpact).toMatch(/status: open/);
    expect(changeImpact).toMatch(/status: closed/);
    expect(changeImpact).toMatch(/validateChangeImpactClosure/);
    expect(model).toMatch(/开发中: \[技术方案, 测试计划, 编码实现, 本地自测, 代码评审\]/);
    expect(model).toMatch(/测试中: \[用例执行, 阻塞修复, 复测\]/);
  });

  it('requires governed Apifox assets before each environment TestRun', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');
    const design = readProjectFile('skills/glab-flow/sub-skills/test-design.md');
    const apifox = readProjectFile('skills/glab-flow/sub-skills/test-flow-apifox.md');
    const tools = readProjectFile('skills/glab-flow/tools.md');

    expect(skill).toMatch(/asset-audit/);
    expect(design).toMatch(/先检索.*复用|复用.*禁止.*复制/);
    expect(design).toMatch(/TMP-<iid>-/);
    expect(apifox).toMatch(/空壳|重复|孤儿/);
    expect(apifox).toMatch(/当前 CLI.*项目 UI|项目 UI.*当前 CLI/);
    expect(tools).toMatch(/不硬编码.*必备能力/);
  });

  it('requires OCR, route evidence and resolved grilling before requirement review approval', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');
    const nodes = readProjectFile('skills/glab-flow/nodes.md');
    const reviewPreview = readProjectFile('agents/review-preview.md');
    const specAuthor = readProjectFile('skills/glab-flow/sub-skills/spec-author.md');
    const guards = readProjectFile('skills/glab-flow/guards.md');

    expect(readProjectFile('engine/src/review-evidence.ts')).toMatch(/extractIssueImageSources/);
    expect(readProjectFile('engine/src/guard.ts')).toMatch(/validateRequirementsReviewEvidence/);
    expect(skill).toMatch(/OCR[\s\S]{0,100}页面/);
    expect(nodes).toMatch(/reviewEvidence/);
    expect(reviewPreview).toMatch(/逐张下载[\s\S]{0,100}OCR/);
    expect(reviewPreview).toMatch(/不得猜测页面地址/);
    expect(specAuthor).toMatch(/禁止猜测 URL/);
    expect(guards).toMatch(/G15/);
  });

  it('treats visible Apifox environment and reusable authentication as governed evidence', () => {
    const design = readProjectFile('skills/glab-flow/sub-skills/test-design.md');
    const apifox = readProjectFile('skills/glab-flow/sub-skills/test-flow-apifox.md');
    const flow = readProjectFile('docs/flow.md');

    expect(design).toMatch(/presentation:/);
    expect(design).toMatch(/auth-profile:/);
    expect(design).toMatch(/临时.*token|token.*临时/);
    expect(apifox).toContain('<!-- glab-flow:apifox-asset-audit:v2');
    expect(apifox).toMatch(/页面显示本地.*Stage[\s\S]{0,100}(停止|阻断)/);
    expect(apifox).toMatch(/--carry-runtime-variables/);
    expect(flow).toMatch(/四层.*环境|环境事实/);
  });

  it('keeps detailed Apifox report upload paramandatory and never silently downgraded', () => {
    const apifox = readProjectFile('skills/glab-flow/sub-skills/test-flow-apifox.md');

    // 用户裁定（2026-09-02）：--upload-report detail 随 CLI 登录态直接上传，无需单独授权预检；
    // 保留的契约是「参数不可省略/降级 + 报告必须回读」。
    expect(apifox).toMatch(/不需要单独授权/);
    expect(apifox).toMatch(/不可省略或降级/);
    expect(apifox).toMatch(/test-report get/);
    // 旧的两层授权预检表述必须移除，防止流程回退
    expect(apifox).not.toMatch(/require_escalated/);
  });

  it('prohibits test-first workflow and keeps active glab-flow docs free of retired routes', () => {
    const activeDocs = [
      'skills/glab-flow/SKILL.md',
      'skills/glab-flow/gate.md',
      'skills/glab-flow/nodes.md',
      'skills/glab-flow/tools.md',
      'skills/glab-flow/sub-skills/code-review.md',
      'skills/glab-flow/sub-skills/mr-review.md',
      'skills/glab-flow/sub-skills/test-design.md',
      'skills/glab-flow/sub-skills/test-flow-apifox.md',
      'skills/glab-flow/sub-skills/test-flow-e2e.md',
      'docs/flow.md',
    ].map(readProjectFile);

    expect(readProjectFile('skills/glab-flow/SKILL.md')).toMatch(/禁止测试先行仪式/);
    expect(activeDocs.join('\n')).not.toMatch(/test-first-guide|RED\s*→\s*GREEN\s*→\s*REFACTOR/i);
  });

  it('keeps repository documentation free of retired test-first terminology', () => {
    const documentation = ['docs', 'skills', 'agents']
      .flatMap((directory) => listFiles(directory))
      .filter((filePath) => filePath.endsWith('.md'))
      .map(readProjectFile)
      .join('\n');

    expect(documentation).not.toMatch(/t[d]d-guide|\bt[d]d\b|[R]ED\s*→\s*[G]REEN\s*→\s*REFACTOR/i);
  });

  it('requires code evidence before review-preview blocks on existing system behavior', () => {
    const reviewPreview = readProjectFile('agents/review-preview.md');
    const tools = readProjectFile('skills/glab-flow/tools.md');

    expect(reviewPreview).toMatch(/现有系统|现有实现|代码行为/);
    expect(reviewPreview).toMatch(/codegraph|代码证据|源码证据/);
    expect(reviewPreview).toMatch(/阻塞|退回/);
    expect(tools).toMatch(/review-preview/);
  });

  it('separates Jenkins parameter confirmation from broad release approval', () => {
    const jenkinsDeploy = readProjectFile('skills/glab-flow/sub-skills/jenkins-deploy.md');
    const skill = readProjectFile('skills/glab-flow/SKILL.md');

    expect(jenkinsDeploy).toMatch(/test_version/);
    expect(jenkinsDeploy).toMatch(/DEPLOY_ENV/);
    expect(jenkinsDeploy).toMatch(/粗粒度授权|笼统授权/);
    expect(jenkinsDeploy).toMatch(/不等于[\s\S]{0,20}(构建)?参数确认/);
    expect(jenkinsDeploy).toMatch(/触发前必须展示清单让用户确认/);
    expect(skill).toMatch(/Jenkins[\s\S]{0,40}部署参数/);
  });

  it('documents the learning-to-versioned-docs cleanup lifecycle', () => {
    const learn = readProjectFile('skills/glab-flow/learn.md');
    const skill = readProjectFile('skills/glab-flow/SKILL.md');

    expect(learn).toMatch(/capture/);
    expect(learn).toMatch(/upgrade/);
    expect(learn).toMatch(/可复用规则/);
    expect(learn).toMatch(/去掉 Issue ID/);
    expect(learn).toMatch(/写入测试和 docs\/skill\/agent/);
    expect(learn).toMatch(/跑验证/);
    expect(learn).toMatch(/用户确认后再删除/);
    expect(skill).toMatch(/泛化/);
    expect(skill).toMatch(/Issue ID/);
    expect(skill).toMatch(/一次性/);
  });

  it('keeps structured lesson fields optional and out of transition gates', () => {
    const learn = readProjectFile('skills/glab-flow/learn.md');

    expect(learn).toMatch(/trigger/);
    expect(learn).toMatch(/impact/);
    expect(learn).toMatch(/resolution/);
    expect(learn).toMatch(/recurrence/);
    expect(learn).toMatch(/可选/);
    expect(learn).toMatch(/旧.*记录.*有效|已有.*记录.*有效/);
    expect(learn).toMatch(/不.*门禁|不.*gate/);
  });

  it('keeps reusable docs free of issue-specific identifiers', () => {
    // Canonical receipt markers deliberately contain parser-valid synthetic values
    // (including UTC timestamps). They are templates, not run output; all text
    // outside such markers must remain free of run-specific identifiers.
    const combinedDocs = REUSABLE_DOCS
      .map(readProjectFile)
      .join('\n')
      .replace(/<!-- glab-flow:(?:artifact-receipt|test-plan|test-run|apifox-asset-audit):v[12]\r?\n[\s\S]*?-->/g, '');

    assertNoPattern(combinedDocs, [
      /issues\/\d+/,
      /merge_requests\/\d+/,
      /(^|[^A-Za-z0-9_])#\d+\b/,
      /\b(?!SHA-256\b)[A-Z][A-Z0-9]+-\d+\b/,
    ]);
  });
});

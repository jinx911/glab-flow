import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

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
  'skills/glab-flow/nodes.md',
  'skills/glab-flow/resume.md',
  'skills/glab-flow/tools.md',
  'skills/glab-flow/learn.md',
  'skills/glab-flow/sub-skills/spec-author.md',
  'skills/glab-flow/sub-skills/test-design.md',
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
  return readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
}

function listFiles(dirPath: string): string[] {
  const absoluteDir = join(PROJECT_ROOT, dirPath);

  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(absoluteDir, entry.name);
    const relativePath = relative(PROJECT_ROOT, absolutePath);

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

  it('documents the canonical Week Plan protocol while leaving Milestones to Harness', () => {
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
    expect([skill, nodes, gate, resume].join('\n')).toMatch(/Harness[\s\S]{0,80}(唯一|sole)[\s\S]{0,80}(Milestone|里程碑)/i);

    const engineProduction = listFiles(ENGINE_SRC)
      .filter((filePath) => filePath.endsWith('.ts'))
      .filter((filePath) => !filePath.endsWith('.test.ts'))
      .map(readProjectFile)
      .join('\n');
    expect(engineProduction).not.toMatch(/\bmilestone\b/i);
  });

  it('documents notes for legacy CLI Week Plan validation and planning', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');

    expect(skill).toMatch(/`validate`[\s\S]{0,280}notes[\s\S]{0,180}已评审\s*→\s*开发中/);
    expect(skill).toMatch(/`plan`[\s\S]{0,280}notes[\s\S]{0,180}已评审\s*→\s*开发中/);
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
      .replace(/<!-- glab-flow:artifact-receipt:v1\r?\n[\s\S]*?-->/g, '');

    assertNoPattern(combinedDocs, [
      /issues\/\d+/,
      /merge_requests\/\d+/,
      /(^|[^A-Za-z0-9_])#\d+\b/,
      /\b(?!SHA-256\b)[A-Z][A-Z0-9]+-\d+\b/,
    ]);
  });
});

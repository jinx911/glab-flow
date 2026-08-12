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
    const productionFiles = listFiles(ENGINE_SRC)
      .filter((filePath) => filePath.endsWith('.ts'))
      .filter((filePath) => !filePath.endsWith('.test.ts'));

    const filesWithForbiddenTerms = productionFiles
      .map((filePath) => ({ filePath, content: readProjectFile(filePath) }))
      .filter(({ content }) => FORBIDDEN_ENGINE_TERMS.some((term) => content.includes(term)))
      .map(({ filePath }) => filePath);

    expect(filesWithForbiddenTerms).toEqual([]);
  });

  it('documents Leader-owned glab writeback and forbids stale engine apply wording', () => {
    const combinedDocs = REUSABLE_DOCS.map(readProjectFile).join('\n');

    expect(combinedDocs).toMatch(/Leader[\s\S]{0,80}glab|glab[\s\S]{0,80}Leader/);
    expect(combinedDocs).toMatch(/纯计算|pure-computation|deterministic/);
    assertNoPattern(combinedDocs, STALE_WRITEBACK_PATTERNS);
  });

  it('requires Agent-independent artifact receipt writeback, readback, and recovery', () => {
    const skill = readProjectFile('skills/glab-flow/SKILL.md');
    const gate = readProjectFile('skills/glab-flow/gate.md');
    const nodes = readProjectFile('skills/glab-flow/nodes.md');
    const resume = readProjectFile('skills/glab-flow/resume.md');
    const specAuthor = readProjectFile('skills/glab-flow/sub-skills/spec-author.md');
    const testDesign = readProjectFile('skills/glab-flow/sub-skills/test-design.md');
    const mrReview = readProjectFile('skills/glab-flow/sub-skills/mr-review.md');
    const jenkinsDeploy = readProjectFile('skills/glab-flow/sub-skills/jenkins-deploy.md');
    const tools = readProjectFile('skills/glab-flow/tools.md');

    for (const doc of [skill, gate]) {
      expect(doc).toMatch(/产物回执/);
      expect(doc).toMatch(/append|新增/);
      expect(doc).toMatch(/回读/);
      expect(doc).toMatch(/解析/);
      expect(doc).toMatch(/state|缓存/);
      expect(doc).toMatch(/进度|progress/);
      expect(doc).toMatch(/标签[\s\S]{0,120}Assignee[\s\S]{0,120}状态变更评论[\s\S]{0,120}最终.*回读/);
      expect(doc).toMatch(/失败[\s\S]{0,100}停止|停止[\s\S]{0,100}失败/);
      expect(doc).toMatch(/恢复[\s\S]{0,160}回读/);
    }

    expect(skill).toMatch(/glab-flow:artifact-receipt:v1/);
    expect(nodes).toMatch(/proposal[\s\S]{0,80}父 Issue/);
    expect(nodes).toMatch(/design[\s\S]{0,80}父 Issue/);
    expect(nodes).toMatch(/test-plan[\s\S]{0,80}父 Issue/);
    expect(nodes).toMatch(/release-plan[\s\S]{0,80}父 Issue/);
    expect(nodes).toMatch(/mr-review[\s\S]{0,120}每个.*MR/);
    expect(nodes).toMatch(/不能.*父 Issue|父 Issue.*不能.*替代/);
    expect(resume).toMatch(/artifactReceipts/);
    expect(resume).toMatch(/writebackAudit/);
    expect(resume).toMatch(/第一个未完成阶段|首个未完成阶段/);
    expect(specAuthor).toMatch(/data-backed|数据型/);
    expect(specAuthor).toMatch(/代码数据流/);
    expect(specAuthor).toMatch(/只读.*生产|生产.*只读/);
    expect(testDesign).toMatch(/test-plan/);
    expect(testDesign).toMatch(/产物回执/);
    expect(mrReview).toMatch(/每个.*MR/);
    expect(mrReview).toMatch(/MR.*回读|回读.*MR/);
    expect(jenkinsDeploy).toMatch(/能力发现/);
    expect(jenkinsDeploy).toMatch(/手工|manual/);
    expect(jenkinsDeploy).toMatch(/产物回执/);
    expect(tools).toMatch(/能力发现/);
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
    const combinedDocs = REUSABLE_DOCS.map(readProjectFile).join('\n');

    assertNoPattern(combinedDocs, [
      /issues\/\d+/,
      /merge_requests\/\d+/,
      /(^|[^A-Za-z0-9_])#\d+\b/,
      /\b(?!SHA-256\b)[A-Z][A-Z0-9]+-\d+\b/,
    ]);
  });
});

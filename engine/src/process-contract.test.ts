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
  'skills/glab-flow/tools.md',
  'skills/glab-flow/learn.md',
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

  it('keeps reusable docs free of issue-specific identifiers', () => {
    const combinedDocs = REUSABLE_DOCS.map(readProjectFile).join('\n');

    assertNoPattern(combinedDocs, [
      /issues\/\d+/,
      /merge_requests\/\d+/,
      /(^|[^A-Za-z0-9_])#\d+\b/,
      /\b[A-Z][A-Z0-9]+-\d+\b/,
    ]);
  });
});

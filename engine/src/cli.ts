import { readFileSync } from 'node:fs';
import { loadModel, currentNode, progressStepsFor } from './model.js';
import { validateTransition, validateWeekPlanChange } from './guard.js';
import { toFacts } from './gitlab.js';
import { renderNodeComment } from './render.js';
import { buildReturnPlan, buildForwardPlan, buildWeekPlanChangePlan } from './plan.js';
import { runTransition } from './transition.js';
import { extractEvidence } from './evidence.js';
import { parseConfig } from './config.js';
import { initState } from './state.js';
import type { InitStateInput, RunState, WritebackAuditInput } from './state.js';
import type { ApifoxAssetAudit, Payload, RunMode, TransitionInput, WeekPlanChangeInput } from './types.js';
import type { ChangeCloseInput, ChangeImpactInput } from './types.js';
import { buildChangeClosePlan, buildChangeImpactPlan, validateChangeClose, validateChangeImpactInput } from './change-impact.js';
import { evidenceRecordCommand, progressCommand, runModeSelectCommand, stateWritebackCommand } from './cli-commands.js';
import { checkRuntimeVersion } from './version.js';
import { parseTestConfig, buildTestContext } from './test-config.js';
import { parseLatestTestRun, parseTestPlan, renderTestRun, validateTestRun } from './test-run.js';
import { parseLatestApifoxAssetAudit, renderApifoxAssetAudit, validateApifoxAssetAudit } from './asset-audit.js';
import type { TestRun } from './types.js';
import { decideAutomation } from './automation.js';
import type { AutomationEvent } from './types.js';

const model = loadModel();

function readStdin(): string {
  return readFileSync(0, 'utf8');
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  switch (cmd) {
    case 'node': {
      const [type, ...labels] = args;
      const node = currentNode(model, type as 'story' | 'bug', labels);
      console.log(JSON.stringify({ node, progressSteps: progressStepsFor(model, node) }));
      break;
    }
    case 'validate': {
      const input = JSON.parse(readStdin()) as { type: 'story' | 'bug'; labels: string[]; payload: Payload; body?: string; notes?: { body: string }[]; evidence?: import('./types.js').InternalEvidenceReceipt[]; testPlan?: string };
      if (input.testPlan !== undefined) input.payload.testPlan = input.testPlan;
      const result = validateTransition(model, toFacts({ iid: 0, state: 'opened', labels: input.labels, description: input.body ?? '' }), input.payload, input.notes, input.evidence);
      console.log(JSON.stringify(result));
      break;
    }
    case 'render': {
      const payload = JSON.parse(readStdin()) as Payload;
      // `render` is a user-facing preview. Keep it on the same whitelist-only
      // renderer as the eventual Issue writeback so a copied preview cannot
      // reintroduce machine receipts into a parent Issue comment.
      console.log(renderNodeComment(payload));
      break;
    }
    case 'plan': {
      const input = JSON.parse(readStdin()) as { payload: Payload; notes?: { body: string }[]; evidence?: import('./types.js').InternalEvidenceReceipt[]; body?: string; testPlan?: string };
      const payload = input.payload;
      if (input.testPlan !== undefined) payload.testPlan = input.testPlan;
      // Development entry is the one transition that requires the Issue-scoped,
      // immutable mode selection. This legacy command has no state input, so it
      // must not be able to mint a WritePlan that bypasses transition's guard.
      if (payload.from === '已评审' && payload.to === '开发中') {
        console.log(JSON.stringify({
          error: 'plan: 已评审→开发中必须使用 transition，并传入由 run-mode-select 持久化的 runModeSelection',
        }));
        process.exitCode = 1;
        break;
      }
      const statusLabel = payload.type === 'story' ? `story-status::${payload.from}` : `status::${payload.from}`;
      const result = validateTransition(model, toFacts({
        iid: 0,
        state: 'opened',
        labels: [`type::${payload.type}`, statusLabel],
        description: input.body ?? '',
      }), payload, input.notes, input.evidence);
      if (!result.ok) {
        console.log(JSON.stringify(result));
        process.exitCode = 1;
        break;
      }
      console.log(JSON.stringify(buildForwardPlan(payload, Number(args[0] ?? 0))));
      break;
    }
    case 'transition': {
      const input = JSON.parse(readStdin()) as TransitionInput;
      console.log(JSON.stringify(runTransition(model, input)));
      break;
    }
    case 'test-run': {
      const input = JSON.parse(readStdin()) as { plan: string; run: TestRun };
      const parsed = parseTestPlan(input.plan);
      if (!parsed.ok) {
        console.log(JSON.stringify({ validate: { ok: false, missing: ['testPlan'], reasons: parsed.errors } }));
        process.exitCode = 1;
        break;
      }
      const receipt = renderTestRun(input.run);
      const validation = validateTestRun(parsed.plan, input.run.environment, parseLatestTestRun([{ body: receipt }], input.run.environment));
      console.log(JSON.stringify({ validate: { ok: validation.ok, missing: validation.ok ? [] : [`${input.run.environment}TestRun`], reasons: validation.errors }, ...(validation.ok ? { receipt } : {}) }));
      if (!validation.ok) process.exitCode = 1;
      break;
    }
    case 'asset-audit': {
      const input = JSON.parse(readStdin()) as { plan: string; audit: ApifoxAssetAudit };
      const parsed = parseTestPlan(input.plan);
      if (!parsed.ok) {
        console.log(JSON.stringify({ validate: { ok: false, missing: ['testPlan'], reasons: parsed.errors } }));
        process.exitCode = 1;
        break;
      }
      const receipt = renderApifoxAssetAudit(input.audit);
      const validation = validateApifoxAssetAudit(parsed.plan, input.audit.environment, parseLatestApifoxAssetAudit([{ body: receipt }], input.audit.environment));
      console.log(JSON.stringify({ validate: { ok: validation.ok, missing: validation.ok ? [] : [`${input.audit.environment}AssetAudit`], reasons: validation.errors }, ...(validation.ok ? { receipt } : {}) }));
      if (!validation.ok) process.exitCode = 1;
      break;
    }
    case 'evidence': {
      const comments = JSON.parse(readStdin()) as { body: string }[];
      console.log(JSON.stringify(extractEvidence(comments)));
      break;
    }
    case 'plan-return': {
      const input = JSON.parse(readStdin()) as { type: 'story' | 'bug'; from: string; target: string; issues: string[]; confirmer: string; date: string; assigneeUser?: string };
      console.log(JSON.stringify(buildReturnPlan({ ...input, issueIid: Number(args[0] ?? 0) })));
      break;
    }
    case 'week-plan-change': {
      const input = JSON.parse(readStdin()) as unknown;
      const validation = validateWeekPlanChange(input);
      if (!validation.ok) {
        console.log(JSON.stringify(validation));
        process.exitCode = 1;
        break;
      }
      console.log(JSON.stringify(buildWeekPlanChangePlan(input as WeekPlanChangeInput)));
      break;
    }
    case 'change-impact': {
      const input = JSON.parse(readStdin()) as unknown;
      const validation = validateChangeImpactInput(input);
      if (!validation.ok) {
        console.log(JSON.stringify(validation));
        process.exitCode = 1;
        break;
      }
      console.log(JSON.stringify(buildChangeImpactPlan(input as ChangeImpactInput)));
      break;
    }
    case 'change-close': {
      const input = JSON.parse(readStdin()) as unknown;
      const validation = validateChangeClose(input);
      if (!validation.ok) {
        console.log(JSON.stringify(validation));
        process.exitCode = 1;
        break;
      }
      console.log(JSON.stringify(buildChangeClosePlan(input as ChangeCloseInput)));
      break;
    }
    case 'version': {
      // issue 22: 运行时版本守卫。Skill 启动时先 `git fetch origin`(零网络的引擎不做网络),
      // 再 `pnpm cli version --fetched` 拿判定;不传 --fetched 则只比本地缓存 ref。
      const fetched = args.includes('--fetched');
      console.log(JSON.stringify(checkRuntimeVersion(fetched)));
      break;
    }
    case 'test-config': {
      // 测试配置解析/上下文:stdin = test-config.md 全文。仅解析用 `--parse`;
      // 组上下文用 `--repos a,b --env local [--iid N]`(routes 推 Apifox 项目,配置送到脸上)。
      const md = readStdin();
      const config = parseTestConfig(md);
      const flag = (name: string): string | undefined => {
        const i = args.indexOf(name);
        return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
      };
      const reposArg = flag('--repos');
      const env = flag('--env');
      const iidArg = flag('--iid');
      if (reposArg && env) {
        const ctx = buildTestContext(config, {
          repos: reposArg.split(',').map((r) => r.trim()).filter(Boolean),
          env,
          ...(iidArg && /^\d+$/.test(iidArg) ? { iid: Number(iidArg) } : {}),
        });
        const missing = ctx.apifoxTargets.filter((t) => !t.envId);
        if (missing.length) {
          console.error(`test-config: 环境 "${env}" 缺 Apifox 环境 ID: ${missing.map((t) => `apifox_projects.${t.project}.envs.${t.envName}`).join('; ')}`);
          process.exitCode = 1;
        }
        console.log(JSON.stringify(ctx));
      } else {
        console.log(JSON.stringify(config));
      }
      break;
    }
    case 'config': {
      console.log(JSON.stringify(parseConfig(readStdin())));
      break;
    }
    case 'state-init': {
      const input = JSON.parse(readStdin()) as Partial<InitStateInput>;
      const { iid, type, host, projectId, workspaceRoot } = input;
      if (!iid || !type || !host || !projectId || !workspaceRoot) {
        throw new Error('state-init: stdin requires iid, type, host, projectId, workspaceRoot');
      }
      const state = initState({
        iid,
        type,
        host,
        projectId,
        workspaceRoot,
        runMode: input.runMode,
        now: input.now ?? new Date().toISOString(),
      });
      console.log(JSON.stringify(state));
      break;
    }
    case 'progress': {
      const input = JSON.parse(readStdin()) as { state: RunState; step?: string; resetToNode?: string; now: string };
      console.log(JSON.stringify(progressCommand(input)));
      break;
    }
    case 'state-writeback': {
      const input = JSON.parse(readStdin()) as { state: RunState; audit: WritebackAuditInput; now: string };
      console.log(JSON.stringify(stateWritebackCommand(input)));
      break;
    }
    case 'evidence-record': {
      try {
        const input = JSON.parse(readStdin()) as { state: RunState; kind: 'test-run' | 'apifox-asset-audit'; receipt: string; now: string };
        console.log(JSON.stringify(evidenceRecordCommand(input)));
      } catch (e) {
        console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        process.exitCode = 1;
      }
      break;
    }
    case 'run-mode-select': {
      try {
        const input = JSON.parse(readStdin()) as { state: RunState; mode: RunMode; selectedBy: string; now: string };
        console.log(JSON.stringify(runModeSelectCommand(input)));
      } catch (e) {
        console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        process.exitCode = 1;
      }
      break;
    }
    case 'automation-decision': {
      try {
        const input = JSON.parse(readStdin()) as { event: AutomationEvent; attempt: number };
        console.log(JSON.stringify(decideAutomation(input.event, input.attempt)));
      } catch (e) {
        console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.error('commands: node | validate | render | plan | transition | test-run | asset-audit | plan-return | week-plan-change | change-impact | change-close | evidence | config | version | test-config | state-init | state-writeback | evidence-record | progress | run-mode-select | automation-decision');
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

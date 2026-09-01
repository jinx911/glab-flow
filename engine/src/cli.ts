import { readFileSync } from 'node:fs';
import { loadModel, currentNode, progressStepsFor } from './model.js';
import { validateTransition, validateWeekPlanChange } from './guard.js';
import { toFacts } from './gitlab.js';
import { renderStatusChange } from './render.js';
import { buildReturnPlan, buildForwardPlan, buildWeekPlanChangePlan } from './plan.js';
import { runTransition } from './transition.js';
import { computeNextStep } from './next-step.js';
import type { NextStepInput } from './next-step.js';
import { extractEvidence } from './evidence.js';
import { parseConfig } from './config.js';
import { initState } from './state.js';
import type { InitStateInput, RunState, WritebackAuditInput } from './state.js';
import type { ApifoxAssetAudit, IssueNote, Payload, TransitionInput, WeekPlanChangeInput } from './types.js';
import type { ChangeCloseInput, ChangeImpactInput } from './types.js';
import { buildChangeClosePlan, buildChangeImpactPlan, validateChangeClose, validateChangeImpactInput } from './change-impact.js';
import { planChange } from './change.js';
import type { ChangePlanInput } from './change.js';
import { reconcileLabels } from './reconcile.js';
import type { ReconcileInput } from './reconcile.js';
import { progressCommand, stateWritebackCommand } from './cli-commands.js';
import { checkRuntimeVersion } from './version.js';
import { parseTestConfig, buildTestContext } from './test-config.js';
import { parseLatestTestRun, parseTestPlan, renderTestRun, validateTestRun } from './test-run.js';
import { parseLatestApifoxAssetAudit, renderApifoxAssetAudit, validateApifoxAssetAudit } from './asset-audit.js';
import { initDu, recordEvidence, bindGateSet, setCachedNode } from './du.js';
import { buildReviewPack } from './review-pack.js';
import type { ReviewPackInput } from './review-pack.js';
import { checkResources, cleanupChecklist, disposeResource, registerResource } from './resource.js';
import { recordMetric, summarizeMetrics } from './metrics.js';
import type { DuMetricEvent, DuResourceEntry, DuState, TestRun } from './types.js';

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
      const input = JSON.parse(readStdin()) as { type: 'story' | 'bug'; labels: string[]; payload: Payload; body?: string; notes?: IssueNote[]; testPlan?: string };
      if (input.testPlan !== undefined) input.payload.testPlan = input.testPlan;
      const result = validateTransition(model, toFacts({ iid: 0, state: 'opened', labels: input.labels, description: input.body ?? '' }), input.payload, input.notes);
      console.log(JSON.stringify(result));
      break;
    }
    case 'render': {
      const payload = JSON.parse(readStdin()) as Payload;
      console.log(renderStatusChange(payload));
      break;
    }
    case 'plan': {
      const input = JSON.parse(readStdin()) as { payload: Payload; notes?: IssueNote[]; body?: string; testPlan?: string };
      const payload = input.payload;
      if (input.testPlan !== undefined) payload.testPlan = input.testPlan;
      const statusLabel = payload.type === 'story' ? `story-status::${payload.from}` : `status::${payload.from}`;
      const result = validateTransition(model, toFacts({
        iid: 0,
        state: 'opened',
        labels: [`type::${payload.type}`, statusLabel],
        description: input.body ?? '',
      }), payload, input.notes);
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
    case 'next': {
      const input = JSON.parse(readStdin()) as NextStepInput;
      console.log(JSON.stringify(computeNextStep(model, input)));
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
      const comment = renderTestRun(input.run);
      const validation = validateTestRun(parsed.plan, input.run.environment, parseLatestTestRun([{ body: comment }], input.run.environment));
      console.log(JSON.stringify({ validate: { ok: validation.ok, missing: validation.ok ? [] : [`${input.run.environment}TestRun`], reasons: validation.errors }, ...(validation.ok ? { comment } : {}) }));
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
      const comment = renderApifoxAssetAudit(input.audit);
      const validation = validateApifoxAssetAudit(parsed.plan, input.audit.environment, parseLatestApifoxAssetAudit([{ body: comment }], input.audit.environment));
      console.log(JSON.stringify({ validate: { ok: validation.ok, missing: validation.ok ? [] : [`${input.audit.environment}AssetAudit`], reasons: validation.errors }, ...(validation.ok ? { comment } : {}) }));
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
    case 'resource': {
      // P4 资源登记表：DU 名下资源创建即登记，终态出清理清单，处置后回写。
      const input = JSON.parse(readStdin()) as {
        du?: DuState;
        op?: 'register' | 'check' | 'cleanup' | 'dispose';
        entry?: Omit<DuResourceEntry, 'disposedAt' | 'disposal'>;
        resourceId?: string;
        disposal?: 'deleted' | 'promoted-shared' | 'kept';
        now?: string;
      };
      const ops = ['register', 'check', 'cleanup', 'dispose'] as const;
      if (!input.du || !input.now || !ops.includes(input.op!)) {
        throw new Error('resource: stdin requires du, now, and op (register|check|cleanup|dispose)');
      }
      if (input.op === 'register' && !input.entry) {
        throw new Error('resource: register requires entry');
      }
      if (input.op === 'dispose' && (!input.resourceId || !input.disposal)) {
        throw new Error('resource: dispose requires resourceId and disposal');
      }
      if (input.op === 'dispose' && !input.du.resources.some((r) => r.id === input.resourceId)) {
        throw new Error(`resource: dispose unknown resourceId ${input.resourceId}`);
      }
      switch (input.op) {
        case 'register':
          console.log(JSON.stringify(registerResource(input.du, input.entry!, input.now)));
          break;
        case 'check':
          console.log(JSON.stringify(checkResources(input.du)));
          break;
        case 'cleanup':
          console.log(JSON.stringify(cleanupChecklist(input.du)));
          break;
        case 'dispose':
          console.log(JSON.stringify(disposeResource(input.du, input.resourceId!, input.disposal!, input.now)));
          break;
        default:
          throw new Error(`resource: unknown op ${String(input.op)}`);
      }
      break;
    }
    case 'change': {
      // P5 变化分级：change-impact 闭环 + 定级 T1-T4 + GateSet 棘轮扩容（expandedGateSet 由 Leader 写回 DU）。
      const input = JSON.parse(readStdin()) as ChangePlanInput;
      if (!input.du || typeof input.du !== 'object') {
        throw new Error('change: du required');
      }
      const result = planChange(model, input);
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
      break;
    }
    case 'reconcile': {
      // P5 对账：labels 与 DU cachedNode 漂移时给出二选一处理方向，不再当脏状态异常。
      const input = JSON.parse(readStdin()) as ReconcileInput;
      if ((input.type !== 'story' && input.type !== 'bug') || !Array.isArray(input.labels) || (input.state !== 'opened' && input.state !== 'closed') || !input.du || typeof input.du !== 'object') {
        throw new Error('reconcile: stdin requires type (story|bug), labels (array), state (opened|closed), du');
      }
      console.log(JSON.stringify(reconcileLabels(model, input)));
      break;
    }
    case 'metrics': {
      // P6 交付指标：event 存在 → 记事件返回新 du（Leader 落盘）；否则纯汇总。
      const input = JSON.parse(readStdin()) as { du: DuState; event?: DuMetricEvent };
      if (!input.du || typeof input.du !== 'object') {
        throw new Error('metrics: du required');
      }
      console.log(JSON.stringify(input.event ? recordMetric(input.du, input.event) : summarizeMetrics(input.du)));
      break;
    }
    case 'du': {
      // DU 写入面（终审遗留 Medium）：init/record/bind-gateset/cached-node 消除 Leader 手写 du.json。
      // 引擎纯计算——返回新 DU 对象，落盘仍归 Leader（与 state 文件同模式）。
      const input = JSON.parse(readStdin()) as {
        op: 'init' | 'record' | 'bind-gateset' | 'cached-node';
        iid?: number;
        type?: 'story' | 'bug';
        now?: string;
        du?: DuState;
        entry?: Parameters<typeof recordEvidence>[1];
        scopes?: Parameters<typeof bindGateSet>[2];
        node?: string;
      };
      const now = input.now ?? new Date().toISOString();
      switch (input.op) {
        case 'init': {
          if (!input.iid || (input.type !== 'story' && input.type !== 'bug')) {
            throw new Error('du: init requires iid (number) and type (story|bug)');
          }
          console.log(JSON.stringify(initDu({ iid: input.iid, type: input.type, now })));
          break;
        }
        case 'record': {
          const entry = input.entry;
          if (!input.du || typeof input.du !== 'object') throw new Error('du: record requires du');
          if (!entry || typeof entry !== 'object' || !entry.kind || !entry.environment || !entry.planVersion || !entry.outcome || !entry.recordedAt) {
            throw new Error('du: record requires entry {kind, environment, planVersion, outcome, recordedAt, detailRef?}');
          }
          if (entry.kind !== 'test-run' && entry.kind !== 'asset-audit') throw new Error(`du: record entry.kind must be test-run|asset-audit, got ${String(entry.kind)}`);
          if (entry.environment !== 'local' && entry.environment !== 'test' && !entry.environment.trim()) throw new Error('du: record entry.environment must be non-empty');
          console.log(JSON.stringify(recordEvidence(input.du, entry, now)));
          break;
        }
        case 'bind-gateset': {
          if (!input.du || typeof input.du !== 'object') throw new Error('du: bind-gateset requires du');
          if (!Array.isArray(input.scopes) || input.scopes.length === 0) throw new Error('du: bind-gateset requires scopes (non-empty ChangeScope[])');
          if (!model.gateMatrix) throw new Error('du: bind-gateset requires gateMatrix in state-machine.yaml');
          console.log(JSON.stringify(bindGateSet(input.du, model.gateMatrix, input.scopes, now)));
          break;
        }
        case 'cached-node': {
          if (!input.du || typeof input.du !== 'object') throw new Error('du: cached-node requires du');
          if (typeof input.node !== 'string' || !input.node.trim()) throw new Error('du: cached-node requires node (non-empty)');
          console.log(JSON.stringify(setCachedNode(input.du, input.node, now)));
          break;
        }
        default:
          throw new Error(`du: unknown op ${String(input.op)}`);
      }
      break;
    }
    case 'review-pack': {
      // 评审上下文包：spec 路径 + DU 证据摘要 + 门禁缺口 + 评审指令，标准化喂给 reviewer。
      const input = JSON.parse(readStdin()) as ReviewPackInput;
      const result = buildReviewPack(model, input);
      if ('error' in result) {
        console.error(`review-pack: ${result.error}`);
        process.exit(1);
      }
      console.log(JSON.stringify(result));
      break;
    }
    default:
      console.error('commands: node | validate | render | plan | transition | next | test-run | asset-audit | plan-return | week-plan-change | change-impact | change-close | change | reconcile | evidence | config | version | test-config | state-init | state-writeback | progress | resource | metrics | du | review-pack');
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

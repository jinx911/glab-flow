import { readFileSync } from 'node:fs';
import { loadModel, currentNode, progressStepsFor } from './model.js';
import { validateTransition, validateWeekPlanChange } from './guard.js';
import { toFacts } from './gitlab.js';
import { renderStatusChange } from './render.js';
import { buildReturnPlan, buildForwardPlan, buildWeekPlanChangePlan } from './plan.js';
import { runTransition } from './transition.js';
import { extractEvidence } from './evidence.js';
import { parseConfig } from './config.js';
import { initState } from './state.js';
import type { InitStateInput, RunState, WritebackAuditInput } from './state.js';
import type { Payload, TransitionInput, WeekPlanChangeInput } from './types.js';
import { progressCommand, stateWritebackCommand } from './cli-commands.js';
import { checkRuntimeVersion } from './version.js';

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
      const input = JSON.parse(readStdin()) as { type: 'story' | 'bug'; labels: string[]; payload: Payload; body?: string; notes?: { body: string }[] };
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
      const input = JSON.parse(readStdin()) as { payload: Payload; notes?: { body: string }[]; body?: string };
      const payload = input.payload;
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
    case 'version': {
      // issue 22: 运行时版本守卫。Skill 启动时先 `git fetch origin`(零网络的引擎不做网络),
      // 再 `pnpm cli version --fetched` 拿判定;不传 --fetched 则只比本地缓存 ref。
      const fetched = args.includes('--fetched');
      console.log(JSON.stringify(checkRuntimeVersion(fetched)));
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
    default:
      console.error('commands: node | validate | render | plan | transition | plan-return | week-plan-change | evidence | config | version | state-init | state-writeback | progress');
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

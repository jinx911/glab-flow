import { readFileSync } from 'node:fs';
import { loadModel, currentNode, progressStepsFor } from './model.js';
import { validateTransition } from './guard.js';
import { toFacts } from './gitlab.js';
import { renderStatusChange } from './render.js';
import { buildReturnPlan, buildForwardPlan } from './plan.js';
import { runTransition } from './transition.js';
import { extractEvidence } from './evidence.js';
import { parseConfig } from './config.js';
import { initState } from './state.js';
import type { DataEvidenceProfile, InitStateInput, RunState, WritebackAuditInput } from './state.js';
import type { ArtifactReceipt, Payload, TransitionInput } from './types.js';
import { progressCommand, stateDataEvidenceProfileCommand, stateReceiptCommand, stateWritebackCommand } from './cli-commands.js';

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
      const input = JSON.parse(readStdin()) as { type: 'story' | 'bug'; labels: string[]; payload: Payload; body?: string };
      const result = validateTransition(model, toFacts({ iid: 0, state: 'opened', labels: input.labels, description: input.body ?? '' }), input.payload);
      console.log(JSON.stringify(result));
      break;
    }
    case 'render': {
      const payload = JSON.parse(readStdin()) as Payload;
      console.log(renderStatusChange(payload));
      break;
    }
    case 'plan': {
      const input = JSON.parse(readStdin()) as { payload: Payload };
      console.log(JSON.stringify(buildForwardPlan(input.payload, Number(args[0] ?? 0))));
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
      const input = JSON.parse(readStdin()) as { state: RunState; step?: string; resetToNode?: string; verifiedReceipts?: ArtifactReceipt[]; now: string };
      console.log(JSON.stringify(progressCommand({ ...input, progressReceipts: model.progressReceipts })));
      break;
    }
    case 'state-receipt': {
      const input = JSON.parse(readStdin()) as { state: RunState; receipt: ArtifactReceipt; now: string };
      console.log(JSON.stringify(stateReceiptCommand(input)));
      break;
    }
    case 'state-data-evidence-profile': {
      const input = JSON.parse(readStdin()) as { state: RunState; profile: DataEvidenceProfile; now: string };
      if (input.profile !== 'standard' && input.profile !== 'data-backed') {
        throw new Error('state-data-evidence-profile: profile must be standard or data-backed');
      }
      console.log(JSON.stringify(stateDataEvidenceProfileCommand(input)));
      break;
    }
    case 'state-writeback': {
      const input = JSON.parse(readStdin()) as { state: RunState; audit: WritebackAuditInput; now: string };
      console.log(JSON.stringify(stateWritebackCommand(input)));
      break;
    }
    default:
      console.error('commands: node | validate | render | plan | transition | plan-return | evidence | config | state-init | state-receipt | state-data-evidence-profile | state-writeback | progress');
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

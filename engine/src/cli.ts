import { readFileSync } from 'node:fs';
import { loadModel, currentNode } from './model.js';
import { validateTransition } from './guard.js';
import { toFacts } from './gitlab.js';
import { renderStatusChange } from './render.js';
import { buildReturnPlan } from './plan.js';
import { extractEvidence } from './evidence.js';
import type { Payload, WritePlan } from './types.js';

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
      console.log(JSON.stringify({ node }));
      break;
    }
    case 'validate': {
      const input = JSON.parse(readStdin()) as { type: 'story' | 'bug'; labels: string[]; payload: Payload };
      const result = validateTransition(model, toFacts({ iid: 0, state: 'opened', labels: input.labels, description: '' }), input.payload);
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
      const p = input.payload;
      const prefix = p.type === 'story' ? 'story-status' : 'status';
      const plan: WritePlan = {
        issueIid: Number(args[0] ?? 0),
        ops: [
          { kind: 'remove_label', value: `${prefix}::${p.from}` },
          { kind: 'add_label', value: `${prefix}::${p.to}` },
          { kind: 'set_assignee', username: p.assigneeUser ?? '' },
          { kind: 'add_comment', body: renderStatusChange(p) },
          ...(p.closeIssue ? [{ kind: 'close_issue' as const }] : []),
        ],
      };
      console.log(JSON.stringify(plan));
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
    default:
      console.error('commands: node | validate | render | plan | plan-return | evidence');
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

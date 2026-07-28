import { readFileSync } from 'node:fs';
import { loadModel, currentNode } from './model.js';
import { validateTransition, validateWritePlan } from './guard.js';
import { toFacts, parseAssigneeTable, fetchIssue, fetchComments, applyWritePlan, type GitLabIssue } from './gitlab.js';
import { renderStatusChange } from './render.js';
import { extractEvidence } from './evidence.js';
import type { Payload, WritePlan } from './types.js';

const model = loadModel();
const BASE = process.env.GLAB_FLOW_API ?? 'https://git.kuainiujinke.com/api/v4';
const TOKEN = process.env.GLAB_FLOW_TOKEN ?? '';
const PROJECT = process.env.GLAB_FLOW_PROJECT_ID ?? '3915';

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
    case 'apply': {
      const plan = JSON.parse(readStdin()) as WritePlan;
      const guard = validateWritePlan(plan);
      if (!guard.ok) { console.error(JSON.stringify(guard)); process.exit(1); }
      await applyWritePlan(BASE, TOKEN, PROJECT, plan);
      console.log(JSON.stringify({ applied: true }));
      break;
    }
    case 'resolve-assignee': {
      const iid = Number(args[0]);
      const role = args[1] ?? '';
      const issue: GitLabIssue = await fetchIssue(BASE, TOKEN, PROJECT, iid);
      const map = parseAssigneeTable(issue.description);
      console.log(JSON.stringify({ user: map.get(role) ?? null }));
      break;
    }
    case 'evidence': {
      const iid = Number(args[0]);
      const comments = await fetchComments(BASE, TOKEN, PROJECT, iid);
      console.log(JSON.stringify(extractEvidence(comments)));
      break;
    }
    default:
      console.error('commands: node | validate | render | plan | apply | resolve-assignee | evidence');
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

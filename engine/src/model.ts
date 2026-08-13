import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import type { IssueType, StateMachine, Transition, ArtifactKind } from './types.js';
import { STATUS_PREFIX } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = join(__dirname, '..', 'state-machine.yaml');

export function loadModel(path: string = MODEL_PATH): StateMachine {
  const raw = readFileSync(path, 'utf8');
  return parse(raw) as StateMachine;
}

export function currentNode(model: StateMachine, type: IssueType, labels: string[]): string | null {
  const prefix = STATUS_PREFIX[type];
  const found = labels.find((l) => l.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function transitions(model: StateMachine, type: IssueType): Transition[] {
  return model[type].transitions;
}

export function transitionFor(model: StateMachine, type: IssueType, from: string, to: string): Transition | undefined {
  return transitions(model, type).find((t) => t.from === from && t.to === to);
}

export function requiredFields(model: StateMachine, type: IssueType, from: string, to: string): string[] {
  return transitionFor(model, type, from, to)?.requiredFields ?? [];
}

export function assigneeRole(model: StateMachine, type: IssueType, from: string, to: string) {
  return transitionFor(model, type, from, to)?.assigneeRole;
}

export function returnTarget(model: StateMachine, type: IssueType, from: string, to: string) {
  return transitionFor(model, type, from, to)?.return;
}

export function allowedTransitions(model: StateMachine, type: IssueType, from: string): Transition[] {
  return transitions(model, type).filter((t) => t.from === from);
}

/** 当前节点的内部子步骤 checklist（无则空数组）。 */
export function progressStepsFor(model: StateMachine, node: string | null): string[] {
  if (!node) return [];
  return model.progressSteps?.[node] ?? [];
}

/** 节点子步骤 → 要求的产物 receipt kind（来自 state-machine.yaml progressReceipts）。 */
export function progressReceiptMap(model: StateMachine): Record<string, ArtifactKind> {
  return model.progressReceipts ?? {};
}

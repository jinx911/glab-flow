import { glabApi, type GlabRunner } from './glab.js';
import type { IssueFacts, WritePlan } from './types.js';

export { parseAssigneeTable } from './parse.js';

export interface GitLabIssue {
  iid: number;
  state: 'opened' | 'closed';
  labels: string[];
  description: string;
}

export interface GitlabOpts {
  host?: string;
  runner?: GlabRunner;
}

export function toFacts(issue: GitLabIssue): IssueFacts {
  return {
    labels: issue.labels,
    body: issue.description,
    state: issue.state,
    hasJiraSourceLabel: issue.labels.includes('source::jira'),
  };
}

export async function fetchIssue(projectId: string | number, iid: number, opts: GitlabOpts = {}): Promise<GitLabIssue> {
  const j = await glabApi<{ iid: number; state: string; labels: string[]; description?: string }>(
    'GET', `projects/${projectId}/issues/${iid}`, {}, opts,
  );
  return { iid: j.iid, state: j.state === 'opened' ? 'opened' : 'closed', labels: j.labels ?? [], description: j.description ?? '' };
}

export async function fetchComments(projectId: string | number, iid: number, opts: GitlabOpts = {}): Promise<{ body: string }[]> {
  return glabApi<{ body: string }[]>(
    'GET', `projects/${projectId}/issues/${iid}/notes?per_page=100&sort=asc&order_by=created_at`, {}, opts,
  );
}

export async function resolveUserId(username: string, opts: GitlabOpts = {}): Promise<number | undefined> {
  const users = await glabApi<{ id: number }[]>('GET', `users?username=${encodeURIComponent(username)}`, {}, opts);
  return users[0]?.id;
}

export async function applyWritePlan(projectId: string | number, plan: WritePlan, opts: GitlabOpts = {}): Promise<void> {
  const addLabels: string[] = [];
  const removeLabels: string[] = [];
  let assignee: string | undefined;
  let doClose = false;
  const comments: string[] = [];
  for (const op of plan.ops) {
    switch (op.kind) {
      case 'add_label': addLabels.push(op.value); break;
      case 'remove_label': removeLabels.push(op.value); break;
      case 'set_assignee': assignee = op.username.replace('@', ''); break;
      case 'add_comment': comments.push(op.body); break;
      case 'close_issue': doClose = true; break;
    }
  }
  let assigneeId: number | undefined;
  if (assignee) {
    assigneeId = await resolveUserId(assignee, opts);
    if (assigneeId === undefined) throw new Error(`GitLab user not found for assignee: ${assignee}`);
  }
  if (addLabels.length || removeLabels.length || assigneeId !== undefined || doClose) {
    const fields: Record<string, string> = {};
    if (addLabels.length) fields.add_labels = addLabels.join(',');
    if (removeLabels.length) fields.remove_labels = removeLabels.join(',');
    if (assigneeId !== undefined) fields.assignee_ids = String(assigneeId);
    if (doClose) fields.state_event = 'close';
    await glabApi('PUT', `projects/${projectId}/issues/${plan.issueIid}`, fields, opts);
  }
  for (const c of comments) {
    await glabApi('POST', `projects/${projectId}/issues/${plan.issueIid}/notes`, { body: c }, opts);
  }
}

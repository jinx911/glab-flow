import type { IssueFacts, WritePlan } from './types.js';

export { parseAssigneeTable } from './parse.js';

export interface GitLabIssue {
  iid: number;
  state: 'opened' | 'closed';
  labels: string[];
  description: string;
}

export function toFacts(issue: GitLabIssue): IssueFacts {
  return {
    labels: issue.labels,
    body: issue.description,
    state: issue.state,
    hasJiraSourceLabel: issue.labels.includes('source::jira'),
  };
}

async function http<T>(url: string, token: string, init: RequestInit, retries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return (await res.json()) as T;
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 200 * (i + 1))); }
  }
  throw lastErr;
}

export async function fetchIssue(base: string, token: string, projectId: string | number, iid: number): Promise<GitLabIssue> {
  return http<GitLabIssue>(`${base}/projects/${projectId}/issues/${iid}`, token, {});
}

export async function fetchComments(base: string, token: string, projectId: string | number, iid: number): Promise<{ body: string }[]> {
  return http<{ body: string }[]>(`${base}/projects/${projectId}/issues/${iid}/notes?per_page=100&sort=asc&order_by=created_at`, token, {});
}

export async function applyWritePlan(base: string, token: string, projectId: string | number, plan: WritePlan): Promise<void> {
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
  if (addLabels.length || removeLabels.length || assignee || doClose) {
    const body: Record<string, unknown> = {};
    if (addLabels.length) body.add_labels = addLabels.join(',');
    if (removeLabels.length) body.remove_labels = removeLabels.join(',');
    if (assignee) body.assignee_username = assignee;
    if (doClose) body.state_event = 'close';
    await http(`${base}/projects/${projectId}/issues/${plan.issueIid}`, token, { method: 'PUT', body: JSON.stringify(body) });
  }
  for (const c of comments) {
    await http(`${base}/projects/${projectId}/issues/${plan.issueIid}/notes`, token, { method: 'POST', body: JSON.stringify({ body: c }) });
  }
}

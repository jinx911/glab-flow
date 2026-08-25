import type { IssueFacts } from './types.js';

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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAssigneeTable, toFacts, type GitLabIssue } from './gitlab.js';

const issue = JSON.parse(readFileSync(new URL('../fixtures/issue-story-pending-review.json', import.meta.url), 'utf8')) as GitLabIssue;

describe('gitlab read/parse', () => {
  it('parses 交付协同 role->user table from description', () => {
    const map = parseAssigneeTable(issue.description);
    expect(map.get('产品')).toBe('@vicky');
    expect(map.get('研发')).toBe('@eliojin');
    expect(map.get('测试')).toBe('@qa');
  });
  it('returns empty map when table absent', () => {
    expect(parseAssigneeTable('no table here').size).toBe(0);
  });
  it('toFacts maps issue fields and detects source::jira', () => {
    const f = toFacts(issue);
    expect(f.labels).toEqual(issue.labels);
    expect(f.state).toBe('opened');
    expect(f.hasJiraSourceLabel).toBe(false);
    const jiraFacts = toFacts({ ...issue, labels: [...issue.labels, 'source::jira'] });
    expect(jiraFacts.hasJiraSourceLabel).toBe(true);
  });
});

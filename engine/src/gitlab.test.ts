import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAssigneeTable, toFacts, fetchIssue, applyWritePlan, type GitLabIssue } from './gitlab.js';

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

const base = 'https://git.example.com/api/v4';
const token = 'tok';
const pid = 3915;
function mockFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => responder(url, init));
}

describe('fetchIssue', () => {
  it('GETs the issue and retries on network error', async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls < 2) throw new Error('net');
      return new Response(JSON.stringify(issue), { status: 200 });
    });
    const got = await fetchIssue(base, token, pid, 123);
    expect(got.iid).toBe(123);
    expect(calls).toBe(2);
  });
});

describe('applyWritePlan', () => {
  it('translates ops to GitLab API calls (PUT issue + POST notes)', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => { calls.push(`${init?.method ?? 'GET'} ${url}`); return new Response('{}', { status: 200 }); });
    await applyWritePlan(base, token, pid, { issueIid: 123, ops: [
      { kind: 'remove_label', value: 'story-status::草稿中' },
      { kind: 'add_label', value: 'story-status::待评审' },
      { kind: 'set_assignee', username: '@pm' },
      { kind: 'add_comment', body: 'hi' },
    ] });
    expect(calls.some((c) => c.includes('/projects/3915/issues/123') && c.startsWith('PUT'))).toBe(true);
    expect(calls.some((c) => c.includes('/projects/3915/issues/123/notes') && c.startsWith('POST'))).toBe(true);
  });
});

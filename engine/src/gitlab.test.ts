import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAssigneeTable, toFacts, fetchIssue, fetchComments, applyWritePlan, resolveUserId, type GitLabIssue } from './gitlab.js';
import { buildArgs } from './glab.js';
import type { GlabRunner } from './glab.js';

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

const pid = 3915;
function recorder(canned: string): { runner: GlabRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GlabRunner = async (args) => { calls.push(args); return canned; };
  return { runner, calls };
}

describe('fetchIssue', () => {
  it('GETs via glabApi and maps to GitLabIssue', async () => {
    const { runner, calls } = recorder(JSON.stringify({ iid: 123, state: 'opened', labels: ['type::story'], description: 'd' }));
    const got = await fetchIssue(pid, 123, { runner });
    expect(got.iid).toBe(123);
    expect(got.state).toBe('opened');
    expect(got.labels).toEqual(['type::story']);
    expect(calls[0]).toEqual(buildArgs('GET', 'projects/3915/issues/123', {}));
  });
});

describe('applyWritePlan', () => {
  it('PUTs labels+assignee and POSTs each comment', async () => {
    const calls: string[][] = [];
    const runner: GlabRunner = async (args) => {
      calls.push(args);
      const path = args[args.length - 1] ?? '';
      if (path.includes('users')) return JSON.stringify([{ id: 777, username: 'pm' }]);
      return '{}';
    };
    await applyWritePlan(pid, { issueIid: 123, ops: [
      { kind: 'remove_label', value: 'story-status::草稿中' },
      { kind: 'add_label', value: 'story-status::待评审' },
      { kind: 'set_assignee', username: '@pm' },
      { kind: 'add_comment', body: 'hi' },
    ] }, { runner });
    const methods = calls.map((a) => a[a.indexOf('--method') + 1]);
    expect(methods).toContain('PUT');
    expect(methods).toContain('POST');
    const put = calls.find((a) => a.includes('PUT'))!;
    expect(put).toContain('add_labels=story-status::待评审');
    expect(put).toContain('remove_labels=story-status::草稿中');
    expect(put).toContain('assignee_ids=777');
    expect(put[put.length - 1]).toBe('projects/3915/issues/123');
  });
  it('adds state_event=close on close_issue (terminal atomicity intent)', async () => {
    const { runner, calls } = recorder('{}');
    await applyWritePlan(pid, { issueIid: 123, ops: [
      { kind: 'add_label', value: 'story-status::已完成' },
      { kind: 'close_issue' },
    ] }, { runner });
    const put = calls.find((a) => a.includes('PUT'))!;
    expect(put).toContain('state_event=close');
  });
  it('skips PUT when only comments', async () => {
    const { runner, calls } = recorder('{}');
    await applyWritePlan(pid, { issueIid: 123, ops: [{ kind: 'add_comment', body: 'hi' }] }, { runner });
    expect(calls.every((a) => !a.includes('PUT'))).toBe(true);
    expect(calls.some((a) => a.includes('POST'))).toBe(true);
  });
});

describe('fetchComments', () => {
  it('GETs notes', async () => {
    const { runner, calls } = recorder(JSON.stringify([{ body: '## 状态变更\n- x：y' }]));
    const notes = await fetchComments(pid, 123, { runner });
    const firstCall = calls[0]!;
    expect(notes[0]!.body).toContain('状态变更');
    expect(firstCall[firstCall.length - 1]!).toContain('/issues/123/notes');
  });
});

describe('resolveUserId', () => {
  it('returns the first matching user id', async () => {
    const runner: GlabRunner = async () => JSON.stringify([{ id: 1234, username: 'eliojin' }, { id: 9999, username: 'eliojin' }]);
    expect(await resolveUserId('eliojin', { runner })).toBe(1234);
  });
  it('returns undefined when no match', async () => {
    const runner: GlabRunner = async () => '[]';
    expect(await resolveUserId('nobody', { runner })).toBeUndefined();
  });
});

describe('applyWritePlan assignee_ids', () => {
  it('PUTs assignee_ids (not assignee_username), resolving username→id via GET users', async () => {
    const calls: string[][] = [];
    const runner: GlabRunner = async (args) => {
      calls.push(args);
      const path = args[args.length - 1] ?? '';
      if (path.includes('users')) return JSON.stringify([{ id: 1234, username: 'eliojin' }]);
      return '{}';
    };
    await applyWritePlan(pid, { issueIid: 123, ops: [
      { kind: 'add_label', value: 'story-status::已评审' },
      { kind: 'set_assignee', username: '@eliojin' },
    ] }, { runner });
    const put = calls.find((a) => a.includes('PUT'))!;
    expect(put).toContain('assignee_ids=1234');
    expect(put.some((a) => a.startsWith('assignee_username'))).toBe(false);
    // verify the users lookup happened with the right query
    const getUsers = calls.find((a) => (a[a.length - 1] ?? '').includes('users?username=eliojin'));
    expect(getUsers).toBeTruthy();
  });
  it('throws when the assignee username is not found', async () => {
    const runner: GlabRunner = async (args) => ((args[args.length - 1] ?? '').includes('users') ? '[]' : '{}');
    await expect(applyWritePlan(pid, { issueIid: 123, ops: [{ kind: 'set_assignee', username: '@ghost' }] }, { runner }))
      .rejects.toThrow(/GitLab user not found/);
  });
});

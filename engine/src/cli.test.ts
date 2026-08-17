import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const CLI = join(REPO_ROOT, 'engine', 'src', 'cli.ts');

/** 跑 CLI，stdin 喂 JSON，捕获 stdout（直接用 tsx，绕过 pnpm 的 script header 污染）。 */
function cli(command: 'validate' | 'plan', stdin: object): { json: unknown; status: number | null; stderr: string } {
  const r = spawnSync(TSX, [CLI, command], {
    input: JSON.stringify(stdin),
    encoding: 'utf8',
  });
  return { json: r.stdout ? JSON.parse(r.stdout) : null, status: r.status, stderr: r.stderr ?? '' };
}

describe('cli validate — body passthrough (G6b reachable, ⑩)', () => {
  // 待评审→已评审：requiredFields 齐 + gateOutcome 通过 + reviewType 需求评审 + 日期已确认；
  // 唯一变量是 assigneeUser 是否与「交付协同」表的研发角色一致（G6b 交叉校验）。
  const payload = (assignee: string) => ({
    type: 'story', from: '待评审', to: '已评审',
    fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
    weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true },
    gateOutcome: '通过', reviewType: '需求评审', assigneeUser: assignee, datesConfirmed: true,
  });
  const TABLE_BODY = '# 需求\n## 交付协同\n\n| 角色 | GitLab 用户 |\n| --- | --- |\n| 产品 | @pm |\n| 研发 | @dev |\n| 测试 | @qa |\n';

  it('flags G6b mismatch when body present and assignee disagrees with table', () => {
    const { json, status } = cli('validate', {
      type: 'story', labels: ['type::story', 'story-status::待评审'], body: TABLE_BODY, payload: payload('@someone-else'),
    });
    expect(status).toBe(0);
    const g = json as { ok: boolean; reasons: string[] };
    expect(g.ok).toBe(false);
    expect(g.reasons.some((x) => x.includes('与交付协同表'))).toBe(true);
  });

  it('does NOT flag G6b when body omitted (back-compat: empty body skips cross-check)', () => {
    // 旧用法（无 body）→ G6b 跳过；@someone-else 是合法 @ 用户，仅过格式 G6 → ok
    const { json, status } = cli('validate', {
      type: 'story', labels: ['type::story', 'story-status::待评审'], payload: payload('@someone-else'),
    });
    expect(status).toBe(0);
    const g = json as { ok: boolean };
    expect(g.ok).toBe(true);
  });
});

describe('cli Week Plan contract — legacy direct paths', () => {
  const reviewPayload = {
    type: 'story' as const, from: '待评审', to: '已评审',
    fields: { 评审日期: '2026-07-28', 产品确认人: '@pm', 评审结论: '通过', 需求文档或评审记录: 'link' },
    gateOutcome: '通过' as const, reviewType: '需求评审', assigneeUser: '@dev', datesConfirmed: true,
  };
  const developmentPayload = {
    type: 'story' as const, from: '已评审', to: '开发中',
    fields: {
      技术方案评审通过记录或免评审结论: '通过', 实际开始日期: '2026-08-07', 研发Assignee: '@dev',
      计划提测时间: '2026-08-08', 计划上线时间: '2026-08-09',
    },
    assigneeUser: '@dev', datesConfirmed: true,
  };
  const PAUSED_WEEK_PLAN_NOTE = `## 周排期

- 计划开始：2026-08-17
- 计划完成：2026-09-06
- 计划覆盖周：W34 ～ W36
- 自动 rollover：暂停`;

  it('validate rejects Story review without a Week Plan', () => {
    const { json, status } = cli('validate', {
      type: 'story', labels: ['type::story', 'story-status::待评审'], payload: reviewPayload,
    });
    expect(status).toBe(0);
    expect(json).toMatchObject({ ok: false, missing: ['weekPlan'] });
  });

  it('plan refuses invalid review input instead of returning WritePlan', () => {
    const { json, status } = cli('plan', {
      payload: { ...reviewPayload, weekPlan: { startDate: '2026-08-17', endDate: '2026-08-16', autoRollover: true } },
    });
    expect(status).toBe(1);
    expect(json).toMatchObject({ ok: false, missing: ['weekPlan'] });
    expect(json).not.toHaveProperty('ops');
  });

  it('plan renders a valid review Week Plan after validation', () => {
    const { json, status } = cli('plan', {
      payload: { ...reviewPayload, weekPlan: { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true } },
    });
    expect(status).toBe(0);
    expect(json).toMatchObject({ ops: expect.arrayContaining([
      expect.objectContaining({ kind: 'add_comment', body: expect.stringContaining('## 周排期') }),
    ]) });
  });

  it('validate and plan reject Story development entry with no latest Week Plan', () => {
    const input = { type: 'story', labels: ['type::story', 'story-status::已评审'], payload: developmentPayload };
    expect(cli('validate', input)).toMatchObject({ status: 0, json: { ok: false, missing: ['latestWeekPlan'] } });
    expect(cli('plan', { payload: developmentPayload })).toMatchObject({ status: 1, json: { ok: false, missing: ['latestWeekPlan'] } });
  });

  it('plan accepts a paused latest Week Plan for Story development entry', () => {
    const { json, status } = cli('plan', { payload: developmentPayload, notes: [{ body: PAUSED_WEEK_PLAN_NOTE }] });
    expect(status).toBe(0);
    expect(json).toHaveProperty('ops');
  });

  it.each([
    ['草稿中', '已评审'],
    ['待评审', '开发中'],
  ])('plan rejects invalid Story jump %s → %s before producing WritePlan', (from, to) => {
    const { json, status } = cli('plan', {
      payload: { ...reviewPayload, from, to },
    });
    expect(status).toBe(1);
    expect(json).toMatchObject({ ok: false, reasons: [expect.stringContaining('not allowed')] });
    expect(json).not.toHaveProperty('ops');
  });
});

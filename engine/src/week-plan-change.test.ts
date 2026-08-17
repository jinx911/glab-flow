import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const CLI = join(REPO_ROOT, 'engine', 'src', 'cli.ts');

function weekPlanChange(input: unknown): { json: unknown; status: number | null } {
  const result = spawnSync(TSX, [CLI, 'week-plan-change'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  return { json: result.stdout ? JSON.parse(result.stdout) : null, status: result.status };
}

describe('week-plan-change CLI', () => {
  const input = {
    iid: 321,
    weekPlan: { startDate: '2026-08-24', endDate: '2026-09-06', autoRollover: true },
    changeDate: '2026-08-20',
    originalPlan: '2026-08-17 至 2026-08-23',
    reason: '依赖接口延期',
    impact: '提测顺延一周',
    nextStep: '完成接口联调后提测',
    owner: '@dev',
  };

  it('prints exactly one immutable comment with the change facts and replacement Week Plan', () => {
    const { json, status } = weekPlanChange(input);
    expect(status).toBe(0);
    expect(json).toEqual({
      issueIid: 321,
      ops: [{
        kind: 'add_comment',
        body: [
          '## 排期变更',
          '',
          '- 变更日期：2026-08-20',
          '- 原排期：2026-08-17 至 2026-08-23',
          '- 变更原因：依赖接口延期',
          '- 影响：提测顺延一周',
          '- 后续动作：完成接口联调后提测',
          '- 负责人：@dev',
          '',
          '## 周排期',
          '',
          '- 计划开始：2026-08-24',
          '- 计划完成：2026-09-06',
          '- 计划覆盖周：W35 ～ W36',
          '- 自动 rollover：启用',
        ].join('\n'),
      }],
    });
  });

  it('rejects every missing or blank change fact', () => {
    for (const field of ['changeDate', 'originalPlan', 'reason', 'impact', 'nextStep', 'owner'] as const) {
      const { json, status } = weekPlanChange({ ...input, [field]: '   ' });
      expect(status).toBe(1);
      expect(json).toMatchObject({ ok: false, missing: [field] });
    }
  });

  it('rejects missing identity and an incomplete or invalid Week Plan before producing a WritePlan', () => {
    expect(weekPlanChange({ ...input, iid: 0 })).toMatchObject({ status: 1, json: { ok: false, missing: ['iid'] } });
    expect(weekPlanChange({ ...input, weekPlan: { startDate: '2026-08-24', autoRollover: true } })).toMatchObject({ status: 1, json: { ok: false, missing: ['weekPlan'] } });
    expect(weekPlanChange({ ...input, weekPlan: { startDate: '2026-08-24', endDate: '2026-08-23', autoRollover: true } })).toMatchObject({
      status: 1,
      json: { ok: false, reasons: [expect.stringContaining('计划完成不能早于计划开始')] },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { isoWeekCoverage, parseLatestWeekPlan, renderWeekPlan, validateWeekPlan } from './week-plan.js';

describe('Week Plan contract', () => {
  it('validates and renders a normal enabled plan with ISO-week coverage', () => {
    const result = validateWeekPlan({ start: '2026-08-17', end: '2026-09-06', autoRollover: true });
    expect(result).toEqual({
      ok: true,
      errors: [],
      plan: { start: '2026-08-17', end: '2026-09-06', coverage: 'W34 ～ W36', autoRollover: true },
    });
    if (!result.ok) throw new Error('expected valid plan');
    expect(renderWeekPlan(result.plan)).toBe([
      '## 周排期',
      '',
      '- 计划开始：2026-08-17',
      '- 计划完成：2026-09-06',
      '- 计划覆盖周：W34 ～ W36',
      '- 自动 rollover：启用',
    ].join('\n'));
  });

  it('formats ISO coverage across ISO years', () => {
    expect(isoWeekCoverage('2026-12-21', '2027-01-10')).toBe('2026-W52 ～ 2027-W01');
  });

  it('parses a paused latest block and accepts its optional coverage field', () => {
    const latest = parseLatestWeekPlan([{ body: [
      '## 周排期', '',
      '- 计划开始：2026-08-17',
      '- 计划完成：2026-08-23',
      '- 计划覆盖周：W34 ～ W34',
      '- 自动 rollover：暂停',
    ].join('\n') }]);
    expect(latest).toEqual({
      kind: 'valid-paused',
      plan: { start: '2026-08-17', end: '2026-08-23', coverage: 'W34 ～ W34', autoRollover: false },
      suppliedCoverage: 'W34 ～ W34',
    });
  });

  it('rejects non-calendar dates and an inverted date range', () => {
    expect(validateWeekPlan({ start: '2026-02-29', end: '2026-02-28', autoRollover: true })).toEqual({
      ok: false,
      errors: ['计划开始必须是有效的 YYYY-MM-DD 日期'],
    });
    expect(validateWeekPlan({ start: '2026-08-24', end: '2026-08-23', autoRollover: true })).toEqual({
      ok: false,
      errors: ['计划完成不能早于计划开始'],
    });
  });

  it('marks an incomplete latest block invalid', () => {
    expect(parseLatestWeekPlan([{ body: '## 周排期\n\n- 计划开始：2026-08-17\n- 自动 rollover：启用' }])).toEqual({
      kind: 'invalid-latest',
      errors: ['计划完成缺失'],
      input: { start: '2026-08-17', autoRollover: true },
    });
  });

  it('does not fall back to an older valid block when a newer one is invalid', () => {
    const notes = [
      { body: '## 周排期\n\n- 计划开始：2026-08-17\n- 计划完成：2026-08-23\n- 自动 rollover：启用' },
      { body: '## 周排期\n\n- 计划开始：invalid\n- 计划完成：2026-08-30\n- 自动 rollover：启用' },
    ];
    expect(parseLatestWeekPlan(notes)).toEqual({
      kind: 'invalid-latest',
      errors: ['计划开始必须是有效的 YYYY-MM-DD 日期'],
      input: { start: 'invalid', end: '2026-08-30', autoRollover: true },
    });
  });
});

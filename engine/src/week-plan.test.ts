import { describe, expect, it } from 'vitest';
import { isoWeekCoverage, parseLatestWeekPlan, renderWeekPlan, validateWeekPlan } from './week-plan.js';

describe('Week Plan contract', () => {
  it('validates and renders a normal enabled plan with engine-derived ISO-week coverage', () => {
    const input = { startDate: '2026-08-17', endDate: '2026-09-06', autoRollover: true };
    const result = validateWeekPlan(input);
    expect(result).toEqual({
      ok: true,
      errors: [],
      plan: { ...input, coverage: 'W34 ～ W36' },
    });
    expect(renderWeekPlan(input)).toBe([
      '## 周排期',
      '',
      '- 计划开始：2026-08-17',
      '- 计划完成：2026-09-06',
      '- 计划覆盖周：W34 ～ W36',
      '- 自动 rollover：启用',
    ].join('\n'));
  });

  it('formats ISO coverage across ISO years and preserves Week 53', () => {
    expect(isoWeekCoverage('2026-12-21', '2027-01-10')).toBe('2026-W52 ～ 2027-W01');
    expect(isoWeekCoverage('2026-12-28', '2027-01-03')).toBe('W53 ～ W53');
  });

  it('supports the real calendar lower boundary and rejects year 0000', () => {
    expect(validateWeekPlan({ startDate: '0001-01-01', endDate: '0001-01-07', autoRollover: false })).toEqual({
      ok: true,
      errors: [],
      plan: { startDate: '0001-01-01', endDate: '0001-01-07', coverage: 'W01 ～ W01', autoRollover: false },
    });
    expect(validateWeekPlan({ startDate: '0000-01-01', endDate: '0001-01-01', autoRollover: true })).toEqual({
      ok: false,
      errors: ['计划开始必须是有效的 YYYY-MM-DD 日期'],
    });
  });

  it('parses a paused latest block only when its recorded coverage matches', () => {
    const latest = parseLatestWeekPlan([{ body: [
      '## 周排期', '',
      '- 计划开始：2026-08-17',
      '- 计划完成：2026-08-23',
      '- 计划覆盖周：W34 ～ W34',
      '- 自动 rollover：暂停',
    ].join('\n') }]);
    expect(latest).toEqual({
      kind: 'valid-paused',
      plan: { startDate: '2026-08-17', endDate: '2026-08-23', coverage: 'W34 ～ W34', autoRollover: false },
    });
  });

  it('rejects non-calendar dates and an inverted date range', () => {
    expect(validateWeekPlan({ startDate: '2026-02-29', endDate: '2026-02-28', autoRollover: true })).toEqual({
      ok: false,
      errors: ['计划开始必须是有效的 YYYY-MM-DD 日期'],
    });
    expect(validateWeekPlan({ startDate: '2026-08-24', endDate: '2026-08-23', autoRollover: true })).toEqual({
      ok: false,
      errors: ['计划完成不能早于计划开始'],
    });
  });

  it('marks incomplete or coverage-mismatched latest blocks invalid', () => {
    expect(parseLatestWeekPlan([{ body: '## 周排期\n\n- 计划开始：2026-08-17\n- 自动 rollover：启用' }])).toEqual({
      kind: 'invalid-latest',
      errors: ['计划完成缺失', '计划覆盖周缺失'],
      input: { startDate: '2026-08-17', autoRollover: true },
    });
    expect(parseLatestWeekPlan([{ body: '## 周排期\n- 计划开始：2026-08-17\n- 计划完成：2026-08-23\n- 计划覆盖周：W35 ～ W35\n- 自动 rollover：启用' }])).toEqual({
      kind: 'invalid-latest',
      errors: ['计划覆盖周必须与计划日期的 ISO 周覆盖一致'],
      input: { startDate: '2026-08-17', endDate: '2026-08-23', coverage: 'W35 ～ W35', autoRollover: true },
    });
  });

  it('rejects duplicate required fields and malformed headings', () => {
    expect(parseLatestWeekPlan([{ body: [
      '## 周排期',
      '- 计划开始：2026-08-17',
      '- 计划开始：2026-08-18',
      '- 计划完成：2026-08-23',
      '- 计划覆盖周：W34 ～ W34',
      '- 自动 rollover：启用',
    ].join('\n') }])).toMatchObject({ kind: 'invalid-latest', errors: ['计划开始重复'] });
    expect(parseLatestWeekPlan([{ body: '##周排期\n- 计划开始：2026-08-17\n- 计划完成：2026-08-23\n- 计划覆盖周：W34 ～ W34\n- 自动 rollover：启用' }])).toMatchObject({
      kind: 'invalid-latest',
      errors: ['周排期标题格式无效'],
    });
  });

  it('does not treat a newline after ## as a valid Week Plan heading', () => {
    expect(parseLatestWeekPlan([{ body: '##\n周排期\n- 计划开始：2026-08-17' }])).toEqual({ kind: 'absent' });
  });

  it('does not fall back to an older valid block when a newer one is invalid', () => {
    const notes = [
      { body: '## 周排期\n\n- 计划开始：2026-08-17\n- 计划完成：2026-08-23\n- 计划覆盖周：W34 ～ W34\n- 自动 rollover：启用' },
      { body: '## 周排期\n\n- 计划开始：invalid\n- 计划完成：2026-08-30\n- 计划覆盖周：W35 ～ W35\n- 自动 rollover：启用' },
    ];
    expect(parseLatestWeekPlan(notes)).toEqual({
      kind: 'invalid-latest',
      errors: ['计划开始必须是有效的 YYYY-MM-DD 日期'],
      input: { startDate: 'invalid', endDate: '2026-08-30', coverage: 'W35 ～ W35', autoRollover: true },
    });
  });
});

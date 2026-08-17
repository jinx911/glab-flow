import type { LatestWeekPlan, WeekPlan, WeekPlanInput, WeekPlanValidation } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_PLAN_HEADER = /^##\s+周排期\s*$/m;
const HEADING_RE = /^#{1,6}\s+/m;

/** Validates a calendar date without relying on JavaScript's lenient Date parser. */
function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isoWeek(value: string): { year: number; week: number } {
  const [yearText, monthText, dayText] = value.split('-');
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: isoYear, week };
}

/** Returns the inclusive ISO-week endpoints, including ISO years only when needed. */
export function isoWeekCoverage(start: string, end: string): string {
  const first = isoWeek(start);
  const last = isoWeek(end);
  const firstWeek = `W${String(first.week).padStart(2, '0')}`;
  const lastWeek = `W${String(last.week).padStart(2, '0')}`;
  return first.year === last.year
    ? `${firstWeek} ～ ${lastWeek}`
    : `${first.year}-${firstWeek} ～ ${last.year}-${lastWeek}`;
}

export function validateWeekPlan(input: WeekPlanInput): WeekPlanValidation {
  const errors: string[] = [];
  const start = input.start;
  const end = input.end;

  if (!start) errors.push('计划开始缺失');
  else if (!isCalendarDate(start)) errors.push('计划开始必须是有效的 YYYY-MM-DD 日期');

  if (!end) errors.push('计划完成缺失');
  else if (!isCalendarDate(end)) errors.push('计划完成必须是有效的 YYYY-MM-DD 日期');

  if (typeof input.autoRollover !== 'boolean') errors.push('自动 rollover 必须为启用或暂停');
  if (start && end && isCalendarDate(start) && isCalendarDate(end) && end < start) {
    errors.push('计划完成不能早于计划开始');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    plan: {
      start: start!,
      end: end!,
      coverage: isoWeekCoverage(start!, end!),
      autoRollover: input.autoRollover!,
    },
  };
}

/** Renders the exact Harness Week Plan block from a valid structured plan. */
export function renderWeekPlan(plan: WeekPlan): string {
  return [
    '## 周排期',
    '',
    `- 计划开始：${plan.start}`,
    `- 计划完成：${plan.end}`,
    `- 计划覆盖周：${plan.coverage}`,
    `- 自动 rollover：${plan.autoRollover ? '启用' : '暂停'}`,
  ].join('\n');
}

function parseWeekPlanBlock(block: string): WeekPlanInput {
  const input: WeekPlanInput = {};
  for (const line of block.split('\n')) {
    const match = /^-\s*(计划开始|计划完成|计划覆盖周|自动 rollover)\s*：\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === '计划开始') input.start = value;
    else if (key === '计划完成') input.end = value;
    else if (key === '计划覆盖周') input.coverage = value;
    else input.autoRollover = value === '启用' ? true : value === '暂停' ? false : undefined;
  }
  return input;
}

function weekPlanBlocks(notes: { body: string }[]): string[] {
  const blocks: string[] = [];
  for (const note of notes) {
    const headers = [...note.body.matchAll(new RegExp(WEEK_PLAN_HEADER.source, 'gm'))];
    for (const header of headers) {
      const start = header.index! + header[0].length;
      const tail = note.body.slice(start);
      const nextHeader = HEADING_RE.exec(tail);
      blocks.push(tail.slice(0, nextHeader?.index));
    }
  }
  return blocks;
}

/**
 * Parses only the latest Week Plan in chronological note order. A malformed
 * latest block intentionally blocks use of any older valid schedule.
 */
export function parseLatestWeekPlan(notes: { body: string }[]): LatestWeekPlan {
  const blocks = weekPlanBlocks(notes);
  const latest = blocks.at(-1);
  if (latest === undefined) return { kind: 'absent' };

  const input = parseWeekPlanBlock(latest);
  const validation = validateWeekPlan(input);
  if (!validation.ok) return { kind: 'invalid-latest', errors: validation.errors, input };

  const suppliedCoverage = input.coverage;
  return validation.plan.autoRollover
    ? { kind: 'valid-enabled', plan: validation.plan, ...(suppliedCoverage ? { suppliedCoverage } : {}) }
    : { kind: 'valid-paused', plan: validation.plan, ...(suppliedCoverage ? { suppliedCoverage } : {}) };
}

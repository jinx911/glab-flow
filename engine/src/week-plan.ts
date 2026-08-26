import type { IssueNote, LatestWeekPlan, WeekPlan, WeekPlanInput, WeekPlanValidation } from './types.js';
import { chronologicalNotes } from './notes.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_PLAN_CANDIDATE_RE = /^#{1,6}[^\r\n]*周排期[^\r\n]*\r?$/gm;
const WEEK_PLAN_HEADER_RE = /^##[ \t]+周排期[ \t]*\r?$/;
const HEADING_RE = /^#{1,6}(?:[ \t]+|$)/m;

type ParsedWeekPlan = Partial<WeekPlanInput> & {
  coverage?: string;
  errors: string[];
};

interface WeekPlanBlock {
  body: string;
  malformedHeading: boolean;
}

/** Validates 0001–9999 calendar dates without JavaScript's 0–99 year mapping. */
function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const monthLengths = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1]!;
}

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function isoWeek(value: string): { year: number; week: number } {
  const [yearText, monthText, dayText] = value.split('-');
  const date = utcDate(Number(yearText), Number(monthText), Number(dayText));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = utcDate(isoYear, 1, 1);
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: isoYear, week };
}

/** Returns the inclusive ISO-week endpoints, including ISO years only when needed. */
export function isoWeekCoverage(startDate: string, endDate: string): string {
  const first = isoWeek(startDate);
  const last = isoWeek(endDate);
  const firstWeek = `W${String(first.week).padStart(2, '0')}`;
  const lastWeek = `W${String(last.week).padStart(2, '0')}`;
  return first.year === last.year
    ? `${firstWeek} ～ ${lastWeek}`
    : `${String(first.year).padStart(4, '0')}-${firstWeek} ～ ${String(last.year).padStart(4, '0')}-${lastWeek}`;
}

export function validateWeekPlan(input: WeekPlanInput): WeekPlanValidation {
  const errors: string[] = [];
  if (!isCalendarDate(input.startDate)) errors.push('计划开始必须是有效的 YYYY-MM-DD 日期');
  if (!isCalendarDate(input.endDate)) errors.push('计划完成必须是有效的 YYYY-MM-DD 日期');
  if (typeof input.autoRollover !== 'boolean') errors.push('自动 rollover 必须为启用或暂停');
  if (isCalendarDate(input.startDate) && isCalendarDate(input.endDate) && input.endDate < input.startDate) {
    errors.push('计划完成不能早于计划开始');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    plan: {
      ...input,
      coverage: isoWeekCoverage(input.startDate, input.endDate),
    },
  };
}

/** Renders only a validated plan; unsafe runtime input returns null without a heading. */
export function renderWeekPlan(plan: WeekPlan): string | null {
  const validation = validateWeekPlan(plan);
  if (!validation.ok || plan.coverage !== validation.plan.coverage) return null;
  return [
    '## 周排期',
    '',
    `- 计划开始：${plan.startDate}`,
    `- 计划完成：${plan.endDate}`,
    `- 计划覆盖周：${plan.coverage}`,
    `- 自动 rollover：${plan.autoRollover ? '启用' : '暂停'}`,
  ].join('\n');
}

function parseWeekPlanBlock(block: string): ParsedWeekPlan {
  const input: ParsedWeekPlan = { errors: [] };
  const seen = new Set<string>();
  for (const line of block.split('\n')) {
    const match = /^-[ \t]*(计划开始|计划完成|计划覆盖周|自动 rollover)[ \t]*：[ \t]*(.*?)[ \t]*\r?$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!key || value === undefined) continue;
    if (seen.has(key)) {
      input.errors.push(`${key}重复`);
      continue;
    }
    seen.add(key);
    if (key === '计划开始') input.startDate = value;
    else if (key === '计划完成') input.endDate = value;
    else if (key === '计划覆盖周') input.coverage = value;
    else if (value === '启用') input.autoRollover = true;
    else if (value === '暂停') input.autoRollover = false;
    else input.errors.push('自动 rollover 必须为启用或暂停');
  }
  return input;
}

function validateParsedWeekPlan(input: ParsedWeekPlan): string[] {
  const errors = [...input.errors];
  if (!input.startDate) errors.push('计划开始缺失');
  else if (!isCalendarDate(input.startDate)) errors.push('计划开始必须是有效的 YYYY-MM-DD 日期');
  if (!input.endDate) errors.push('计划完成缺失');
  else if (!isCalendarDate(input.endDate)) errors.push('计划完成必须是有效的 YYYY-MM-DD 日期');
  if (typeof input.autoRollover !== 'boolean' && !errors.includes('自动 rollover 必须为启用或暂停')) {
    errors.push('自动 rollover 必须为启用或暂停');
  }
  if (!input.coverage) errors.push('计划覆盖周缺失');
  if (input.startDate && input.endDate && isCalendarDate(input.startDate) && isCalendarDate(input.endDate)) {
    if (input.endDate < input.startDate) errors.push('计划完成不能早于计划开始');
    else if (input.coverage && input.coverage !== isoWeekCoverage(input.startDate, input.endDate)) {
      errors.push('计划覆盖周必须与计划日期的 ISO 周覆盖一致');
    }
  }
  return errors;
}

function weekPlanBlocks(notes: IssueNote[]): WeekPlanBlock[] {
  const blocks: WeekPlanBlock[] = [];
  for (const note of chronologicalNotes(notes)) {
    const headers = [...note.body.matchAll(WEEK_PLAN_CANDIDATE_RE)];
    for (const header of headers) {
      const start = header.index! + header[0].length;
      const tail = note.body.slice(start);
      const nextHeader = HEADING_RE.exec(tail);
      blocks.push({ body: tail.slice(0, nextHeader?.index), malformedHeading: !WEEK_PLAN_HEADER_RE.test(header[0]) });
    }
  }
  return blocks;
}

/**
 * Parses only the latest Week Plan in chronological note order. A malformed
 * latest block intentionally blocks use of any older valid schedule.
 */
export function parseLatestWeekPlan(notes: IssueNote[]): LatestWeekPlan {
  const latest = weekPlanBlocks(notes).at(-1);
  if (!latest) return { kind: 'absent' };

  const input = parseWeekPlanBlock(latest.body);
  const errors = latest.malformedHeading ? ['周排期标题格式无效', ...validateParsedWeekPlan(input)] : validateParsedWeekPlan(input);
  if (errors.length) {
    const { errors: _ignored, ...readback } = input;
    return { kind: 'invalid-latest', errors, input: readback };
  }

  const plan: WeekPlan = {
    startDate: input.startDate!,
    endDate: input.endDate!,
    autoRollover: input.autoRollover!,
    coverage: isoWeekCoverage(input.startDate!, input.endDate!),
  };
  return plan.autoRollover ? { kind: 'valid-enabled', plan } : { kind: 'valid-paused', plan };
}

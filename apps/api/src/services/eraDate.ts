/**
 * Japanese era (gengō) dates, for the registration check that the
 * applicant can write today's date as e.g. 令和8年11月19日.
 */

export interface EraDate {
  era: string;
  /** 1 for the first year of the era (written 元年). */
  eraYear: number;
  month: number;
  day: number;
}

interface Era {
  name: string;
  /** First Gregorian day of the era, as [year, month, day]. */
  start: readonly [number, number, number];
}

/** Modern eras, newest first. */
const ERAS: readonly Era[] = [
  { name: '令和', start: [2019, 5, 1] },
  { name: '平成', start: [1989, 1, 8] },
  { name: '昭和', start: [1926, 12, 25] },
  { name: '大正', start: [1912, 7, 30] },
  { name: '明治', start: [1868, 10, 23] },
];

function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** The era form of a Gregorian date, or null before the Meiji era. */
export function toEraDate(year: number, month: number, day: number): EraDate | null {
  const n = dayNumber(year, month, day);
  for (const era of ERAS) {
    const [sy, sm, sd] = era.start;
    if (n >= dayNumber(sy, sm, sd)) {
      return { era: era.name, eraYear: year - sy + 1, month, day };
    }
  }
  return null;
}

const ERA_DATE_RE = /^(令和|平成|昭和|大正|明治)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日$/u;

/**
 * Parses e.g. 令和8年11月19日 or 令和元年5月1日. Full-width digits are
 * accepted and whitespace is ignored. Full-width digits are mapped by
 * code point, not by NFKC, which this project never applies.
 */
export function parseEraDate(input: string): EraDate | null {
  const compact = input
    .replace(/[\uFF10-\uFF19]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/\s/gu, '');
  const m = ERA_DATE_RE.exec(compact);
  if (!m) return null;
  const [, era, year, month, day] = m;
  if (era === undefined || year === undefined || month === undefined || day === undefined) {
    return null;
  }
  return {
    era,
    eraYear: year === '元' ? 1 : Number(year),
    month: Number(month),
    day: Number(day),
  };
}

function sameEraDate(a: EraDate, b: EraDate): boolean {
  return a.era === b.era && a.eraYear === b.eraYear && a.month === b.month && a.day === b.day;
}

/**
 * Whether `input` is today's date in the Japanese era, allowing one day
 * either side of the UTC date: every time zone's local date is within
 * one day of UTC's.
 */
export function isTodayInEra(input: string, now: Date): boolean {
  const parsed = parseEraDate(input);
  if (!parsed) return false;
  for (const offset of [-1, 0, 1]) {
    const d = new Date(now.getTime() + offset * 86_400_000);
    const expected = toEraDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    if (expected && sameEraDate(parsed, expected)) return true;
  }
  return false;
}

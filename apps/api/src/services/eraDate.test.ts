import { describe, expect, it } from 'vitest';
import { isTodayInEra, parseEraDate, toEraDate } from './eraDate.js';

describe('toEraDate', () => {
  it('puts the first day of an era in year 1 of that era', () => {
    expect(toEraDate(2019, 5, 1)).toEqual({ era: '令和', eraYear: 1, month: 5, day: 1 });
    expect(toEraDate(2019, 4, 30)).toEqual({ era: '平成', eraYear: 31, month: 4, day: 30 });
  });

  it('counts years within an era from its starting Gregorian year', () => {
    expect(toEraDate(2026, 11, 19)).toEqual({ era: '令和', eraYear: 8, month: 11, day: 19 });
    expect(toEraDate(1989, 1, 7)).toEqual({ era: '昭和', eraYear: 64, month: 1, day: 7 });
  });
});

describe('parseEraDate', () => {
  it('parses half-width, full-width, and 元年 forms, ignoring whitespace', () => {
    const expected = { era: '令和', eraYear: 8, month: 11, day: 19 };
    expect(parseEraDate('令和8年11月19日')).toEqual(expected);
    expect(parseEraDate('令和８年１１月１９日')).toEqual(expected);
    expect(parseEraDate(' 令和 8年 11月 19日 ')).toEqual(expected);
    expect(parseEraDate('令和元年5月1日')).toEqual({ era: '令和', eraYear: 1, month: 5, day: 1 });
  });

  it('rejects Gregorian dates and unknown eras', () => {
    expect(parseEraDate('2026年11月19日')).toBeNull();
    expect(parseEraDate('2026-11-19')).toBeNull();
    expect(parseEraDate('慶応3年1月1日')).toBeNull();
  });
});

describe('isTodayInEra', () => {
  const now = new Date('2026-11-19T12:00:00Z');

  it('accepts today and one day either side', () => {
    expect(isTodayInEra('令和8年11月19日', now)).toBe(true);
    expect(isTodayInEra('令和8年11月18日', now)).toBe(true);
    expect(isTodayInEra('令和8年11月20日', now)).toBe(true);
  });

  it('rejects two days away, the wrong era, and the wrong year', () => {
    expect(isTodayInEra('令和8年11月17日', now)).toBe(false);
    expect(isTodayInEra('令和8年11月21日', now)).toBe(false);
    expect(isTodayInEra('平成38年11月19日', now)).toBe(false);
    expect(isTodayInEra('令和7年11月19日', now)).toBe(false);
  });

  it('accepts either era across an era boundary', () => {
    const boundary = new Date('2019-05-01T03:00:00Z');
    expect(isTodayInEra('平成31年4月30日', boundary)).toBe(true);
    expect(isTodayInEra('令和元年5月1日', boundary)).toBe(true);
  });
});

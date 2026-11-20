import { describe, expect, it } from 'vitest';
import { compareCodePoints } from './codePointOrder.js';

/** Reference order: lexicographic over the full code point sequence. */
function byCodePoint(a: string, b: string): number {
  const x = [...a].map((c) => c.codePointAt(0) ?? 0);
  const y = [...b].map((c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return x.length - y.length;
}

describe('compareCodePoints', () => {
  it('orders a compatibility ideograph (U+FA43) before an Extension B kanji (U+20B9F)', () => {
    const compat = 'k:\uFA43';
    const extB = 'k:\u{20B9F}';
    // UTF-16 code-unit order gets this backwards.
    expect(extB < compat).toBe(true);
    expect(compareCodePoints(compat, extB)).toBeLessThan(0);
    expect(compareCodePoints(extB, compat)).toBeGreaterThan(0);
  });

  it('agrees with code point order across BMP, compatibility, and astral characters', () => {
    const chars = [
      'a',
      'ニ',
      '日',
      '暑',
      '\uFA43',
      '\uFFEE',
      '\u{20000}',
      '\u{2A6DF}',
      '\u{30000}',
    ];
    const shuffled = [...chars].reverse();
    const expected = [...chars].sort(byCodePoint);
    expect(shuffled.sort(compareCodePoints)).toEqual(expected);
  });

  it('agrees with code point order on multi-character strings, including shared prefixes and shared high surrogates', () => {
    const parts = ['', 'k:', 'w:1', '日', '\uFA43', '\u{20000}', '\u{203FF}', '\u{2A6DF}'];
    const strings = parts.flatMap((a) => parts.flatMap((b) => parts.map((c) => a + b + c)));
    const expected = [...strings].sort(byCodePoint);
    expect([...strings].sort(compareCodePoints)).toEqual(expected);
  });

  it('orders a prefix before a longer string and treats equal strings as equal', () => {
    expect(compareCodePoints('w:12', 'w:123')).toBeLessThan(0);
    expect(compareCodePoints('k:日', 'k:日')).toBe(0);
  });
});

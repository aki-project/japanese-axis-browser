import { describe, expect, it } from 'vitest';
import { HIRAGANA_CHARS, KATAKANA_CHARS, foldKana, normalizeSearchKey } from './searchKey.js';

describe('foldKana', () => {
  it('folds katakana to hiragana and leaves everything else alone', () => {
    expect(foldKana('ニホン')).toBe('にほん');
    expect(foldKana('にほん')).toBe('にほん');
    expect(foldKana('日本 nihon')).toBe('日本 nihon');
  });

  it('does not touch half-width or full-width latin (no NFKC)', () => {
    expect(foldKana('ｶﾀｶﾅ')).toBe('ｶﾀｶﾅ');
    expect(foldKana('ＡＢＣ')).toBe('ＡＢＣ');
  });

  it('trims in normalizeSearchKey', () => {
    expect(normalizeSearchKey('  ニホン ')).toBe('にほん');
  });

  it('keeps the translate tables aligned', () => {
    expect([...KATAKANA_CHARS].length).toBe([...HIRAGANA_CHARS].length);
    expect(foldKana(KATAKANA_CHARS)).toBe(HIRAGANA_CHARS);
  });
});

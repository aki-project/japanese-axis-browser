/**
 * Kana folding for the search-key field.
 *
 * CLAUDE.md names `search_key` as the ONE place where hiragana/katakana
 * conversion may happen. This module is the single implementation of
 * that fold, shared by the pipeline (which writes `search_key`) and the
 * API (which normalizes queries against it), so the two can never drift.
 * NFKC is never applied here or anywhere else.
 */

const KATAKANA_START = 0x30a1; // ァ
const KATAKANA_END = 0x30f6; // ヶ
const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;

/** Folds full-width katakana to hiragana, code point by code point. */
export function foldKana(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp >= KATAKANA_START && cp <= KATAKANA_END) {
      out += String.fromCodePoint(cp - KATAKANA_TO_HIRAGANA_OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Normalizes a raw search query: trims surrounding whitespace and folds
 * katakana to hiragana. No NFKC, no case changes.
 */
export function normalizeSearchKey(input: string): string {
  return foldKana(input.trim());
}

/**
 * Parallel katakana/hiragana strings for SQL `translate()` when a
 * query-time fold is needed against columns other than search_key.
 */
export const KATAKANA_CHARS = Array.from(
  { length: KATAKANA_END - KATAKANA_START + 1 },
  (_, i) => String.fromCodePoint(KATAKANA_START + i),
).join('');

export const HIRAGANA_CHARS = Array.from(
  { length: KATAKANA_END - KATAKANA_START + 1 },
  (_, i) => String.fromCodePoint(KATAKANA_START + i - KATAKANA_TO_HIRAGANA_OFFSET),
).join('');

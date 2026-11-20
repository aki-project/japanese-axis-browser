/**
 * Compares two strings by Unicode code point, the order Postgres uses
 * for `COLLATE "C"` on a UTF8 database. JavaScript's `<` compares UTF-16
 * code units instead, which puts astral characters (CJK Extension B and
 * beyond, stored as surrogate pairs D800-DFFF) before BMP characters at
 * E000-FFFF such as the CJK compatibility ideographs. Link pagination
 * sorts in both SQL and JS, so both sides must use this one order.
 */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return codePointRank(x) - codePointRank(y);
  }
  return a.length - b.length;
}

/**
 * Maps a UTF-16 code unit so that comparing the first differing unit
 * gives code point order: surrogates move above E000-FFFF, which move
 * down to fill the gap.
 */
function codePointRank(unit: number): number {
  if (unit >= 0xd800 && unit <= 0xdfff) return unit + 0x2000;
  if (unit >= 0xe000) return unit - 0x800;
  return unit;
}

export type EntryKind = 'kanji' | 'word';
export type EntryId = `k:${string}` | `w:${string}`;

const ENTRY_ID_RE = /^(k|w):(.+)$/u;

export function kanjiEntryId(literal: string): EntryId {
  return `k:${literal}`;
}

export function wordEntryId(entSeq: number | string): EntryId {
  return `w:${entSeq}`;
}

export function parseEntryId(id: string): { kind: EntryKind; key: string } | null {
  const m = ENTRY_ID_RE.exec(id);
  if (!m) return null;
  const prefix = m[1];
  const key = m[2];
  if (key === undefined) return null;
  if (prefix === 'k') {
    // Exactly one code point: a single kanji literal.
    if ([...key].length !== 1) return null;
    return { kind: 'kanji', key };
  }
  if (!/^\d+$/.test(key)) return null;
  return { kind: 'word', key };
}

export function isEntryId(id: string): id is EntryId {
  return parseEntryId(id) !== null;
}

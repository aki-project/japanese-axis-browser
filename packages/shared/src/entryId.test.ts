import { describe, expect, it } from 'vitest';
import { isEntryId, kanjiEntryId, parseEntryId, wordEntryId } from './entryId.js';

describe('entry IDs', () => {
  it('builds and parses kanji IDs', () => {
    const id = kanjiEntryId('日');
    expect(id).toBe('k:日');
    expect(parseEntryId(id)).toEqual({ kind: 'kanji', key: '日' });
  });

  it('builds and parses word IDs', () => {
    const id = wordEntryId(1234567);
    expect(id).toBe('w:1234567');
    expect(parseEntryId(id)).toEqual({ kind: 'word', key: '1234567' });
  });

  it('rejects malformed IDs', () => {
    expect(parseEntryId('x:日')).toBeNull();
    expect(parseEntryId('k:日本')).toBeNull();
    expect(parseEntryId('k:')).toBeNull();
    expect(parseEntryId('w:abc')).toBeNull();
    expect(parseEntryId('日')).toBeNull();
    expect(isEntryId('w:1')).toBe(true);
  });

  it('handles astral-plane kanji as one code point', () => {
    expect(parseEntryId('k:𠮷')).toEqual({ kind: 'kanji', key: '𠮷' });
  });
});

import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, type LinkCursor } from './cursor.js';

const encodeRaw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('cursor', () => {
  it('round-trips per-relation positions, including a null weight', () => {
    const cursor: LinkCursor = {
      axis: 'structural',
      after: {
        shared_radical: { weight: 0.75, toEntryId: 'k:語' },
        contains_kanji: { weight: null, toEntryId: 'k:日' },
      },
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('round-trips a cursor with no positions', () => {
    const cursor: LinkCursor = { axis: 'semantic', after: {} };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('returns null for garbage input', () => {
    expect(decodeCursor('not-a-valid-cursor!!')).toBeNull();
    expect(
      decodeCursor(
        encodeRaw({ axis: 'semantic', after: { synonym: { weight: 'x', toEntryId: 'w:1' } } }),
      ),
    ).toBeNull();
    expect(decodeCursor(encodeRaw(null))).toBeNull();
    expect(decodeCursor(encodeRaw({ axis: 'semantic' }))).toBeNull();
  });

  it('returns null when the axis is not a known axis', () => {
    expect(decodeCursor(encodeRaw({ axis: 'nonsense', after: {} }))).toBeNull();
  });

  it("returns null for a relation that is not on the cursor's axis", () => {
    expect(
      decodeCursor(
        encodeRaw({ axis: 'semantic', after: { homophone: { weight: 1, toEntryId: 'w:1' } } }),
      ),
    ).toBeNull();
    expect(
      decodeCursor(
        encodeRaw({ axis: 'semantic', after: { nonsense: { weight: 1, toEntryId: 'w:1' } } }),
      ),
    ).toBeNull();
  });

  it('returns null for the old single-position cursor shape', () => {
    expect(
      decodeCursor(
        encodeRaw({ axis: 'semantic', relation: 'synonym', weight: 1, toEntryId: 'w:1' }),
      ),
    ).toBeNull();
  });
});

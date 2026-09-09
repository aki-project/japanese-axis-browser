import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

describe('cursor', () => {
  it('round-trips a cursor with a numeric weight', () => {
    const cursor = { axis: 'semantic' as const, relation: 'synonym' as const, weight: 0.75, toEntryId: 'w:1234' };
    const encoded = encodeCursor(cursor);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('round-trips a cursor with a null weight', () => {
    const cursor = { axis: 'structural' as const, relation: 'contains_kanji' as const, weight: null, toEntryId: 'k:日' };
    const encoded = encodeCursor(cursor);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('returns null for garbage input', () => {
    expect(decodeCursor('not-a-valid-cursor!!')).toBeNull();
    expect(decodeCursor(Buffer.from('{"weight": "x"}').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('null').toString('base64url'))).toBeNull();
  });

  it('returns null when the axis is not a known axis', () => {
    const encoded = Buffer.from(
      JSON.stringify({ axis: 'nonsense', relation: 'synonym', weight: 1, toEntryId: 'w:1' }),
    ).toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('returns null when the relation is not a known relation', () => {
    const encoded = Buffer.from(
      JSON.stringify({ axis: 'semantic', relation: 'nonsense', weight: 1, toEntryId: 'w:1' }),
    ).toString('base64url');
    expect(decodeCursor(encoded)).toBeNull();
  });
});

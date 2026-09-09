import { describe, expect, it } from 'vitest';
import {
  linkSchema,
  linkedEntrySchema,
  linksQuerySchema,
  searchQuerySchema,
  vocabularyItemSchema,
  type LinkedEntry,
} from './schemas.js';

describe('schemas', () => {
  it('keeps surface and reading separate on a word', () => {
    const word = vocabularyItemSchema.parse({
      entSeq: 1,
      surface: '日本',
      reading: 'にほん',
      alternateSurfaces: [],
      alternateReadings: ['にっぽん'],
      meanings: ['Japan'],
      partsOfSpeech: ['noun'],
      jlptLevel: 'N5',
      isCommon: true,
      audioUrl: null,
      searchKey: 'にほん',
    });
    expect(word.surface).toBe('日本');
    expect(word.reading).toBe('にほん');
  });

  it('rejects a link whose relation is not a known relation', () => {
    const r = linkSchema.safeParse({
      fromEntryId: 'k:日',
      toEntryId: 'k:本',
      axis: 'structural',
      relation: 'made_up',
      weight: null,
      source: 'test',
    });
    expect(r.success).toBe(false);
  });

  it('type-checks: Relation narrows to a literal union, not string', () => {
    // If relationSchema ever widens back to an unnarrowed string enum,
    // LinkedEntry['relation'] becomes plain `string` and the line below
    // stops being a type error, so the directive comment on the next
    // line would fail the typecheck build as "unused", catching the
    // regression.
    // @ts-expect-error not a member of the Relation union
    const bad: LinkedEntry['relation'] = 'not_a_relation';
    expect(typeof bad).toBe('string');
  });

  it('bounds linkedEntry weight to 0..1, same as link weight', () => {
    const r = linkedEntrySchema.safeParse({
      relation: 'synonym',
      weight: 1.5,
      entry: {
        entryId: 'w:1',
        kind: 'word',
        surface: '本',
        reading: 'ほん',
        meanings: ['book'],
        jlptLevel: null,
      },
    });
    expect(r.success).toBe(false);
  });

  it('defaults the links query to all axes and 50 items', () => {
    const q = linksQuerySchema.parse({});
    expect(q.axis).toEqual(['semantic', 'phonetic', 'structural']);
    expect(q.limit).toBe(50);
  });

  it('parses a comma-separated axis list', () => {
    const q = linksQuerySchema.parse({ axis: 'phonetic,structural' });
    expect(q.axis).toEqual(['phonetic', 'structural']);
  });

  it('accepts a cursor with exactly one axis', () => {
    const r = linksQuerySchema.safeParse({ axis: 'semantic', cursor: 'abc' });
    expect(r.success).toBe(true);
  });

  it('rejects a cursor supplied alongside more than one axis', () => {
    const r = linksQuerySchema.safeParse({ axis: 'semantic,phonetic', cursor: 'abc' });
    expect(r.success).toBe(false);
  });

  it('rejects a cursor supplied with the default (all axes)', () => {
    const r = linksQuerySchema.safeParse({ cursor: 'abc' });
    expect(r.success).toBe(false);
  });

  it('rejects a whitespace-only search query', () => {
    const r = searchQuerySchema.safeParse({ q: '   ' });
    expect(r.success).toBe(false);
  });

  it('accepts a search query with meaningful content and surrounding whitespace', () => {
    const r = searchQuerySchema.safeParse({ q: '  本  ' });
    expect(r.success).toBe(true);
  });
});

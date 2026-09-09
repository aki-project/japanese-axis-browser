import type { EntrySummary } from '@japanesesite/shared';
import { describe, expect, it } from 'vitest';
import { encodeCursor } from './cursor.js';
import { groupLinks, type FlatLinkRow } from './groupLinks.js';

function summary(entryId: string, surface: string): EntrySummary {
  return {
    entryId: entryId as EntrySummary['entryId'],
    kind: entryId.startsWith('k:') ? 'kanji' : 'word',
    surface,
    reading: surface,
    meanings: [surface],
    jlptLevel: null,
  };
}

describe('groupLinks', () => {
  it('returns empty relation lists and zero totals for no rows', () => {
    const result = groupLinks({
      rows: [],
      summaries: new Map(),
      axes: ['semantic', 'phonetic', 'structural'],
      limit: 50,
    });

    expect(result).toEqual([
      { axis: 'semantic', total: 0, relations: [], nextCursor: null },
      { axis: 'phonetic', total: 0, relations: [], nextCursor: null },
      { axis: 'structural', total: 0, relations: [], nextCursor: null },
    ]);
  });

  it('groups a single axis by relation, ordered by weight desc', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:2', weight: 0.5 },
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:3', weight: 0.9 },
      { axis: 'semantic', relation: 'antonym', toEntryId: 'w:4', weight: 0.1 },
    ];
    const summaries = new Map([
      ['w:2', summary('w:2', '二')],
      ['w:3', summary('w:3', '三')],
      ['w:4', summary('w:4', '四')],
    ]);

    const [semantic] = groupLinks({ rows, summaries, axes: ['semantic'], limit: 50 });

    expect(semantic).toBeDefined();
    expect(semantic?.total).toBe(3);
    expect(semantic?.nextCursor).toBeNull();
    expect(semantic?.relations.map((r) => r.relation)).toEqual(['synonym', 'antonym']);
    expect(semantic?.relations[0]?.entries.map((e) => e.entry.entryId)).toEqual(['w:3', 'w:2']);
  });

  it('breaks weight ties by toEntryId ascending', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'phonetic', relation: 'homophone', toEntryId: 'w:9', weight: 0.5 },
      { axis: 'phonetic', relation: 'homophone', toEntryId: 'w:1', weight: 0.5 },
      { axis: 'phonetic', relation: 'homophone', toEntryId: 'w:5', weight: 0.5 },
    ];
    const summaries = new Map([
      ['w:9', summary('w:9', '九')],
      ['w:1', summary('w:1', '一')],
      ['w:5', summary('w:5', '五')],
    ]);

    const [phonetic] = groupLinks({ rows, summaries, axes: ['phonetic'], limit: 50 });

    expect(phonetic?.relations[0]?.entries.map((e) => e.entry.entryId)).toEqual([
      'w:1',
      'w:5',
      'w:9',
    ]);
  });

  it('sorts null weights after any numeric weight', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'semantic', relation: 'see_also', toEntryId: 'w:1', weight: null },
      { axis: 'semantic', relation: 'see_also', toEntryId: 'w:2', weight: 0.1 },
    ];
    const summaries = new Map([
      ['w:1', summary('w:1', '一')],
      ['w:2', summary('w:2', '二')],
    ]);

    const [semantic] = groupLinks({ rows, summaries, axes: ['semantic'], limit: 50 });

    expect(semantic?.relations[0]?.entries.map((e) => e.entry.entryId)).toEqual(['w:2', 'w:1']);
  });

  it('paginates a single axis with limit=1, walking every row without skipping or repeating', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'structural', relation: 'has_component', toEntryId: 'k:一', weight: 0.9 },
      { axis: 'structural', relation: 'has_component', toEntryId: 'k:二', weight: 0.5 },
      { axis: 'structural', relation: 'has_component', toEntryId: 'k:三', weight: 0.1 },
    ];
    const summaries = new Map([
      ['k:一', summary('k:一', '一')],
      ['k:二', summary('k:二', '二')],
      ['k:三', summary('k:三', '三')],
    ]);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const [structural] = groupLinks({ rows, summaries, axes: ['structural'], limit: 1, cursor });
      const page = structural?.relations.flatMap((r) => r.entries) ?? [];
      expect(page.length).toBeLessThanOrEqual(1);
      for (const e of page) seen.push(e.entry.entryId);
      if (!structural?.nextCursor) break;
      cursor = structural.nextCursor;
    }

    expect(seen).toEqual(['k:一', 'k:二', 'k:三']);
  });

  it('drops rows whose target entry has no summary', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:1', weight: 0.5 },
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:missing', weight: 0.9 },
    ];
    const summaries = new Map([['w:1', summary('w:1', '一')]]);

    const [semantic] = groupLinks({ rows, summaries, axes: ['semantic'], limit: 50 });

    expect(semantic?.total).toBe(1);
    expect(semantic?.relations[0]?.entries).toHaveLength(1);
  });

  it('produces a cursor that resumes correctly when passed back in', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:1', weight: 0.9 },
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:2', weight: 0.5 },
    ];
    const summaries = new Map([
      ['w:1', summary('w:1', '一')],
      ['w:2', summary('w:2', '二')],
    ]);

    const [first] = groupLinks({ rows, summaries, axes: ['semantic'], limit: 1 });
    expect(first?.nextCursor).toBe(
      encodeCursor({ axis: 'semantic', relation: 'synonym', weight: 0.9, toEntryId: 'w:1' }),
    );

    const [second] = groupLinks({
      rows,
      summaries,
      axes: ['semantic'],
      limit: 1,
      cursor: first?.nextCursor ?? undefined,
    });
    expect(second?.relations[0]?.entries.map((e) => e.entry.entryId)).toEqual(['w:2']);
    expect(second?.nextCursor).toBeNull();
  });

  it('applies a cursor only to the axis it was issued for in a multi-axis request', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:1', weight: 0.9 },
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:2', weight: 0.5 },
      { axis: 'phonetic', relation: 'homophone', toEntryId: 'w:3', weight: 0.9 },
      { axis: 'phonetic', relation: 'homophone', toEntryId: 'w:4', weight: 0.5 },
    ];
    const summaries = new Map([
      ['w:1', summary('w:1', '一')],
      ['w:2', summary('w:2', '二')],
      ['w:3', summary('w:3', '三')],
      ['w:4', summary('w:4', '四')],
    ]);

    const firstPage = groupLinks({ rows, summaries, axes: ['semantic', 'phonetic'], limit: 1 });
    const semanticFirst = firstPage.find((a) => a.axis === 'semantic');
    const phoneticFirst = firstPage.find((a) => a.axis === 'phonetic');
    expect(semanticFirst?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId)).toEqual(
      ['w:1'],
    );
    expect(phoneticFirst?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId)).toEqual(
      ['w:3'],
    );

    // Continue with semantic's cursor while still requesting both axes.
    const secondPage = groupLinks({
      rows,
      summaries,
      axes: ['semantic', 'phonetic'],
      limit: 1,
      cursor: semanticFirst?.nextCursor ?? undefined,
    });
    const semanticSecond = secondPage.find((a) => a.axis === 'semantic');
    const phoneticSecond = secondPage.find((a) => a.axis === 'phonetic');

    // semantic correctly advances to its second item: no repeat, no skip.
    expect(
      semanticSecond?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId),
    ).toEqual(['w:2']);
    // phonetic is unaffected by a cursor that was never issued for it:
    // it is not silently advanced or emptied out.
    expect(
      phoneticSecond?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId),
    ).toEqual(['w:3']);

    // Across the two semantic pages, every row is seen exactly once.
    const semanticSeen = [
      ...(semanticFirst?.relations.flatMap((r) => r.entries) ?? []),
      ...(semanticSecond?.relations.flatMap((r) => r.entries) ?? []),
    ].map((e) => e.entry.entryId);
    expect(semanticSeen).toEqual(['w:1', 'w:2']);
  });

  it('uses an authoritative total instead of rows.length when the caller supplies a partial page', () => {
    // Simulates a hub-backed relation where the caller only fetched one
    // page's worth of rows (see apps/api/src/db/queries.ts), but the
    // true count (e.g. from getLinkCounts) is larger.
    const rows: FlatLinkRow[] = [
      { axis: 'structural', relation: 'shared_radical', toEntryId: 'k:一', weight: 0.5 },
    ];
    const summaries = new Map([['k:一', summary('k:一', '一')]]);

    const [structural] = groupLinks({
      rows,
      summaries,
      axes: ['structural'],
      limit: 1,
      totals: { structural: 3 },
    });

    expect(structural?.total).toBe(3);
    // hasMore is derived from the authoritative total, not rows.length,
    // so a nextCursor is still produced even though only one row was
    // supplied.
    expect(structural?.nextCursor).not.toBeNull();
  });

  it('falls back to counting rows when no total is supplied for an axis', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:1', weight: 0.5 },
      { axis: 'semantic', relation: 'synonym', toEntryId: 'w:2', weight: 0.4 },
    ];
    const summaries = new Map([
      ['w:1', summary('w:1', '一')],
      ['w:2', summary('w:2', '二')],
    ]);

    const [semantic] = groupLinks({ rows, summaries, axes: ['semantic'], limit: 50, totals: {} });
    expect(semantic?.total).toBe(2);
  });

  it('walks every row via limit=1 even when two rows share (weight, toEntryId) under different relations', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'phonetic', relation: 'homophone', toEntryId: 'w:1', weight: 0.5 },
      { axis: 'phonetic', relation: 'shared_on_reading', toEntryId: 'w:1', weight: 0.5 },
    ];
    const summaries = new Map([['w:1', summary('w:1', '一')]]);

    const seen: Array<{ entryId: string; relation: string }> = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const [phonetic] = groupLinks({ rows, summaries, axes: ['phonetic'], limit: 1, cursor });
      const page =
        phonetic?.relations.flatMap((r) =>
          r.entries.map((e) => ({ entryId: e.entry.entryId, relation: e.relation })),
        ) ?? [];
      expect(page.length).toBeLessThanOrEqual(1);
      seen.push(...page);
      if (!phonetic?.nextCursor) break;
      cursor = phonetic.nextCursor;
    }

    expect(seen).toHaveLength(rows.length);
    expect(seen).toEqual(
      expect.arrayContaining([
        { entryId: 'w:1', relation: 'homophone' },
        { entryId: 'w:1', relation: 'shared_on_reading' },
      ]),
    );
  });
});

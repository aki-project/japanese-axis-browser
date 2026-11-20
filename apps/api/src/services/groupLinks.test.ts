import type { EntrySummary } from '@japanesesite/shared';
import { describe, expect, it } from 'vitest';
import { encodeCursor } from './cursor.js';
import { allocateQuotas, groupLinks, type FlatLinkRow } from './groupLinks.js';

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
      encodeCursor({ axis: 'semantic', after: { synonym: { weight: 0.9, toEntryId: 'w:1' } } }),
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

  it('reports the authoritative total and offers another page when the caller supplies limit + 1 rows', () => {
    // Simulates a hub-backed relation where the caller fetched only
    // limit + 1 rows (see apps/api/src/db/queries.ts), while the true
    // count (e.g. from getLinkCounts) is larger.
    const rows: FlatLinkRow[] = [
      { axis: 'structural', relation: 'shared_radical', toEntryId: 'k:一', weight: 0.5 },
      { axis: 'structural', relation: 'shared_radical', toEntryId: 'k:二', weight: 0.4 },
    ];
    const summaries = new Map([
      ['k:一', summary('k:一', '一')],
      ['k:二', summary('k:二', '二')],
    ]);

    const [structural] = groupLinks({
      rows,
      summaries,
      axes: ['structural'],
      limit: 1,
      totals: { structural: 3 },
    });

    expect(structural?.total).toBe(3);
    expect(structural?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId)).toEqual([
      'k:一',
    ]);
    expect(structural?.nextCursor).not.toBeNull();
  });

  it('offers no further page when only `limit` rows follow the cursor, even if total is larger', () => {
    // The last page of a cursor-filtered family relation: the caller
    // supplies only the rows after the cursor, so `total` (3) exceeds
    // what is here, yet nothing follows this page.
    const rows: FlatLinkRow[] = [
      { axis: 'structural', relation: 'shared_radical', toEntryId: 'k:三', weight: 0.3 },
    ];
    const summaries = new Map([['k:三', summary('k:三', '三')]]);
    const cursor = encodeCursor({
      axis: 'structural',
      after: { shared_radical: { weight: 0.4, toEntryId: 'k:二' } },
    });

    const [structural] = groupLinks({
      rows,
      summaries,
      axes: ['structural'],
      limit: 1,
      cursor,
      totals: { structural: 3 },
    });

    expect(structural?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId)).toEqual([
      'k:三',
    ]);
    expect(structural?.nextCursor).toBeNull();
  });

  it('pages pairwise and family rows together, each relation resuming from its own position', () => {
    // Pairwise rows are complete (both sides of the cursor); family rows
    // arrive as the SQL gives them: only rows after their relation's
    // position, at most limit + 1. The cursor has seen see_also w:1 and
    // synonym w:2, and nothing of antonym yet.
    const pairwise: FlatLinkRow[] = [
      { axis: 'semantic', relation: 'see_also', toEntryId: 'w:1', weight: 0.9 },
      { axis: 'semantic', relation: 'see_also', toEntryId: 'w:3', weight: 0.5 },
      { axis: 'semantic', relation: 'antonym', toEntryId: 'w:6', weight: 0.2 },
    ];
    const summaries = new Map(
      ['w:1', 'w:2', 'w:3', 'w:4', 'w:5', 'w:6', 'w:7'].map((id) => [id, summary(id, id)] as const),
    );
    const cursor = encodeCursor({
      axis: 'semantic',
      after: {
        see_also: { weight: 0.9, toEntryId: 'w:1' },
        synonym: { weight: 0.7, toEntryId: 'w:2' },
      },
    });
    const page = (familyAfterCursor: FlatLinkRow[]) => {
      const [semantic] = groupLinks({
        rows: [...pairwise, ...familyAfterCursor],
        summaries,
        axes: ['semantic'],
        limit: 3,
        cursor,
        totals: { semantic: 8 },
      });
      return {
        ids: semantic?.relations.flatMap((r) =>
          r.entries.map((e) => `${e.relation}:${e.entry.entryId}`),
        ),
        nextCursor: semantic?.nextCursor ?? null,
      };
    };
    const synonym = (toEntryId: string, weight: number): FlatLinkRow => ({
      axis: 'semantic',
      relation: 'synonym',
      toEntryId,
      weight,
    });

    // Three relations have rows left, so each gets one of the 3 slots.
    const full = page([
      synonym('w:3', 0.6),
      synonym('w:4', 0.5),
      synonym('w:5', 0.4),
      synonym('w:7', 0.3),
    ]);
    expect(full.ids).toEqual(['synonym:w:3', 'antonym:w:6', 'see_also:w:3']);
    expect(full.nextCursor).not.toBeNull();

    // Exactly one row per relation remains: this is the last page.
    const last = page([synonym('w:3', 0.6)]);
    expect(last.ids).toEqual(['synonym:w:3', 'antonym:w:6', 'see_also:w:3']);
    expect(last.nextCursor).toBeNull();
  });

  it('splits the first page evenly between relations instead of taking the top weights overall', () => {
    const rows: FlatLinkRow[] = [
      ...[1, 2, 3, 4, 5, 6].map((n): FlatLinkRow => ({
        axis: 'phonetic',
        relation: 'shared_kun_reading',
        toEntryId: `w:k${n}`,
        weight: 0.9,
      })),
      ...[1, 2, 3].map((n): FlatLinkRow => ({
        axis: 'phonetic',
        relation: 'shared_on_reading',
        toEntryId: `w:o${n}`,
        weight: 0.1,
      })),
    ];
    const summaries = new Map(
      rows.map((r) => [r.toEntryId, summary(r.toEntryId, r.toEntryId)] as const),
    );

    const [phonetic] = groupLinks({ rows, summaries, axes: ['phonetic'], limit: 4 });

    expect(phonetic?.relations.map((r) => [r.relation, r.entries.length])).toEqual([
      ['shared_on_reading', 2],
      ['shared_kun_reading', 2],
    ]);
    expect(phonetic?.nextCursor).not.toBeNull();
  });

  it('walks every row of several uneven relations with no skips or repeats', () => {
    const rows: FlatLinkRow[] = [
      ...Array.from({ length: 7 }, (_, n): FlatLinkRow => ({
        axis: 'structural',
        relation: 'shared_radical',
        toEntryId: `k:r${n}`,
        weight: n % 2 ? 0.5 : null,
      })),
      { axis: 'structural', relation: 'has_component', toEntryId: 'k:c', weight: 0.8 },
      ...Array.from({ length: 3 }, (_, n): FlatLinkRow => ({
        axis: 'structural',
        relation: 'contains_kanji',
        toEntryId: `k:r${n}`,
        weight: 0.3,
      })),
    ];
    const summaries = new Map(
      rows.map((r) => [r.toEntryId, summary(r.toEntryId, r.toEntryId)] as const),
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const [structural] = groupLinks({ rows, summaries, axes: ['structural'], limit: 4, cursor });
      const page =
        structural?.relations.flatMap((r) =>
          r.entries.map((e) => `${e.relation}:${e.entry.entryId}`),
        ) ?? [];
      if (structural?.nextCursor) expect(page).toHaveLength(4);
      seen.push(...page);
      if (!structural?.nextCursor) break;
      cursor = structural.nextCursor;
    }

    expect(seen).toHaveLength(rows.length);
    expect(new Set(seen).size).toBe(rows.length);
  });

  it('carries a row\'s shared hub labels through as `via`, defaulting to none', () => {
    const rows: FlatLinkRow[] = [
      { axis: 'phonetic', relation: 'shared_on_reading', toEntryId: 'k:二', weight: 0.9, via: ['ニ'] },
      { axis: 'phonetic', relation: 'shared_on_reading', toEntryId: 'k:三', weight: 0.5 },
    ];
    const summaries = new Map([
      ['k:二', summary('k:二', '二')],
      ['k:三', summary('k:三', '三')],
    ]);
    const [phonetic] = groupLinks({ rows, summaries, axes: ['phonetic'], limit: 50 });
    expect(phonetic?.relations[0]?.entries.map((e) => e.via)).toEqual([['ニ'], []]);
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

describe('allocateQuotas', () => {
  it('gives each relation with rows an equal share of the page', () => {
    expect(allocateQuotas([100, 100, 100], 30)).toEqual([10, 10, 10]);
  });

  it('gives the leftover of an uneven split one each to the earliest relations', () => {
    expect(allocateQuotas([100, 100, 100], 50)).toEqual([17, 17, 16]);
  });

  it('gives an empty relation nothing and splits the page among the rest', () => {
    expect(allocateQuotas([0, 100, 100], 50)).toEqual([0, 25, 25]);
  });

  it("passes a short relation's unused share to the others", () => {
    expect(allocateQuotas([2, 100, 100], 50)).toEqual([2, 24, 24]);
    expect(allocateQuotas([2, 5, 100], 50)).toEqual([2, 5, 43]);
  });

  it('never allocates more than is available', () => {
    expect(allocateQuotas([3, 4], 50)).toEqual([3, 4]);
    expect(allocateQuotas([], 50)).toEqual([]);
  });

  it('handles a page smaller than the number of relations', () => {
    expect(allocateQuotas([5, 5, 5], 2)).toEqual([1, 1, 0]);
  });
});

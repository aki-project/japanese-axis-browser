import type { EntrySummary } from '@japanesesite/shared';
import { describe, expect, it } from 'vitest';
import { mergeSearchResults, type TieredEntry } from './searchRanking.js';

function summary(entryId: string, kind: 'kanji' | 'word'): EntrySummary {
  return {
    entryId: entryId as EntrySummary['entryId'],
    kind,
    surface: entryId,
    reading: entryId,
    meanings: [entryId],
    jlptLevel: null,
  };
}

function kanjiEntry(id: string, tier: number): TieredEntry {
  return { tier, summary: summary(id, 'kanji') };
}
function wordEntry(id: string, tier: number): TieredEntry {
  return { tier, summary: summary(id, 'word') };
}

describe('mergeSearchResults', () => {
  it('returns an empty list when there are no candidates', () => {
    expect(mergeSearchResults([], [], 20)).toEqual([]);
  });

  it('returns an empty list for a non-positive limit', () => {
    const kanji = [kanjiEntry('k:1', 0)];
    expect(mergeSearchResults(kanji, [], 0)).toEqual([]);
  });

  it('returns only kanji when there are no word matches', () => {
    const kanji = [kanjiEntry('k:1', 0), kanjiEntry('k:2', 0)];
    const out = mergeSearchResults(kanji, [], 10);
    expect(out.map((e) => e.entryId)).toEqual(['k:1', 'k:2']);
  });

  it('returns only words when there are no kanji matches', () => {
    const words = [wordEntry('w:1', 0), wordEntry('w:2', 1)];
    const out = mergeSearchResults([], words, 10);
    expect(out.map((e) => e.entryId)).toEqual(['w:1', 'w:2']);
  });

  it('orders by tier ascending, interleaving kanji and words within a tier (kanji first)', () => {
    const kanji = [kanjiEntry('k:1', 0), kanjiEntry('k:2', 1)];
    const words = [wordEntry('w:1', 0), wordEntry('w:2', 1)];
    const out = mergeSearchResults(kanji, words, 10);
    expect(out.map((e) => e.entryId)).toEqual(['k:1', 'w:1', 'k:2', 'w:2']);
  });

  it('truncates the merged list at limit', () => {
    const kanji = [kanjiEntry('k:1', 0), kanjiEntry('k:2', 1)];
    const words = [wordEntry('w:1', 0), wordEntry('w:2', 1)];
    const out = mergeSearchResults(kanji, words, 2);
    expect(out.map((e) => e.entryId)).toEqual(['k:1', 'w:1']);
  });

  it('reserves at least floor(limit/4) slots for the minority kind even when it ranks lower', () => {
    // 10 tier-0 kanji crowd out a single, weak (tier-3) word match: a
    // naive tier-ordered truncation at limit=4 would return 4 kanji and
    // drop the word entirely.
    const kanji = Array.from({ length: 10 }, (_, i) => kanjiEntry(`k:${i}`, 0));
    const words = [wordEntry('w:1', 3)];

    const out = mergeSearchResults(kanji, words, 4);

    expect(out).toHaveLength(4);
    expect(out.map((e) => e.entryId)).toContain('w:1');
    // The word still appears in its natural (lowest-ranked) position:
    // reservation guarantees inclusion, not an inflated rank.
    expect(out[out.length - 1]?.entryId).toBe('w:1');
    expect(out.slice(0, 3).map((e) => e.entryId)).toEqual(['k:0', 'k:1', 'k:2']);
  });

  it('reserves slots symmetrically when words crowd out kanji', () => {
    const words = Array.from({ length: 10 }, (_, i) => wordEntry(`w:${i}`, 0));
    const kanji = [kanjiEntry('k:1', 3)];

    const out = mergeSearchResults(kanji, words, 4);

    expect(out).toHaveLength(4);
    expect(out.map((e) => e.entryId)).toContain('k:1');
  });

  it('does not over-reserve when a kind has fewer matches than the reservation', () => {
    const kanji = [kanjiEntry('k:1', 0)];
    const words = Array.from({ length: 20 }, (_, i) => wordEntry(`w:${i}`, 0));

    const out = mergeSearchResults(kanji, words, 8);

    expect(out).toHaveLength(8);
    expect(out.map((e) => e.entryId)).toContain('k:1');
  });
});

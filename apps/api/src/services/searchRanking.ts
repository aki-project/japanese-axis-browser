import type { EntrySummary } from '@japanesesite/shared';

/**
 * One search candidate with its SQL-computed rank tier (0 = exact,
 * 1 = prefix, 2 = word-boundary meaning match, 3 = substring). Rows of
 * the same kind must already arrive ordered: tier ascending, then that
 * kind's own secondary order (see queries.ts's searchEntries).
 */
export interface TieredEntry {
  tier: number;
  summary: EntrySummary;
}

/**
 * Merges ranked kanji and word candidates into a single result list.
 *
 * Rather than concatenating kanji then words and truncating (which
 * would silently hide every word match whenever there are `limit` or
 * more higher-ranked kanji matches, or vice versa), this:
 *
 *  1. Builds the "natural" merged order: tier by tier, ascending,
 *     interleaving one kanji and one word candidate at a time within
 *     each tier (kanji first).
 *  2. Reserves at least `floor(limit / 4)` slots for each kind, as
 *     long as that kind actually has that many matches, so a search
 *     with matches of both kinds never returns only one kind just
 *     because the other kind's matches happened to rank higher.
 *  3. Outputs the selected items in the natural merged order.
 */
export function mergeSearchResults(
  kanji: readonly TieredEntry[],
  words: readonly TieredEntry[],
  limit: number,
): EntrySummary[] {
  if (limit <= 0) return [];

  const natural = buildNaturalOrder(kanji, words);

  const reserve = Math.floor(limit / 4);
  const reserveKanji = kanji.length > 0 ? Math.min(reserve, kanji.length) : 0;
  const reserveWord = words.length > 0 ? Math.min(reserve, words.length) : 0;

  const reservedKanji = new Set(kanji.slice(0, reserveKanji).map((e) => e.summary));
  const reservedWords = new Set(words.slice(0, reserveWord).map((e) => e.summary));
  const isReserved = (kind: 'kanji' | 'word', entry: EntrySummary): boolean =>
    kind === 'kanji' ? reservedKanji.has(entry) : reservedWords.has(entry);

  const selected = new Set<EntrySummary>();

  // Pass 1: lock in each kind's reserved minimum.
  for (const { kind, entry } of natural) {
    if (selected.size >= limit) break;
    if (isReserved(kind, entry)) selected.add(entry);
  }
  // Pass 2: fill the remaining budget in natural (tier-interleaved) order.
  for (const { entry } of natural) {
    if (selected.size >= limit) break;
    selected.add(entry);
  }

  return natural.filter((n) => selected.has(n.entry)).map((n) => n.entry);
}

interface NaturalEntry {
  kind: 'kanji' | 'word';
  entry: EntrySummary;
}

/** Tier-ascending order, interleaving one kanji then one word per tier. */
function buildNaturalOrder(
  kanji: readonly TieredEntry[],
  words: readonly TieredEntry[],
): NaturalEntry[] {
  const kanjiByTier = groupByTier(kanji);
  const wordsByTier = groupByTier(words);
  const tiers = [...new Set([...kanjiByTier.keys(), ...wordsByTier.keys()])].sort((a, b) => a - b);

  const natural: NaturalEntry[] = [];
  for (const tier of tiers) {
    const k = kanjiByTier.get(tier) ?? [];
    const w = wordsByTier.get(tier) ?? [];
    const max = Math.max(k.length, w.length);
    for (let i = 0; i < max; i++) {
      const kEntry = k[i];
      const wEntry = w[i];
      if (kEntry) natural.push({ kind: 'kanji', entry: kEntry });
      if (wEntry) natural.push({ kind: 'word', entry: wEntry });
    }
  }
  return natural;
}

function groupByTier(rows: readonly TieredEntry[]): Map<number, EntrySummary[]> {
  const map = new Map<number, EntrySummary[]>();
  for (const row of rows) {
    const list = map.get(row.tier) ?? [];
    list.push(row.summary);
    map.set(row.tier, list);
  }
  return map;
}

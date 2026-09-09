import type { EntryId, JlptLevel, Link, Relation, VocabularyItem } from '@japanesesite/shared';

/**
 * Appends every element of `src` onto `dest` without spreading (spread
 * push blows the call stack once an array reaches tens of thousands of
 * elements, which several of our link groups do).
 */
export function pushAll<T>(dest: T[], src: readonly T[]): void {
  for (const item of src) dest.push(item);
}

/** Pushes both directions of a symmetric relation (A rel B implies B rel A). */
export function addSymmetric(
  out: Link[],
  a: EntryId,
  b: EntryId,
  axis: Link['axis'],
  relation: Relation,
  weight: number | null,
  source: string,
): void {
  if (a === b) return;
  out.push({ fromEntryId: a, toEntryId: b, axis, relation, weight, source });
  out.push({ fromEntryId: b, toEntryId: a, axis, relation, weight, source });
}

/** Pushes an asymmetric relation pair: a -relForward-> b and b -relBackward-> a. */
export function addDirectedPair(
  out: Link[],
  a: EntryId,
  b: EntryId,
  axis: Link['axis'],
  relForward: Relation,
  relBackward: Relation,
  weight: number | null,
  source: string,
): void {
  if (a === b) return;
  out.push({ fromEntryId: a, toEntryId: b, axis, relation: relForward, weight, source });
  out.push({ fromEntryId: b, toEntryId: a, axis, relation: relBackward, weight, source });
}

const WEIGHT_FLOOR = -1; // null sorts below any real (0..1) weight, consistently everywhere

function weightRank(weight: number | null): number {
  return weight ?? WEIGHT_FLOOR;
}

/**
 * Deduplicates on (from, to, axis, relation), keeping the highest
 * weight seen for that key (nulls sort below any number - see
 * `weightRank`).
 */
export function dedupeLinks(links: Link[]): Link[] {
  const byKey = new Map<string, Link>();
  for (const link of links) {
    const key = `${link.fromEntryId} ${link.toEntryId} ${link.axis} ${link.relation}`;
    const existing = byKey.get(key);
    if (!existing || weightRank(link.weight) > weightRank(existing.weight)) {
      byKey.set(key, link);
    }
  }
  return [...byKey.values()];
}

/**
 * Relations that are an intentionally asymmetric directed pair (a
 * different relation name in each direction: contains_kanji/contained_in,
 * has_component/component_of). Every other relation is "mutual" - the
 * same relation name is valid read in either direction - and those are
 * the ones `symmetrizeLinks` below is allowed to mirror.
 */
const DIRECTED_PAIR_RELATIONS: ReadonlySet<Relation> = new Set([
  'contains_kanji',
  'contained_in',
  'has_component',
  'component_of',
]);

/**
 * CLAUDE.md: "Emit every link once per direction so the API can look up
 * by from_entry_id alone." Most relations are built that way from the
 * start (addSymmetric, or a directed pair emitted together), but a
 * per-entry cap (shared_on_reading, shared_radical, shared_sense, ...)
 * is computed independently for each side of a pair and can therefore
 * keep A -> B while dropping B -> A. This pass finds every "mutual"
 * relation link with no reverse and adds one, carrying over the same
 * weight and source. Must run after the final dedup, so it sees the
 * true surviving edge set.
 */
export function symmetrizeLinks(links: Link[]): { links: Link[]; added: number } {
  const existing = new Set(
    links.map((l) => `${l.fromEntryId} ${l.toEntryId} ${l.axis} ${l.relation}`),
  );
  const added: Link[] = [];
  for (const link of links) {
    if (DIRECTED_PAIR_RELATIONS.has(link.relation)) continue;
    if (link.fromEntryId === link.toEntryId) continue;
    const reverseKey = `${link.toEntryId} ${link.fromEntryId} ${link.axis} ${link.relation}`;
    if (existing.has(reverseKey)) continue;
    existing.add(reverseKey); // don't add the same mirror twice
    added.push({
      fromEntryId: link.toEntryId,
      toEntryId: link.fromEntryId,
      axis: link.axis,
      relation: link.relation,
      weight: link.weight,
      source: link.source,
    });
  }
  return { links: [...links, ...added], added: added.length };
}

/**
 * word JLPT/commonness tier, used both for contains_kanji/contained_in
 * weight and for a homophone link's weight (which uses the *partner*
 * word's tier - see buildPhoneticLinks).
 */
export function wordWeightTier(word: Pick<VocabularyItem, 'jlptLevel' | 'isCommon'>): number {
  const byLevel: Partial<Record<JlptLevel, number>> = {
    N5: 1.0,
    N4: 0.95,
    N3: 0.9,
    N2: 0.85,
    N1: 0.8,
  };
  if (word.jlptLevel && word.jlptLevel in byLevel) {
    return byLevel[word.jlptLevel] as number;
  }
  return word.isCommon ? 0.7 : 0.5;
}

/**
 * Word hub rank: N5 is the most useful tier to see first, N1 least
 * (among leveled words); is_common words with no JLPT level sort after
 * every leveled word, and everything else sorts last. Used for every
 * word-side hub (reading/homophone, synset/synonym, gloss/shared_sense)
 * - see CLAUDE.md's rank spec for hubs.
 */
const WORD_HUB_RANK_BY_LEVEL: Partial<Record<JlptLevel, number>> = {
  N5: 0,
  N4: 100,
  N3: 200,
  N2: 300,
  N1: 400,
};

export function wordHubRank(word: Pick<VocabularyItem, 'jlptLevel' | 'isCommon'>): number {
  if (word.jlptLevel && word.jlptLevel in WORD_HUB_RANK_BY_LEVEL) {
    return WORD_HUB_RANK_BY_LEVEL[word.jlptLevel] as number;
  }
  return word.isCommon ? 700 : 1500;
}

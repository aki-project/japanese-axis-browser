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
 * `weightRank`, shared with `capPerEntry` so the two never disagree).
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
 * Caps the outgoing links for each `from` entry to `limit`, keeping the
 * highest-weight neighbors (ties broken by `to_entry_id` ascending for
 * determinism). Only meant to be applied to a single (axis, relation)
 * slice at a time.
 */
export function capPerEntry(links: Link[], limit: number): Link[] {
  const byFrom = new Map<string, Link[]>();
  for (const link of links) {
    const arr = byFrom.get(link.fromEntryId) ?? [];
    arr.push(link);
    byFrom.set(link.fromEntryId, arr);
  }
  const out: Link[] = [];
  for (const arr of byFrom.values()) {
    arr.sort((x, y) => {
      const dw = weightRank(y.weight) - weightRank(x.weight);
      if (dw !== 0) return dw;
      return x.toEntryId < y.toEntryId ? -1 : x.toEntryId > y.toEntryId ? 1 : 0;
    });
    pushAll(out, arr.slice(0, limit));
  }
  return out;
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

const FREQUENCY_RANK_CEILING = 2500;

/**
 * Scales a relation's base weight by how frequent the *partner* kanji
 * is: weight = base * (1 - 0.5 * min(rank, 2500) / 2500) when a
 * frequency is known (rank 1 = most frequent -> full base weight, rank
 * >= 2500 -> half base weight), or base * 0.4 when the partner has no
 * recorded frequency at all. Always clamped to [0, 1].
 */
export function frequencyScaledWeight(base: number, partnerFrequency: number | null): number {
  const raw =
    partnerFrequency === null
      ? base * 0.4
      : base * (1 - 0.5 * (Math.min(partnerFrequency, FREQUENCY_RANK_CEILING) / FREQUENCY_RANK_CEILING));
  return Math.min(1, Math.max(0, raw));
}

/**
 * Builds links for a "members share this key" grouping (e.g. kanji
 * sharing an on-reading, or sharing a radical). A member can appear in
 * more than one group for the same relation (a kanji can have several
 * on-readings, each its own group), so the cap has to be applied once
 * per member across every group it took part in, not per group -
 * otherwise a kanji with three on-readings could end up with 3x `cap`
 * outgoing links. `rank` is ascending: lower is kept (e.g. KANJIDIC2
 * frequency, where a smaller number means a more frequent kanji);
 * members with no rank sort last, and the same value also drives each
 * link's weight via `frequencyScaledWeight(baseWeight, rank(partner))`.
 * Ties break on the partner's entry ID for determinism. The relation is
 * emitted in one direction per pick, so the overall edge set need not
 * be perfectly symmetric once capped - `symmetrizeLinks` fixes that up
 * afterwards.
 */
export function buildCappedGroupLinks(
  groups: Iterable<string[]>,
  toEntryId: (member: string) => EntryId,
  rank: (member: string) => number | null,
  cap: number,
  axis: Link['axis'],
  relation: Relation,
  baseWeight: number,
  source: string,
): Link[] {
  // Phase 1: every (member, partner) pair from every group, deduplicated
  // per member (the same two kanji can share more than one on-reading).
  const partnersByMember = new Map<string, Set<string>>();
  for (const members of groups) {
    if (members.length < 2) continue;
    for (const member of members) {
      const set = partnersByMember.get(member) ?? new Set<string>();
      for (const partner of members) {
        if (partner !== member) set.add(partner);
      }
      partnersByMember.set(member, set);
    }
  }

  // Phase 2: cap each member's partner set to `cap`, ranked ascending
  // (most frequent first), ties broken by entry ID.
  const out: Link[] = [];
  for (const [member, partners] of partnersByMember) {
    const from = toEntryId(member);
    const ranked = [...partners].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) {
        if (ra === null) return 1;
        if (rb === null) return -1;
        return ra - rb;
      }
      const ea = toEntryId(a);
      const eb = toEntryId(b);
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
    for (const partner of ranked.slice(0, cap)) {
      out.push({
        fromEntryId: from,
        toEntryId: toEntryId(partner),
        axis,
        relation,
        weight: frequencyScaledWeight(baseWeight, rank(partner)),
        source,
      });
    }
  }
  return out;
}

import { and, desc, eq, inArray, isNull, min, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  HIRAGANA_CHARS,
  HUB_KIND_RELATION,
  KATAKANA_CHARS,
  parseEntryId,
} from '@japanesesite/shared';
import type {
  Axis,
  EntryId,
  EntrySummary,
  HubKind,
  JlptFilterKey,
  JlptLevel,
  Relation,
  Sentence,
} from '@japanesesite/shared';
import { kanjiRowToSummary, wordRowToSummary, type KanjiRow } from '../services/entrySummary.js';
import type { FlatLinkRow } from '../services/groupLinks.js';
import type { RelationPosition } from '../services/cursor.js';
import { hubWeightBaseFor } from '../services/hubWeights.js';
import { mergeSearchResults, type TieredEntry } from '../services/searchRanking.js';
import type { Db } from './client.js';
import { hubMembers, hubs, kanji, links, sentenceEntries, sentences, vocabularyItems } from './schema.js';

/** Inverse of HUB_KIND_RELATION: which hub kind serves a given (family) relation. */
const HUB_KIND_BY_RELATION = new Map<Relation, HubKind>(
  (Object.entries(HUB_KIND_RELATION) as [HubKind, { axis: Axis; relation: Relation }][]).map(
    ([kind, v]) => [v.relation, kind],
  ),
);

/** Inverse of HUB_KIND_RELATION, keyed by relation: which axis a family relation belongs to. */
const AXIS_BY_FAMILY_RELATION = new Map<Relation, Axis>(
  Object.values(HUB_KIND_RELATION).map((v) => [v.relation, v.axis]),
);

/** `jlptCol` holds one of the filter's levels, or is null when the filter includes 'none'. */
function jlptMatchSql(jlptCol: AnyPgColumn, jlpt: readonly JlptFilterKey[]): SQL {
  const levels = jlpt.filter((k): k is JlptLevel => k !== 'none');
  const parts: SQL[] = [];
  if (levels.length > 0) parts.push(inArray(jlptCol, levels));
  if (jlpt.includes('none')) parts.push(isNull(jlptCol));
  return or(...parts) ?? sql`false`;
}

/**
 * `EXISTS` check that `entryIdExpr` (an entry-ID text expression) names a
 * loaded entry and, when `jlpt` is given, one whose JLPT level passes the
 * filter. Every links query and count goes through this one predicate, so
 * filtered pages and filtered totals always agree.
 *
 * The ID is split and compared against each table's primary key, never
 * rebuilt from the key ('k:' || literal), so each check is one index
 * lookup instead of a scan of the whole table per candidate row. The
 * word branch only casts IDs that are `w:` plus at most 9 digits, so a
 * malformed ID matches nothing rather than raising a cast error, and
 * then re-checks the exact text so a non-canonical ID such as `w:0123`
 * matches nothing either (getEntrySummaries could not find it).
 */
function entryExistsSql(entryIdExpr: AnyPgColumn, jlpt?: readonly JlptFilterKey[]) {
  const kanjiLevel = jlpt ? sql` AND ${jlptMatchSql(kanji.jlptLevel, jlpt)}` : sql``;
  const wordLevel = jlpt ? sql` AND ${jlptMatchSql(vocabularyItems.jlptLevel, jlpt)}` : sql``;
  return sql`(
    EXISTS (SELECT 1 FROM ${kanji} WHERE starts_with(${entryIdExpr}, 'k:') AND ${kanji.literal} = substr(${entryIdExpr}, 3)${kanjiLevel})
    OR EXISTS (SELECT 1 FROM ${vocabularyItems} WHERE ${vocabularyItems.entSeq} = (CASE WHEN ${entryIdExpr} ~ '^w:[0-9]{1,9}$' THEN substr(${entryIdExpr}, 3)::int END) AND ${vocabularyItems.entSeq}::text = substr(${entryIdExpr}, 3)${wordLevel})
  )`;
}

export type EntryRow =
  | { kind: 'kanji'; row: typeof kanji.$inferSelect }
  | { kind: 'word'; row: typeof vocabularyItems.$inferSelect };

/** Looks up a single kanji or vocabulary item by its entry-ID key. */
export async function findEntryRow(
  db: Db,
  kind: 'kanji' | 'word',
  key: string,
): Promise<EntryRow | null> {
  if (kind === 'kanji') {
    const rows = await db.select().from(kanji).where(eq(kanji.literal, key)).limit(1);
    const row = rows[0];
    return row ? { kind: 'kanji', row } : null;
  }
  const entSeq = Number(key);
  const rows = await db
    .select()
    .from(vocabularyItems)
    .where(eq(vocabularyItems.entSeq, entSeq))
    .limit(1);
  const row = rows[0];
  return row ? { kind: 'word', row } : null;
}

export interface LinkCounts {
  semantic: number;
  phonetic: number;
  structural: number;
}

/**
 * Distinct partner count per family relation for an entry: the other
 * members of every hub (of any kind) that the entry belongs to, deduped
 * so a partner reachable through two hubs of the same kind counts
 * once, excluding the entry itself and any member with no loaded entry
 * row. One query covers every hub kind at once (grouped by kind), since
 * GET /entries/:id wants all axes regardless of any axis filter.
 */
async function getFamilySiblingCounts(
  db: Db,
  entryId: string,
  jlpt?: readonly JlptFilterKey[],
): Promise<Partial<Record<Relation, number>>> {
  const hm1 = alias(hubMembers, 'hm1');
  const hm2 = alias(hubMembers, 'hm2');

  const perPartner = db
    .select({ kind: hubs.kind, partnerId: hm2.entryId })
    .from(hm1)
    .innerJoin(hubs, eq(hubs.hubId, hm1.hubId))
    .innerJoin(hm2, eq(hm2.hubId, hm1.hubId))
    .where(
      and(eq(hm1.entryId, entryId), ne(hm2.entryId, entryId), entryExistsSql(hm2.entryId, jlpt)),
    )
    .groupBy(hubs.kind, hm2.entryId)
    .as('per_partner');

  const rows = await db
    .select({ kind: perPartner.kind, count: sql<number>`count(*)::int` })
    .from(perPartner)
    .groupBy(perPartner.kind);

  const counts: Partial<Record<Relation, number>> = {};
  for (const r of rows) {
    const relation = HUB_KIND_RELATION[r.kind as HubKind]?.relation;
    if (relation) counts[relation] = r.count;
  }
  return counts;
}

/**
 * Count of outgoing links per axis for an entry: pairwise link rows
 * (restricted to links whose target actually exists) plus hub-derived
 * family siblings, per relation, from getFamilySiblingCounts. This must
 * match what /links reports as each axis's `total` exactly - both read
 * this same function - since groupLinks() also drops rows whose target
 * has no loaded summary and dedupes same-kind-hub overlap the same way.
 */
export async function getLinkCounts(
  db: Db,
  entryId: string,
  jlpt?: readonly JlptFilterKey[],
): Promise<LinkCounts> {
  const [pairwiseRows, familyCounts] = await Promise.all([
    db
      .select({ axis: links.axis, count: sql<number>`count(*)::int` })
      .from(links)
      .where(and(eq(links.fromEntryId, entryId), entryExistsSql(links.toEntryId, jlpt)))
      .groupBy(links.axis),
    getFamilySiblingCounts(db, entryId, jlpt),
  ]);

  const counts: LinkCounts = { semantic: 0, phonetic: 0, structural: 0 };
  for (const r of pairwiseRows) {
    if (r.axis === 'semantic' || r.axis === 'phonetic' || r.axis === 'structural') {
      counts[r.axis] += r.count;
    }
  }
  for (const [relation, count] of Object.entries(familyCounts) as [Relation, number][]) {
    const axis = AXIS_BY_FAMILY_RELATION.get(relation);
    if (axis) counts[axis] += count;
  }
  return counts;
}

/**
 * `row after position` predicate for a single relation's hub-sibling
 * query, expressed in terms of that relation's SQL-computed `weight`
 * (see getHubSiblingRows) and the in-relation order used everywhere
 * links are listed (weight desc, then toEntryId asc; see
 * services/cursor.ts): strictly lower weight, or equal weight with a
 * strictly greater entryId.
 */
function afterPositionSql(
  weightExpr: ReturnType<typeof sql<number>>,
  entryIdCol: AnyPgColumn,
  position: RelationPosition,
) {
  if (position.weight === null) {
    // Every hub-derived row has a non-null computed weight, and null
    // sorts last of all, so nothing here can come after a null-weight
    // position.
    return sql`false`;
  }
  // COLLATE "C" (code point order) so the comparison matches groupLinks'
  // JS ordering whatever the database's default collation is.
  return sql`(${weightExpr} < ${position.weight} OR (${weightExpr} = ${position.weight} AND ${entryIdCol} COLLATE "C" > ${position.toEntryId}))`;
}

/**
 * Hub-derived siblings of `entryId` for one family relation: the other
 * members of every hub (of the kind mapped to `relation`) that
 * `entryId` belongs to, deduped so a partner reachable through two
 * hubs of that kind counts once (keeping the lowest rank), excluding
 * `entryId` itself and any member with no loaded entry row.
 *
 * Ordered by rank ascending (nulls last), then entry_id ascending by
 * code point (COLLATE "C", matching groupLinks' compareCodePoints, so a
 * database created with a locale collation such as en_US.utf8 cannot
 * reorder ties and make the cursor skip rows) - via a
 * `weight` computed with the same formula as
 * rankToWeight(HUB_WEIGHT_BASE[relation], rank)
 * (packages/shared/src/hubs.ts), so it merges correctly with pairwise
 * rows and with other relations under a single weight-based order.
 * `after` is this relation's position from the cursor (null for its
 * first page). Both LIMIT and that predicate are pushed into this query: a hub
 * can have 500+ members, so this never fetches them all to slice in
 * memory.
 */
export async function getHubSiblingRows(
  db: Db,
  entryId: string,
  relation: Relation,
  after: RelationPosition | null,
  limit: number,
  jlpt?: readonly JlptFilterKey[],
): Promise<FlatLinkRow[]> {
  const kind = HUB_KIND_BY_RELATION.get(relation);
  const base = hubWeightBaseFor(relation);
  if (kind === undefined || base === undefined) return [];
  const axis = HUB_KIND_RELATION[kind].axis;

  const hm1 = alias(hubMembers, 'hm1');
  const hm2 = alias(hubMembers, 'hm2');

  const grouped = db
    .select({
      partnerId: hm2.entryId,
      minRank: min(hm2.rank).as('min_rank'),
      // Every shared hub's label, in code point order so the response
      // is deterministic.
      labels: sql<string[]>`array_agg(DISTINCT ${hubs.label} COLLATE "C" ORDER BY ${hubs.label} COLLATE "C")`.as(
        'labels',
      ),
    })
    .from(hm1)
    .innerJoin(hubs, eq(hubs.hubId, hm1.hubId))
    .innerJoin(hm2, eq(hm2.hubId, hm1.hubId))
    .where(and(eq(hm1.entryId, entryId), eq(hubs.kind, kind), ne(hm2.entryId, entryId)))
    .groupBy(hm2.entryId)
    .as('grouped');

  // Mirrors rankToWeight(base, rank): a null rank is treated the same
  // as the maximum-cap rank (2500), so COALESCE folds that case in
  // rather than needing a separate branch.
  const weightExpr = sql<number>`LEAST(1, GREATEST(0, ${base}::float8 * (1 - 0.6 * (LEAST(GREATEST(COALESCE(${grouped.minRank}, 2500), 0), 2500)::float8 / 2500))))`;

  const conditions = [entryExistsSql(grouped.partnerId, jlpt)];
  if (after) conditions.push(afterPositionSql(weightExpr, grouped.partnerId, after));

  const rows = await db
    .select({ partnerId: grouped.partnerId, weight: weightExpr, labels: grouped.labels })
    .from(grouped)
    .where(and(...conditions))
    .orderBy(desc(weightExpr), sql`${grouped.partnerId} COLLATE "C" ASC`)
    .limit(limit);

  return rows.map((r) => ({
    axis,
    relation,
    toEntryId: r.partnerId,
    weight: r.weight,
    via: r.labels,
  }));
}

/** Sentences that reference this entry, each with its full set of tagged entry IDs. */
export async function getSentencesForEntry(db: Db, entryId: string): Promise<Sentence[]> {
  const rows = await db
    .select({
      tatoebaId: sentences.tatoebaId,
      japanese: sentences.japanese,
      english: sentences.english,
      furigana: sentences.furigana,
      licence: sentences.licence,
    })
    .from(sentences)
    .innerJoin(sentenceEntries, eq(sentenceEntries.sentenceId, sentences.tatoebaId))
    .where(eq(sentenceEntries.entryId, entryId));

  if (rows.length === 0) return [];

  const sentenceIds = rows.map((r) => r.tatoebaId);
  const entryLinkRows = await db
    .select({ sentenceId: sentenceEntries.sentenceId, entryId: sentenceEntries.entryId })
    .from(sentenceEntries)
    .where(inArray(sentenceEntries.sentenceId, sentenceIds));

  const entryIdsBySentence = new Map<number, EntryId[]>();
  for (const er of entryLinkRows) {
    const list = entryIdsBySentence.get(er.sentenceId) ?? [];
    list.push(er.entryId as EntryId);
    entryIdsBySentence.set(er.sentenceId, list);
  }

  return rows.map((r) => ({
    tatoebaId: r.tatoebaId,
    japanese: r.japanese,
    english: r.english,
    furigana: r.furigana,
    licence: r.licence,
    entryIds: entryIdsBySentence.get(r.tatoebaId) ?? [],
  }));
}

/**
 * Flat, unpaginated link rows for an entry, restricted to the given axes
 * and to targets that exist (and pass `jlpt`, when given) - the same
 * predicate getLinkCounts uses.
 */
export async function getLinkRowsForAxes(
  db: Db,
  entryId: string,
  axes: Axis[],
  jlpt?: readonly JlptFilterKey[],
): Promise<FlatLinkRow[]> {
  const rows = await db
    .select({
      axis: links.axis,
      relation: links.relation,
      toEntryId: links.toEntryId,
      weight: links.weight,
    })
    .from(links)
    .where(
      and(
        eq(links.fromEntryId, entryId),
        inArray(links.axis, axes),
        entryExistsSql(links.toEntryId, jlpt),
      ),
    );

  // axis/relation are free-text columns backed by pipeline-validated data;
  // the shared enums are the source of truth for allowed values.
  return rows.map((r) => ({
    axis: r.axis as Axis,
    relation: r.relation as FlatLinkRow['relation'],
    toEntryId: r.toEntryId,
    weight: r.weight,
  }));
}

/** Batch-loads entry summaries for a set of entry IDs, kanji and words alike. */
export async function getEntrySummaries(
  db: Db,
  entryIds: string[],
): Promise<Map<string, EntrySummary>> {
  const kanjiLiterals: string[] = [];
  const wordSeqs: number[] = [];
  for (const id of entryIds) {
    const parsed = parseEntryId(id);
    if (!parsed) continue;
    if (parsed.kind === 'kanji') kanjiLiterals.push(parsed.key);
    else wordSeqs.push(Number(parsed.key));
  }

  const map = new Map<string, EntrySummary>();

  if (kanjiLiterals.length > 0) {
    const rows = await db.select().from(kanji).where(inArray(kanji.literal, kanjiLiterals));
    for (const row of rows) map.set(`k:${row.literal}`, kanjiRowToSummary(row));
  }
  if (wordSeqs.length > 0) {
    const rows = await db
      .select()
      .from(vocabularyItems)
      .where(inArray(vocabularyItems.entSeq, wordSeqs));
    for (const row of rows) map.set(`w:${row.entSeq}`, wordRowToSummary(row));
  }
  return map;
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * `EXISTS (... WHERE gloss ILIKE query)`: a gloss that is, case
 * insensitively, exactly the query (used for tier 0).
 */
function meaningExactMatch(meaningsColumn: AnyPgColumn, escapedQuery: string) {
  return sql`EXISTS (SELECT 1 FROM unnest(${meaningsColumn}) AS m WHERE m ILIKE ${escapedQuery})`;
}

/**
 * Word-boundary meaning match: the gloss equals the query, starts with
 * "query ", contains " query ", or ends with " query" - never a bare
 * substring, so a query like "an" does not match the gloss "Japan".
 */
function meaningWordBoundaryMatch(meaningsColumn: AnyPgColumn, escapedQuery: string) {
  return sql`EXISTS (
    SELECT 1 FROM unnest(${meaningsColumn}) AS m
    WHERE m ILIKE ${escapedQuery}
       OR m ILIKE ${`${escapedQuery} %`}
       OR m ILIKE ${`% ${escapedQuery} %`}
       OR m ILIKE ${`% ${escapedQuery}`}
  )`;
}

/**
 * `EXISTS` over a kanji's on+kun readings, folded (katakana -> hiragana)
 * so a query matches either script, compared against `pattern` (an
 * already-escaped ILIKE pattern: exact, prefix, or substring).
 */
function readingMatch(pattern: string) {
  return sql`EXISTS (
    SELECT 1 FROM unnest(${kanji.onReadings} || ${kanji.kunReadings}) AS r
    WHERE translate(r, ${KATAKANA_CHARS}, ${HIRAGANA_CHARS}) ILIKE ${pattern}
  )`;
}

/**
 * Searches vocabulary items (on search_key, surface, alternate_surfaces,
 * and meanings) and kanji (on literal, folded on/kun readings, and
 * meanings), ranks both into the same 0-3 tiers, and merges them via
 * mergeSearchResults so neither kind can be crowded out of the results.
 *
 * `foldedQuery` is the kana-folded, trimmed query (via
 * normalizeSearchKey), used against search_key and readings.
 * `rawQuery` is the trimmed, unfolded query, used against surface,
 * alternate surfaces, and meanings.
 */
export async function searchEntries(
  db: Db,
  foldedQuery: string,
  rawQuery: string,
  limit: number,
): Promise<EntrySummary[]> {
  // Defense in depth: searchQuerySchema already rejects a query that is
  // empty after normalizeSearchKey, but never let an accidentally-empty
  // pattern here turn into an unfiltered `%%` scan of the table.
  if (foldedQuery.length === 0 && rawQuery.length === 0) return [];

  const escapedFolded = escapeLike(foldedQuery);
  const escapedRaw = escapeLike(rawQuery);
  const exactFolded = escapedFolded;
  const prefixFolded = `${escapedFolded}%`;
  const likeFolded = `%${escapedFolded}%`;
  const prefixRaw = `${escapedRaw}%`;
  const likeRaw = `%${escapedRaw}%`;

  // is_common desc, then jlpt_level (N5 first, nulls last), then
  // char_length(reading) asc, then ent_seq asc.
  const jlptRank = sql`(CASE ${vocabularyItems.jlptLevel}
    WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4
    ELSE 5 END)`;

  const wordTier = sql<number>`(CASE
    WHEN ${vocabularyItems.searchKey} = ${foldedQuery}
      OR ${vocabularyItems.surface} = ${rawQuery}
      OR ${rawQuery} = ANY(${vocabularyItems.alternateSurfaces})
      OR ${meaningExactMatch(vocabularyItems.meanings, escapedRaw)}
      THEN 0
    WHEN ${vocabularyItems.searchKey} ILIKE ${prefixFolded}
      OR ${vocabularyItems.surface} ILIKE ${prefixRaw}
      OR EXISTS (SELECT 1 FROM unnest(${vocabularyItems.alternateSurfaces}) AS alt WHERE alt ILIKE ${prefixRaw})
      THEN 1
    WHEN ${meaningWordBoundaryMatch(vocabularyItems.meanings, escapedRaw)}
      THEN 2
    ELSE 3
  END)`;

  const wordRows = await db
    .select({
      entSeq: vocabularyItems.entSeq,
      surface: vocabularyItems.surface,
      reading: vocabularyItems.reading,
      meanings: vocabularyItems.meanings,
      jlptLevel: vocabularyItems.jlptLevel,
      tier: wordTier,
    })
    .from(vocabularyItems)
    .where(
      or(
        sql`${vocabularyItems.searchKey} ILIKE ${likeFolded}`,
        sql`${vocabularyItems.surface} ILIKE ${likeRaw}`,
        sql`EXISTS (SELECT 1 FROM unnest(${vocabularyItems.alternateSurfaces}) AS alt WHERE alt ILIKE ${likeRaw})`,
        meaningWordBoundaryMatch(vocabularyItems.meanings, escapedRaw),
      ),
    )
    .orderBy(
      wordTier,
      desc(vocabularyItems.isCommon),
      jlptRank,
      sql`char_length(${vocabularyItems.reading})`,
      vocabularyItems.entSeq,
    )
    .limit(limit);

  const kanjiTier = sql<number>`(CASE
    WHEN ${kanji.literal} = ${rawQuery}
      OR ${readingMatch(exactFolded)}
      OR ${meaningExactMatch(kanji.meanings, escapedRaw)}
      THEN 0
    WHEN ${readingMatch(prefixFolded)}
      THEN 1
    WHEN ${meaningWordBoundaryMatch(kanji.meanings, escapedRaw)}
      THEN 2
    ELSE 3
  END)`;

  const kanjiRows: (KanjiRow & { tier: number })[] = await db
    .select({
      literal: kanji.literal,
      onReadings: kanji.onReadings,
      kunReadings: kanji.kunReadings,
      meanings: kanji.meanings,
      jlptLevel: kanji.jlptLevel,
      frequency: kanji.frequency,
      tier: kanjiTier,
    })
    .from(kanji)
    .where(
      and(
        or(
          eq(kanji.literal, rawQuery),
          readingMatch(likeFolded),
          meaningWordBoundaryMatch(kanji.meanings, escapedRaw),
        ),
        // Exclude kanji with no loaded meanings, even if their reading
        // or literal matches exactly.
        sql`cardinality(${kanji.meanings}) > 0`,
      ),
    )
    .orderBy(kanjiTier, sql`${kanji.frequency} IS NULL`, kanji.frequency, kanji.literal)
    .limit(limit);

  const kanjiTiered: TieredEntry[] = kanjiRows.map((row) => ({
    tier: row.tier,
    summary: kanjiRowToSummary(row),
  }));
  const wordTiered: TieredEntry[] = wordRows.map((row) => ({
    tier: row.tier,
    summary: wordRowToSummary(row),
  }));

  return mergeSearchResults(kanjiTiered, wordTiered, limit);
}

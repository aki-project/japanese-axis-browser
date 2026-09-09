import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { HIRAGANA_CHARS, KATAKANA_CHARS, parseEntryId } from '@japanesesite/shared';
import type { Axis, EntryId, EntrySummary, Sentence } from '@japanesesite/shared';
import { kanjiRowToSummary, wordRowToSummary, type KanjiRow } from '../services/entrySummary.js';
import type { FlatLinkRow } from '../services/groupLinks.js';
import { mergeSearchResults, type TieredEntry } from '../services/searchRanking.js';
import type { Db } from './client.js';
import { kanji, links, sentenceEntries, sentences, vocabularyItems } from './schema.js';

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
 * Count of outgoing links per axis for an entry, restricted to links
 * whose target actually exists (in kanji or vocabulary_items). This
 * must match what /links reports as each axis's `total`, since
 * groupLinks() also drops links whose target has no loaded summary.
 */
export async function getLinkCounts(db: Db, entryId: string): Promise<LinkCounts> {
  const rows = await db
    .select({ axis: links.axis, count: sql<number>`count(*)::int` })
    .from(links)
    .where(
      and(
        eq(links.fromEntryId, entryId),
        sql`(
          EXISTS (SELECT 1 FROM ${kanji} WHERE 'k:' || ${kanji.literal} = ${links.toEntryId})
          OR EXISTS (SELECT 1 FROM ${vocabularyItems} WHERE 'w:' || ${vocabularyItems.entSeq}::text = ${links.toEntryId})
        )`,
      ),
    )
    .groupBy(links.axis);

  const counts: LinkCounts = { semantic: 0, phonetic: 0, structural: 0 };
  for (const r of rows) {
    if (r.axis === 'semantic' || r.axis === 'phonetic' || r.axis === 'structural') {
      counts[r.axis] = r.count;
    }
  }
  return counts;
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

/** Flat, unpaginated link rows for an entry, restricted to the given axes. */
export async function getLinkRowsForAxes(
  db: Db,
  entryId: string,
  axes: Axis[],
): Promise<FlatLinkRow[]> {
  const rows = await db
    .select({
      axis: links.axis,
      relation: links.relation,
      toEntryId: links.toEntryId,
      weight: links.weight,
    })
    .from(links)
    .where(and(eq(links.fromEntryId, entryId), inArray(links.axis, axes)));

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

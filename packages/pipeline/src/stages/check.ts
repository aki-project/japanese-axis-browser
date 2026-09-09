/**
 * Post-load quality checks (run after `load`): row counts per table,
 * links per axis, isolated-entry count (computed against the live DB,
 * not the processed files), and ten random entries with their per-axis
 * link counts. Read-only.
 *
 * Usage: tsx src/stages/check.ts
 */
import { createDb } from 'api/db/client';
import { kanji, vocabularyItems, radicals, components, links } from 'api/db/schema';
import { sql } from 'drizzle-orm';

async function main(): Promise<void> {
  const app = await createDb();
  try {
    const db = app.db;
    console.log(`driver: ${app.kind}\n`);

    console.log('row counts:');
    for (const [name, table] of [
      ['kanji', kanji],
      ['vocabulary_items', vocabularyItems],
      ['radicals', radicals],
      ['components', components],
      ['links', links],
    ] as const) {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
      console.log(`  ${name}: ${row?.count ?? 0}`);
    }

    console.log('\nlinks per axis:');
    const perAxis = await db
      .select({ axis: links.axis, count: sql<number>`count(*)::int` })
      .from(links)
      .groupBy(links.axis);
    for (const row of perAxis) console.log(`  ${row.axis}: ${row.count}`);

    console.log('\nlinks per (axis, relation):');
    const perRelation = await db
      .select({ axis: links.axis, relation: links.relation, count: sql<number>`count(*)::int` })
      .from(links)
      .groupBy(links.axis, links.relation)
      .orderBy(links.axis, links.relation);
    for (const row of perRelation) console.log(`  ${row.axis}/${row.relation}: ${row.count}`);

    const [emptyReading] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kanji)
      .where(sql`cardinality(${kanji.onReadings}) = 0 and cardinality(${kanji.kunReadings}) = 0`);
    const [emptyMeaningKanji] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kanji)
      .where(sql`cardinality(${kanji.meanings}) = 0`);
    const [emptyMeaningWord] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(vocabularyItems)
      .where(sql`cardinality(${vocabularyItems.meanings}) = 0`);
    console.log('\nempty reading/meaning (informational, not fatal for the full dataset):');
    console.log(`  kanji with no on/kun reading at all: ${emptyReading?.count ?? 0}`);
    console.log(`  kanji with no meaning: ${emptyMeaningKanji?.count ?? 0}`);
    console.log(`  words with no meaning: ${emptyMeaningWord?.count ?? 0}`);

    // Every to_entry_id must exist as a kanji or word entry. Built as a
    // set-based anti-join (all entry IDs vs. all endpoints referenced by
    // links) rather than a per-row correlated subquery/OR-join, which is
    // far too slow once links crosses a million rows on PGlite.
    const danglingTo = await db.execute(sql`
      with entry_ids as (
        select 'k:' || literal as id from kanji
        union all
        select 'w:' || ent_seq as id from vocabulary_items
      )
      select l.to_entry_id, count(*)::int as count
      from links l
      left join entry_ids e on e.id = l.to_entry_id
      where e.id is null
      group by l.to_entry_id
      limit 10
    `);
    const danglingRows = (danglingTo as unknown as { rows: unknown[] }).rows;
    console.log(`\ndangling to_entry_id (should be 0): ${danglingRows.length}`);

    // Every kanji referenced by a word (contains_kanji) must exist in the kanji table.
    const danglingKanjiRefs = await db.execute(sql`
      select l.to_entry_id
      from links l
      left join kanji k on 'k:' || k.literal = l.to_entry_id
      where l.axis = 'structural' and l.relation = 'contains_kanji' and l.from_entry_id like 'w:%'
        and k.literal is null
      limit 10
    `);
    console.log(
      `words referencing a nonexistent kanji (should be 0): ${(danglingKanjiRefs as unknown as { rows: unknown[] }).rows.length}`,
    );

    // Isolated entries: no link on any axis, in either direction. Computed
    // as one UNION of every endpoint referenced by any link, then an
    // anti-join against each entry table (again, set-based rather than a
    // per-row correlated OR-subquery).
    const isolatedKanji = await db.execute(sql`
      with referenced as (
        select from_entry_id as id from links
        union
        select to_entry_id as id from links
      )
      select k.literal
      from kanji k
      left join referenced r on r.id = 'k:' || k.literal
      where r.id is null
    `);
    const isolatedWords = await db.execute(sql`
      with referenced as (
        select from_entry_id as id from links
        union
        select to_entry_id as id from links
      )
      select v.ent_seq
      from vocabulary_items v
      left join referenced r on r.id = 'w:' || v.ent_seq
      where r.id is null
    `);
    const isolatedKanjiCount = (isolatedKanji as unknown as { rows: unknown[] }).rows.length;
    const isolatedWordsCount = (isolatedWords as unknown as { rows: unknown[] }).rows.length;
    console.log(`\nisolated kanji (no link on any axis): ${isolatedKanjiCount}`);
    console.log(`isolated words (no link on any axis): ${isolatedWordsCount}`);
    console.log(`isolated entries total: ${isolatedKanjiCount + isolatedWordsCount}`);

    console.log('\nten random entries with per-axis link counts:');
    const randomKanji = await db.execute(sql`select literal from kanji order by random() limit 5`);
    const randomWords = await db.execute(
      sql`select ent_seq from vocabulary_items order by random() limit 5`,
    );
    const sample = [
      ...(randomKanji as unknown as { rows: { literal: string }[] }).rows.map((r) => `k:${r.literal}`),
      ...(randomWords as unknown as { rows: { ent_seq: number }[] }).rows.map((r) => `w:${r.ent_seq}`),
    ];
    for (const entryId of sample) {
      const counts = await db.execute(sql`
        select axis, count(*)::int as count
        from links
        where from_entry_id = ${entryId}
        group by axis
      `);
      const rows = (counts as unknown as { rows: { axis: string; count: number }[] }).rows;
      const byAxis = Object.fromEntries(rows.map((r) => [r.axis, r.count]));
      console.log(
        `  ${entryId}: semantic=${byAxis['semantic'] ?? 0} phonetic=${byAxis['phonetic'] ?? 0} structural=${byAxis['structural'] ?? 0}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

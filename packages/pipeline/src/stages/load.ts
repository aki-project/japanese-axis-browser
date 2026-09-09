/**
 * Stage 6: load. Runs pending migrations, then upserts every processed
 * record into Postgres (or the embedded PGlite fallback when
 * DATABASE_URL is unset) in batches of 500, keyed on primary keys via
 * Drizzle's onConflictDoUpdate. Each batch runs inside its own
 * transaction, so a failure partway through a batch cannot leave a
 * half-applied batch committed. Links are loaded after entries, since
 * their primary key is (from, to, axis, relation) and endpoints must
 * already exist for a real foreign-key-backed database (PGlite/Postgres
 * here does not declare an FK, but referential integrity still matters
 * for the API).
 *
 * Usage: tsx src/stages/load.ts [--dir=processed|seed]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, runMigrations, type AppDatabase } from 'api/db/client';
import { kanji, vocabularyItems, radicals, components, links } from 'api/db/schema';
import type { Kanji, VocabularyItem, Radical, Component, Link } from '@japanesesite/shared';
import { sql } from 'drizzle-orm';
import { PROCESSED, SEED, REPO_ROOT } from '../lib/paths.js';
import { readJsonlAll } from '../lib/jsonl.js';

const BATCH_SIZE = 500;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function countRows(app: AppDatabase, table: string): Promise<number> {
  const result = await app.db.execute(sql`select count(*)::int as count from ${sql.raw(table)}`);
  const rows = result as unknown as { rows: { count: number }[] };
  return rows.rows[0]?.count ?? 0;
}

async function loadKanji(app: AppDatabase, rows: Kanji[]): Promise<void> {
  for (const batch of chunks(rows, BATCH_SIZE)) {
    await app.db.transaction(async (tx) => {
      await tx
        .insert(kanji)
        .values(
          batch.map((k) => ({
            literal: k.literal,
            onReadings: k.onReadings,
            kunReadings: k.kunReadings,
            meanings: k.meanings,
            strokeCount: k.strokeCount,
            radical: k.radical,
            components: k.components,
            etymology: k.etymology,
            jlptLevel: k.jlptLevel,
            frequency: k.frequency,
          })),
        )
        .onConflictDoUpdate({
          target: kanji.literal,
          set: {
            onReadings: sql`excluded.on_readings`,
            kunReadings: sql`excluded.kun_readings`,
            meanings: sql`excluded.meanings`,
            strokeCount: sql`excluded.stroke_count`,
            radical: sql`excluded.radical`,
            components: sql`excluded.components`,
            etymology: sql`excluded.etymology`,
            jlptLevel: sql`excluded.jlpt_level`,
            frequency: sql`excluded.frequency`,
          },
        });
    });
  }
}

async function loadWords(app: AppDatabase, rows: VocabularyItem[]): Promise<void> {
  for (const batch of chunks(rows, BATCH_SIZE)) {
    await app.db.transaction(async (tx) => {
      await tx
        .insert(vocabularyItems)
        .values(
          batch.map((w) => ({
            entSeq: w.entSeq,
            surface: w.surface,
            reading: w.reading,
            alternateSurfaces: w.alternateSurfaces,
            alternateReadings: w.alternateReadings,
            meanings: w.meanings,
            partsOfSpeech: w.partsOfSpeech,
            jlptLevel: w.jlptLevel,
            isCommon: w.isCommon,
            audioUrl: w.audioUrl,
            searchKey: w.searchKey,
          })),
        )
        .onConflictDoUpdate({
          target: vocabularyItems.entSeq,
          set: {
            surface: sql`excluded.surface`,
            reading: sql`excluded.reading`,
            alternateSurfaces: sql`excluded.alternate_surfaces`,
            alternateReadings: sql`excluded.alternate_readings`,
            meanings: sql`excluded.meanings`,
            partsOfSpeech: sql`excluded.parts_of_speech`,
            jlptLevel: sql`excluded.jlpt_level`,
            isCommon: sql`excluded.is_common`,
            audioUrl: sql`excluded.audio_url`,
            searchKey: sql`excluded.search_key`,
          },
        });
    });
  }
}

async function loadRadicals(app: AppDatabase, rows: Radical[]): Promise<void> {
  for (const batch of chunks(rows, BATCH_SIZE)) {
    await app.db.transaction(async (tx) => {
      await tx
        .insert(radicals)
        .values(batch.map((r) => ({ character: r.character, name: r.name, strokeCount: r.strokeCount })))
        .onConflictDoUpdate({
          target: radicals.character,
          set: { name: sql`excluded.name`, strokeCount: sql`excluded.stroke_count` },
        });
    });
  }
}

async function loadComponents(app: AppDatabase, rows: Component[]): Promise<void> {
  for (const batch of chunks(rows, BATCH_SIZE)) {
    await app.db.transaction(async (tx) => {
      await tx
        .insert(components)
        .values(batch.map((c) => ({ character: c.character, isKanji: c.isKanji, etymology: c.etymology })))
        .onConflictDoUpdate({
          target: components.character,
          set: { isKanji: sql`excluded.is_kanji`, etymology: sql`excluded.etymology` },
        });
    });
  }
}

async function loadLinks(app: AppDatabase, rows: Link[]): Promise<void> {
  for (const batch of chunks(rows, BATCH_SIZE)) {
    await app.db.transaction(async (tx) => {
      await tx
        .insert(links)
        .values(
          batch.map((l) => ({
            fromEntryId: l.fromEntryId,
            toEntryId: l.toEntryId,
            axis: l.axis,
            relation: l.relation,
            weight: l.weight,
            source: l.source,
          })),
        )
        .onConflictDoUpdate({
          target: [links.fromEntryId, links.toEntryId, links.axis, links.relation],
          set: { weight: sql`excluded.weight`, source: sql`excluded.source` },
        });
    });
  }
}

async function main(): Promise<void> {
  const dirArg = process.argv.find((a) => a.startsWith('--dir='));
  const which = dirArg ? dirArg.split('=')[1] : 'processed';
  const paths = which === 'seed' ? SEED : PROCESSED;
  console.log(`loading data/${which}/*.jsonl into the database...`);

  const app = await createDb();
  console.log(`  driver: ${app.kind}`);
  try {
    const migrationsFolder = path.resolve(__dirname, '../../../../apps/api/drizzle');
    await runMigrations(app, migrationsFolder);
    console.log('  migrations applied.');

    console.log('\nrow counts before load:');
    for (const t of ['kanji', 'vocabulary_items', 'radicals', 'components', 'links']) {
      console.log(`  ${t}: ${await countRows(app, t)}`);
    }

    const [kanjiRows, wordRows, radicalRows, componentRows, linkRows] = await Promise.all([
      readJsonlAll<Kanji>(paths.kanji),
      readJsonlAll<VocabularyItem>(paths.words),
      readJsonlAll<Radical>(paths.radicals),
      readJsonlAll<Component>(paths.components),
      readJsonlAll<Link>(paths.links),
    ]);

    console.log('\nupserting kanji...');
    await loadKanji(app, kanjiRows);
    console.log('upserting words...');
    await loadWords(app, wordRows);
    console.log('upserting radicals...');
    await loadRadicals(app, radicalRows);
    console.log('upserting components...');
    await loadComponents(app, componentRows);
    console.log('upserting links...');
    await loadLinks(app, linkRows);

    console.log('\nrow counts after load:');
    for (const t of ['kanji', 'vocabulary_items', 'radicals', 'components', 'links']) {
      console.log(`  ${t}: ${await countRows(app, t)}`);
    }

    console.log(`\n${REPO_ROOT}: load stage complete.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

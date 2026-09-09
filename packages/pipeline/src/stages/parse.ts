/**
 * Stage 2: parse. Streams each raw source into data/processed/raw-*.jsonl,
 * one JSON record per source entry, with no transformation applied.
 */
import { RAW, PARSED } from '../lib/paths.js';
import { JsonlWriter, fileExists } from '../lib/jsonl.js';
import { parseJMdict } from '../parsers/jmdict.js';
import { parseKanjidic2 } from '../parsers/kanjidic2.js';
import { parseKradfile } from '../parsers/kradfile.js';
import { parseRadkfile } from '../parsers/radkfile.js';
import { parseIds } from '../parsers/ids.js';
import { parseWordnet } from '../parsers/wordnet.js';
import { parseJlptCsv, type JlptCsvRow } from '../parsers/jlpt.js';

async function parseJMdictStage(): Promise<number> {
  const writer = new JsonlWriter(PARSED.jmdict);
  await writer.open();
  let count = 0;
  for await (const entry of parseJMdict(RAW.jmdict)) {
    await writer.write(entry);
    count += 1;
  }
  await writer.close();
  return count;
}

async function parseKanjidic2Stage(): Promise<number> {
  const writer = new JsonlWriter(PARSED.kanjidic2);
  await writer.open();
  let count = 0;
  for await (const char of parseKanjidic2(RAW.kanjidic2)) {
    await writer.write(char);
    count += 1;
  }
  await writer.close();
  return count;
}

async function parseKradfileStage(): Promise<number> {
  const writer = new JsonlWriter(PARSED.kradfile);
  await writer.open();
  let count = 0;
  for await (const rec of parseKradfile(RAW.kradfile)) {
    await writer.write(rec);
    count += 1;
  }
  await writer.close();
  return count;
}

async function parseRadkfileStage(): Promise<number> {
  const writer = new JsonlWriter(PARSED.radkfile);
  await writer.open();
  let count = 0;
  for await (const rec of parseRadkfile(RAW.radkfile)) {
    await writer.write(rec);
    count += 1;
  }
  await writer.close();
  return count;
}

async function parseIdsStage(): Promise<number> {
  const writer = new JsonlWriter(PARSED.ids);
  await writer.open();
  let count = 0;
  for await (const rec of parseIds(RAW.ids)) {
    await writer.write(rec);
    count += 1;
  }
  await writer.close();
  return count;
}

async function parseWordnetStage(): Promise<number> {
  const writer = new JsonlWriter(PARSED.wordnet);
  await writer.open();
  let count = 0;
  if (fileExists(RAW.wordnetTab)) {
    for await (const rec of parseWordnet(RAW.wordnetTab)) {
      await writer.write(rec);
      count += 1;
    }
  } else if (fileExists(RAW.wordnetDb)) {
    const { DatabaseSync } = await import('node:sqlite');
    const zlib = await import('node:zlib');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    // node:sqlite cannot read a .gz directly; decompress to a scratch file.
    const tmpPath = path.join(os.tmpdir(), 'wnjpn.db');
    const gz = fs.readFileSync(RAW.wordnetDb);
    fs.writeFileSync(tmpPath, zlib.gunzipSync(gz));
    const db = new DatabaseSync(tmpPath);
    const rows = db
      .prepare('select synset, lemma, "true" as source from sense join word using(wordid)')
      .all() as { synset: string; lemma: string; source: string }[];
    for (const row of rows) {
      await writer.write(row);
      count += 1;
    }
    db.close();
    console.log('WordNet: read via node:sqlite from wnjpn.db.gz (tab export unavailable).');
  } else {
    console.warn('WordNet: no source file found, skipping (semantic synset links will be empty).');
  }
  await writer.close();
  return count;
}

async function parseJlptStage(): Promise<number> {
  const writer = new JsonlWriter(PARSED.jlpt);
  await writer.open();
  let count = 0;
  const levels: JlptCsvRow['level'][] = ['N5', 'N4', 'N3', 'N2', 'N1'];
  for (const level of levels) {
    const path = RAW.jlpt(level.toLowerCase() as 'n5' | 'n4' | 'n3' | 'n2' | 'n1');
    if (!fileExists(path)) {
      console.warn(`JLPT list missing for ${level}: ${path}`);
      continue;
    }
    for await (const row of parseJlptCsv(path, level)) {
      await writer.write(row);
      count += 1;
    }
  }
  await writer.close();
  return count;
}

async function main(): Promise<void> {
  console.log('parsing JMdict...');
  console.log(`  -> ${await parseJMdictStage()} entries`);

  console.log('parsing KANJIDIC2...');
  console.log(`  -> ${await parseKanjidic2Stage()} characters`);

  console.log('parsing KRADFILE...');
  console.log(`  -> ${await parseKradfileStage()} kanji decompositions`);

  console.log('parsing RADKFILE...');
  console.log(`  -> ${await parseRadkfileStage()} radicals`);

  console.log('parsing IDS...');
  console.log(`  -> ${await parseIdsStage()} decomposition records`);

  console.log('parsing Japanese WordNet...');
  console.log(`  -> ${await parseWordnetStage()} lemma/synset rows`);

  console.log('parsing JLPT word lists...');
  console.log(`  -> ${await parseJlptStage()} rows`);

  console.log('\nparse stage complete.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

/**
 * Stage 3: transform. Reads data/processed/raw-*.jsonl and builds
 * data/processed/{kanji,words,radicals,components}.jsonl matching the
 * shared zod schemas. Sentences are deferred (see stages/8_sentences.ts).
 */
import { PARSED, PROCESSED } from '../lib/paths.js';
import { JsonlWriter } from '../lib/jsonl.js';
import { readJsonlAll } from '../lib/jsonl.js';
import type { Kanjidic2Character } from '../parsers/kanjidic2.js';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { KradfileEntry } from '../parsers/kradfile.js';
import type { RadkfileEntry } from '../parsers/radkfile.js';
import type { IdsEntry } from '../parsers/ids.js';
import type { JlptCsvRow } from '../parsers/jlpt.js';
import { transformKanji } from '../transform/kanji.js';
import { transformRadicals } from '../transform/radicals.js';
import { transformComponents } from '../transform/components.js';
import { transformWords, buildJlptIndex } from '../transform/words.js';

const WORD_COUNT_CEILING = 60_000;

async function main(): Promise<void> {
  console.log('loading parsed sources into memory...');
  const [kanjidic2, kradfile, radkfile, ids, jmdict, jlptRows] = await Promise.all([
    readJsonlAll<Kanjidic2Character>(PARSED.kanjidic2),
    readJsonlAll<KradfileEntry>(PARSED.kradfile),
    readJsonlAll<RadkfileEntry>(PARSED.radkfile),
    readJsonlAll<IdsEntry>(PARSED.ids),
    readJsonlAll<JMdictEntry>(PARSED.jmdict),
    readJsonlAll<JlptCsvRow>(PARSED.jlpt),
  ]);
  console.log(
    `  kanjidic2=${kanjidic2.length} kradfile=${kradfile.length} radkfile=${radkfile.length} ` +
      `ids=${ids.length} jmdict=${jmdict.length} jlpt=${jlptRows.length}`,
  );

  const kradfileMap = new Map(kradfile.map((r) => [r.character, r.components]));
  const idsMap = new Map(ids.map((r) => [r.character, r.sequences]));
  const radicalShapes = new Set(radkfile.map((r) => r.radical));

  console.log('transforming kanji...');
  const kanjiResult = transformKanji({
    kanjidic2,
    kradfile: kradfileMap,
    ids: idsMap,
    radicalShapes,
  });
  const kanjiList = kanjiResult.kanji;
  console.log(
    `  -> ${kanjiList.length} kanji (${kanjiResult.droppedNoReadingNoMeaning} dropped for having ` +
      `zero readings and zero meanings)`,
  );

  console.log('transforming radicals...');
  const radicals = transformRadicals(radkfile);
  console.log(`  -> ${radicals.length} radicals`);

  const kanjiSet = new Set(kanjiList.map((k) => k.literal));

  console.log('transforming components...');
  const components = transformComponents(kanjiList, kanjiSet);
  console.log(`  -> ${components.length} components`);

  console.log('transforming words...');
  const jlptIndex = buildJlptIndex(jlptRows);
  let result = transformWords(
    { entries: jmdict, jlptIndex, kanjiSet },
    { commonOrJlptOnly: false },
  );
  console.log(
    `  -> ${result.words.length} words (of ${result.totalBeforeFilter} entries, ` +
      `${result.droppedNoGloss} dropped for no usable gloss/reading, ` +
      `${result.changedByReRestr} had their primary reading changed by re_restr)`,
  );
  if (result.words.length > WORD_COUNT_CEILING) {
    console.log(
      `  exceeds ${WORD_COUNT_CEILING}: tightening filter to common-or-JLPT entries only.`,
    );
    result = transformWords({ entries: jmdict, jlptIndex, kanjiSet }, { commonOrJlptOnly: true });
    console.log(
      `  -> ${result.words.length} words after tightening ` +
        `(${result.changedByReRestr} had their primary reading changed by re_restr)`,
    );
  }

  console.log('writing processed files...');
  await writeAll(PROCESSED.kanji, kanjiList);
  await writeAll(PROCESSED.radicals, radicals);
  await writeAll(PROCESSED.components, components);
  await writeAll(PROCESSED.words, result.words);

  console.log('\ntransform stage complete.');
}

async function writeAll(path: string, records: unknown[]): Promise<void> {
  const writer = new JsonlWriter(path);
  await writer.open();
  for (const rec of records) {
    await writer.write(rec);
  }
  await writer.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

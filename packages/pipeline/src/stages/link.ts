/**
 * Stage 4: link. Runs after transform, since it needs every kanji and
 * word entry to exist. Builds data/processed/links.jsonl from the three
 * axis modules under src/link/, then deduplicates on
 * (from, to, axis, relation) keeping the max weight.
 */
import type { Kanji, VocabularyItem } from '@japanesesite/shared';
import { PARSED, PROCESSED } from '../lib/paths.js';
import { readJsonlAll, JsonlWriter } from '../lib/jsonl.js';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { WordnetEntry } from '../parsers/wordnet.js';
import { buildSemanticLinks } from '../link/semantic.js';
import { buildPhoneticLinks } from '../link/phonetic.js';
import { buildStructuralLinks } from '../link/structural.js';
import { dedupeLinks, symmetrizeLinks } from '../link/common.js';

async function main(): Promise<void> {
  console.log('loading processed entries and source data...');
  const [kanji, words, jmdictEntries, wordnet] = await Promise.all([
    readJsonlAll<Kanji>(PROCESSED.kanji),
    readJsonlAll<VocabularyItem>(PROCESSED.words),
    readJsonlAll<JMdictEntry>(PARSED.jmdict),
    readJsonlAll<WordnetEntry>(PARSED.wordnet),
  ]);
  console.log(`  kanji=${kanji.length} words=${words.length}`);

  console.log('building semantic links...');
  const semantic = buildSemanticLinks({ words, jmdictEntries, wordnet });
  console.log(`  -> ${semantic.length} raw semantic links`);

  console.log('building phonetic links...');
  const phonetic = buildPhoneticLinks({ words, kanji });
  console.log(`  -> ${phonetic.length} raw phonetic links`);

  console.log('building structural links...');
  const structural = buildStructuralLinks({ words, kanji });
  console.log(`  -> ${structural.length} raw structural links`);

  console.log('deduplicating on (from, to, axis, relation)...');
  const deduped = dedupeLinks([...semantic, ...phonetic, ...structural]);
  console.log(`  -> ${deduped.length} links after dedup`);

  console.log('symmetrizing capped relations (emitting any missing reverse)...');
  const { links: symmetrized, added } = symmetrizeLinks(deduped);
  console.log(`  -> added ${added} missing reverse link(s); ${symmetrized.length} links total`);

  const writer = new JsonlWriter(PROCESSED.links);
  await writer.open();
  for (const link of symmetrized) {
    await writer.write(link);
  }
  await writer.close();

  console.log('\nlink stage complete.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

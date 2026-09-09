/**
 * Stage 4: link. Runs after transform, since it needs every kanji and
 * word entry to exist. Builds two kinds of output (CLAUDE.md, "Two
 * storage shapes"):
 *
 *  - data/processed/links.jsonl: pairwise relations only
 *    (contains_kanji, contained_in, has_component, component_of,
 *    see_also, antonym), deduplicated on (from, to, axis, relation) and
 *    symmetrized.
 *  - data/processed/hubs.jsonl + hub_members.jsonl: family relations
 *    (shared_radical, shared_phonetic_component, shared_on_reading,
 *    shared_kun_reading, homophone, synonym, shared_sense), each a hub
 *    plus its memberships. A hub with fewer than two members is
 *    dropped; gloss hubs are additionally capped by size.
 */
import type { Kanji, VocabularyItem } from '@japanesesite/shared';
import { PARSED, PROCESSED } from '../lib/paths.js';
import { readJsonlAll, JsonlWriter } from '../lib/jsonl.js';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { WordnetEntry } from '../parsers/wordnet.js';
import { buildSemanticHubs, buildSemanticLinks } from '../link/semantic.js';
import { buildPhoneticHubs } from '../link/phonetic.js';
import { buildStructuralHubs, buildStructuralLinks } from '../link/structural.js';
import { dedupeLinks, symmetrizeLinks } from '../link/common.js';
import { mergeHubResults } from '../link/hubs.js';

async function main(): Promise<void> {
  console.log('loading processed entries and source data...');
  const [kanji, words, jmdictEntries, wordnet] = await Promise.all([
    readJsonlAll<Kanji>(PROCESSED.kanji),
    readJsonlAll<VocabularyItem>(PROCESSED.words),
    readJsonlAll<JMdictEntry>(PARSED.jmdict),
    readJsonlAll<WordnetEntry>(PARSED.wordnet),
  ]);
  console.log(`  kanji=${kanji.length} words=${words.length}`);

  // ---- pairwise links (see_also/antonym, contains_kanji/contained_in, has_component/component_of) ----
  console.log('building semantic links (see_also, antonym)...');
  const semanticLinks = buildSemanticLinks({ words, jmdictEntries });
  console.log(`  -> ${semanticLinks.length} raw semantic links`);

  console.log('building structural links (contains_kanji, contained_in, has_component, component_of)...');
  const structuralLinks = buildStructuralLinks({ words, kanji });
  console.log(`  -> ${structuralLinks.length} raw structural links`);

  console.log('deduplicating on (from, to, axis, relation)...');
  const deduped = dedupeLinks([...semanticLinks, ...structuralLinks]);
  console.log(`  -> ${deduped.length} links after dedup`);

  console.log('symmetrizing pairwise relations (emitting any missing reverse)...');
  const { links: symmetrized, added } = symmetrizeLinks(deduped);
  console.log(`  -> added ${added} missing reverse link(s); ${symmetrized.length} links total`);

  const linkWriter = new JsonlWriter(PROCESSED.links);
  await linkWriter.open();
  for (const link of symmetrized) {
    await linkWriter.write(link);
  }
  await linkWriter.close();

  // ---- family relations: hubs + memberships ----
  console.log('\nbuilding phonetic hubs (reading/homophone, on, kun)...');
  const phoneticHubs = buildPhoneticHubs({ words, kanji });
  console.log(
    `  -> reading=${phoneticHubs.hubs.filter((h) => h.kind === 'reading').length} ` +
      `on=${phoneticHubs.hubs.filter((h) => h.kind === 'on').length} ` +
      `kun=${phoneticHubs.hubs.filter((h) => h.kind === 'kun').length} hubs`,
  );

  console.log('building structural hubs (radical, component)...');
  const structuralHubs = buildStructuralHubs({ kanji });
  console.log(
    `  -> radical=${structuralHubs.hubs.filter((h) => h.kind === 'radical').length} ` +
      `component=${structuralHubs.hubs.filter((h) => h.kind === 'component').length} hubs`,
  );

  console.log('building semantic hubs (synset, gloss)...');
  const { hubs: semanticHubs, glossHubsDropped } = buildSemanticHubs({ words, wordnet });
  console.log(
    `  -> synset=${semanticHubs.hubs.filter((h) => h.kind === 'synset').length} ` +
      `gloss=${semanticHubs.hubs.filter((h) => h.kind === 'gloss').length} hubs ` +
      `(${glossHubsDropped} gloss hub(s) dropped for exceeding the size cap)`,
  );

  const allHubs = mergeHubResults(phoneticHubs, structuralHubs, semanticHubs);
  console.log(`\n${allHubs.hubs.length} hubs, ${allHubs.members.length} membership rows total.`);

  const hubWriter = new JsonlWriter(PROCESSED.hubs);
  await hubWriter.open();
  for (const hub of allHubs.hubs) await hubWriter.write(hub);
  await hubWriter.close();

  const memberWriter = new JsonlWriter(PROCESSED.hubMembers);
  await memberWriter.open();
  for (const member of allHubs.members) await memberWriter.write(member);
  await memberWriter.close();

  console.log('\nlink stage complete.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

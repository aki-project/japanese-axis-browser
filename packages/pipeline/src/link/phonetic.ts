/**
 * Phonetic axis: entries whose readings match exactly (homophone), and
 * kanji sharing an on-reading or a kun-reading base. Kana is compared
 * as written - no hiragana/katakana folding happens on this axis (that
 * folding only ever happens in the search_key field).
 */
import { kanjiEntryId, wordEntryId } from '@japanesesite/shared';
import type { Kanji, Link, VocabularyItem } from '@japanesesite/shared';
import { buildCappedGroupLinks, pushAll, wordWeightTier } from './common.js';

const SHARED_ON_READING_CAP = 30;
const SHARED_KUN_READING_CAP = 30;

export interface PhoneticLinkInputs {
  words: VocabularyItem[];
  kanji: Kanji[];
}

export function buildPhoneticLinks(inputs: PhoneticLinkInputs): Link[] {
  const out: Link[] = [];

  // --- Words with an identical reading, primary or alternate (kana as
  // written, no folding). A word with readings にほん/にっぽん pairs with
  // every other word that uses either reading. Weight is the *partner*
  // word's JLPT/commonness tier, so a page's homophone list can be
  // ranked by how useful that partner is to see, not a flat constant.
  const wordByEntSeq = new Map(inputs.words.map((w) => [w.entSeq, w]));
  const byReading = new Map<string, Set<number>>();
  for (const w of inputs.words) {
    for (const reading of [w.reading, ...w.alternateReadings]) {
      const set = byReading.get(reading) ?? new Set<number>();
      set.add(w.entSeq);
      byReading.set(reading, set);
    }
  }
  for (const entSeqSet of byReading.values()) {
    if (entSeqSet.size < 2) continue;
    const entSeqs = [...entSeqSet];
    for (let i = 0; i < entSeqs.length; i += 1) {
      for (let j = i + 1; j < entSeqs.length; j += 1) {
        const a = entSeqs[i];
        const b = entSeqs[j];
        if (a === undefined || b === undefined || a === b) continue;
        const wordA = wordByEntSeq.get(a);
        const wordB = wordByEntSeq.get(b);
        if (!wordA || !wordB) continue;
        out.push({
          fromEntryId: wordEntryId(a),
          toEntryId: wordEntryId(b),
          axis: 'phonetic',
          relation: 'homophone',
          weight: wordWeightTier(wordB),
          source: 'jmdict',
        });
        out.push({
          fromEntryId: wordEntryId(b),
          toEntryId: wordEntryId(a),
          axis: 'phonetic',
          relation: 'homophone',
          weight: wordWeightTier(wordA),
          source: 'jmdict',
        });
      }
    }
  }

  // --- Kanji sharing an on-reading (as written; katakana, no folding) ---
  const freqOf = new Map(inputs.kanji.map((k) => [k.literal, k.frequency]));
  const rank = (literal: string): number | null => freqOf.get(literal) ?? null;

  const onGroups = new Map<string, string[]>();
  for (const k of inputs.kanji) {
    for (const on of k.onReadings) {
      const arr = onGroups.get(on) ?? [];
      arr.push(k.literal);
      onGroups.set(on, arr);
    }
  }
  pushAll(
    out,
    buildCappedGroupLinks(
      onGroups.values(),
      kanjiEntryId,
      rank,
      SHARED_ON_READING_CAP,
      'phonetic',
      'shared_on_reading',
      0.6,
      'kanjidic2',
    ),
  );

  // --- Kanji sharing a kun-reading base (the part before the okurigana dot) ---
  const kunGroups = new Map<string, string[]>();
  for (const k of inputs.kanji) {
    for (const kun of k.kunReadings) {
      const base = kun.split('.')[0] ?? kun;
      const arr = kunGroups.get(base) ?? [];
      arr.push(k.literal);
      kunGroups.set(base, arr);
    }
  }
  pushAll(
    out,
    buildCappedGroupLinks(
      kunGroups.values(),
      kanjiEntryId,
      rank,
      SHARED_KUN_READING_CAP,
      'phonetic',
      'shared_kun_reading',
      0.5,
      'kanjidic2',
    ),
  );

  return out;
}

/**
 * Phonetic axis: entries whose readings match exactly (homophone), and
 * kanji sharing an on-reading or a kun-reading. Every phonetic relation
 * is a family relation (CLAUDE.md "Two storage shapes") - a hub plus
 * its memberships, never pairwise link rows - so this module produces
 * no links at all, only hubs. Kana is compared as written; no
 * hiragana/katakana folding happens on this axis (that folding only
 * ever happens in the search_key field).
 */
import { kanjiEntryId, kunHubKey, wordEntryId } from '@japanesesite/shared';
import type { Kanji, VocabularyItem } from '@japanesesite/shared';
import { wordHubRank } from './common.js';
import { buildHubs, mergeHubResults, type HubBuildResult, type HubGroupInput } from './hubs.js';

export interface PhoneticLinkInputs {
  words: VocabularyItem[];
  kanji: Kanji[];
}

export function buildPhoneticHubs(inputs: PhoneticLinkInputs): HubBuildResult {
  const freqOf = new Map(inputs.kanji.map((k) => [k.literal, k.frequency]));
  const kanjiRank = (literal: string): number | null => freqOf.get(literal) ?? null;

  // --- words sharing a reading (primary or alternate, kana as written).
  // One membership per distinct reading, so a word with readings
  // にほん/にっぽん joins both hubs. ---
  const readingGroups = new Map<string, HubGroupInput>();
  for (const w of inputs.words) {
    for (const reading of new Set([w.reading, ...w.alternateReadings])) {
      const group = readingGroups.get(reading) ?? { key: reading, label: reading, members: [] };
      group.members.push({ entryId: wordEntryId(w.entSeq), rank: wordHubRank(w) });
      readingGroups.set(reading, group);
    }
  }
  const readingHubs = buildHubs('reading', readingGroups.values());

  // --- kanji sharing an on-reading (as written; katakana, no folding) ---
  const onGroups = new Map<string, HubGroupInput>();
  for (const k of inputs.kanji) {
    for (const on of new Set(k.onReadings)) {
      const group = onGroups.get(on) ?? { key: on, label: on, members: [] };
      group.members.push({ entryId: kanjiEntryId(k.literal), rank: kanjiRank(k.literal) });
      onGroups.set(on, group);
    }
  }
  const onHubs = buildHubs('on', onGroups.values());

  // --- kanji sharing a kun-reading. Keyed on the full reading including
  // okurigana (kunHubKey strips bound-usage hyphens and joins the
  // okurigana), so 日 (ひ) and 引く (ひ.く) land in different hubs. The
  // label keeps the original written form (with the okurigana dot) of
  // whichever raw reading sorts first, for determinism. ---
  const kunGroups = new Map<string, HubGroupInput>();
  for (const k of inputs.kanji) {
    for (const kun of new Set(k.kunReadings)) {
      const key = kunHubKey(kun);
      const group = kunGroups.get(key);
      const member = { entryId: kanjiEntryId(k.literal), rank: kanjiRank(k.literal) };
      if (group) {
        group.members.push(member);
        if (kun < group.label) group.label = kun;
      } else {
        kunGroups.set(key, { key, label: kun, members: [member] });
      }
    }
  }
  const kunHubs = buildHubs('kun', kunGroups.values());

  return mergeHubResults(readingHubs, onHubs, kunHubs);
}

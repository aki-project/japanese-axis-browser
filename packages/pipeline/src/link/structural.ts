/**
 * Structural axis: word -> each kanji it contains, kanji -> its
 * radical/components, and kanji sharing a radical or a non-radical
 * component. Source is always decomposition data (KRADFILE/RADKFILE/IDS
 * via the kanji.components/kanji.radical fields already computed in the
 * transform stage), never string matching on characters.
 *
 * Note on the entry ID scheme: only kanji (`k:<literal>`) and words
 * (`w:<ent_seq>`) are linkable entries - there is no entry ID for a
 * Component/Radical that is not itself a kanji. So has_component and
 * component_of can only target components that are themselves present
 * in the kanji table; a component that is a bare radical shape (e.g.
 * 阝) with no kanji entry of its own still lives in the components
 * table for lookup, but cannot be a link endpoint.
 */
import { kanjiEntryId, wordEntryId } from '@japanesesite/shared';
import type { Kanji, Link, VocabularyItem } from '@japanesesite/shared';
import { addDirectedPair, buildCappedGroupLinks, pushAll, wordWeightTier } from './common.js';

const SHARED_RADICAL_CAP = 30;
const SHARED_PHONETIC_COMPONENT_CAP = 30;

export interface StructuralLinkInputs {
  words: VocabularyItem[];
  kanji: Kanji[];
}

export function buildStructuralLinks(inputs: StructuralLinkInputs): Link[] {
  const out: Link[] = [];
  const kanjiSet = new Set(inputs.kanji.map((k) => k.literal));
  const freqOf = new Map(inputs.kanji.map((k) => [k.literal, k.frequency]));
  const rank = (literal: string): number | null => freqOf.get(literal) ?? null;

  // --- word -> each kanji it contains, and the reverse under 'contained_in'
  // (so a word's page reads "contains kanji" and a kanji's page reads
  // "contained in", instead of a kanji claiming to "contain" a word) ---
  for (const w of inputs.words) {
    const chars = [...new Set([...w.surface].filter((ch) => kanjiSet.has(ch)))];
    const weight = wordWeightTier(w);
    for (const ch of chars) {
      const from = wordEntryId(w.entSeq);
      const to = kanjiEntryId(ch);
      out.push({
        fromEntryId: from,
        toEntryId: to,
        axis: 'structural',
        relation: 'contains_kanji',
        weight,
        source: 'jmdict',
      });
      out.push({
        fromEntryId: to,
        toEntryId: from,
        axis: 'structural',
        relation: 'contained_in',
        weight,
        source: 'jmdict',
      });
    }
  }

  // --- kanji -> its components (has_component / component_of) ---
  for (const k of inputs.kanji) {
    for (const comp of k.components) {
      if (!kanjiSet.has(comp)) continue; // no entry ID exists for a non-kanji component
      addDirectedPair(
        out,
        kanjiEntryId(k.literal),
        kanjiEntryId(comp),
        'structural',
        'has_component',
        'component_of',
        0.9,
        'ids',
      );
    }
  }

  // --- kanji sharing a radical ---
  const radicalGroups = new Map<string, string[]>();
  for (const k of inputs.kanji) {
    if (!k.radical) continue;
    const arr = radicalGroups.get(k.radical) ?? [];
    arr.push(k.literal);
    radicalGroups.set(k.radical, arr);
  }
  pushAll(
    out,
    buildCappedGroupLinks(
      radicalGroups.values(),
      kanjiEntryId,
      rank,
      SHARED_RADICAL_CAP,
      'structural',
      'shared_radical',
      0.5,
      'kradfile',
    ),
  );

  // --- kanji sharing a non-radical component ---
  const componentGroups = new Map<string, string[]>();
  for (const k of inputs.kanji) {
    for (const comp of k.components) {
      if (comp === k.radical) continue;
      const arr = componentGroups.get(comp) ?? [];
      arr.push(k.literal);
      componentGroups.set(comp, arr);
    }
  }
  pushAll(
    out,
    buildCappedGroupLinks(
      componentGroups.values(),
      kanjiEntryId,
      rank,
      SHARED_PHONETIC_COMPONENT_CAP,
      'structural',
      'shared_phonetic_component',
      0.6,
      'ids',
    ),
  );

  return out;
}

/**
 * Semantic axis: JMdict cross-references (see_also) and JMdict antonym
 * markers (antonym) are pairwise links. Japanese WordNet synsets
 * (synonym) and words that share an exact English gloss string
 * (shared_sense) are family relations - a synset or a gloss is
 * "everything that shares an X", so they are built as hubs, never
 * pairwise edges (CLAUDE.md, "Two storage shapes"). See
 * buildSemanticHubs.
 */
import { wordEntryId } from '@japanesesite/shared';
import type { EntryId, Link, VocabularyItem } from '@japanesesite/shared';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { WordnetEntry } from '../parsers/wordnet.js';
import { addSymmetric, wordHubRank } from './common.js';
import { buildHubs, capHubSize, mergeHubResults, type HubBuildResult, type HubGroupInput } from './hubs.js';

/** Gloss hubs are capped by SIZE (not per-entry): a gloss like "to do" is not a useful family. */
export const GLOSS_HUB_SIZE_CAP = 200;

const XREF_SEPARATOR = '・'; // ・ KATAKANA MIDDLE DOT, used by JMdict xref/ant text

interface WordLookup {
  byEntSeq: Map<number, VocabularyItem>;
  bySurface: Map<string, VocabularyItem[]>;
  byReading: Map<string, VocabularyItem[]>;
}

function buildLookup(words: VocabularyItem[]): WordLookup {
  const byEntSeq = new Map<number, VocabularyItem>();
  const bySurface = new Map<string, VocabularyItem[]>();
  const byReading = new Map<string, VocabularyItem[]>();
  const addTo = (map: Map<string, VocabularyItem[]>, key: string, w: VocabularyItem): void => {
    const arr = map.get(key) ?? [];
    arr.push(w);
    map.set(key, arr);
  };
  for (const w of words) {
    byEntSeq.set(w.entSeq, w);
    addTo(bySurface, w.surface, w);
    for (const alt of w.alternateSurfaces) addTo(bySurface, alt, w);
    addTo(byReading, w.reading, w);
    for (const alt of w.alternateReadings) addTo(byReading, alt, w);
  }
  return { byEntSeq, bySurface, byReading };
}

/** Deterministic pick among ambiguous candidates: prefer is_common, then lowest ent_seq. */
function pickBest(candidates: VocabularyItem[]): VocabularyItem | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.isCommon !== b.isCommon) return a.isCommon ? -1 : 1;
    return a.entSeq - b.entSeq;
  })[0] as VocabularyItem;
}

/**
 * Resolves a JMdict xref/ant reference string to a word already present
 * in our (filtered) word set. The text is one of: "surface",
 * "surface・reading", or "surface・N" where N is a sense index (ignored -
 * we link entry to entry, not sense to sense). Falls back to a
 * reading-only lookup when there is no surface match (kana-only
 * targets).
 */
function resolveXref(text: string, lookup: WordLookup): VocabularyItem | null {
  const parts = text.split(XREF_SEPARATOR);
  const head = parts[0] ?? '';
  if (head.length === 0) return null;
  const second = parts[1];

  if (second !== undefined && !/^\d+$/.test(second)) {
    // "surface・reading": require both to match the same word.
    const candidates = (lookup.bySurface.get(head) ?? []).filter(
      (w) => w.reading === second || w.alternateReadings.includes(second),
    );
    const best = pickBest(candidates);
    if (best) return best;
  }

  const bySurface = pickBest(lookup.bySurface.get(head) ?? []);
  if (bySurface) return bySurface;
  return pickBest(lookup.byReading.get(head) ?? []);
}

export interface SemanticLinkInputs {
  words: VocabularyItem[];
  jmdictEntries: JMdictEntry[];
}

/** see_also/antonym: pairwise links from JMdict cross-reference and antonym markers. */
export function buildSemanticLinks(inputs: SemanticLinkInputs): Link[] {
  const included = new Set(inputs.words.map((w) => w.entSeq));
  const lookup = buildLookup(inputs.words);
  const out: Link[] = [];

  for (const entry of inputs.jmdictEntries) {
    if (!included.has(entry.entSeq)) continue;
    const fromWord = lookup.byEntSeq.get(entry.entSeq);
    if (!fromWord) continue;
    const from: EntryId = wordEntryId(fromWord.entSeq);

    for (const sense of entry.sense) {
      for (const xref of sense.xref) {
        const target = resolveXref(xref, lookup);
        if (!target) continue;
        addSymmetric(
          out,
          from,
          wordEntryId(target.entSeq),
          'semantic',
          'see_also',
          0.8,
          'jmdict',
        );
      }
      for (const ant of sense.ant) {
        const target = resolveXref(ant, lookup);
        if (!target) continue;
        addSymmetric(
          out,
          from,
          wordEntryId(target.entSeq),
          'semantic',
          'antonym',
          0.9,
          'jmdict',
        );
      }
    }
  }

  return out;
}

export interface SemanticHubInputs {
  words: VocabularyItem[];
  wordnet: WordnetEntry[];
}

/** synonym (synset hubs) and shared_sense (gloss hubs): family relations. */
export function buildSemanticHubs(inputs: SemanticHubInputs): {
  hubs: HubBuildResult;
  glossHubsDropped: number;
} {
  const lookup = buildLookup(inputs.words);

  // --- Japanese WordNet: words sharing a synset ---
  const synsetLemmas = new Map<string, string[]>();
  for (const row of inputs.wordnet) {
    const arr = synsetLemmas.get(row.synset) ?? [];
    arr.push(row.lemma);
    synsetLemmas.set(row.synset, arr);
  }
  const synsetGroups = new Map<string, HubGroupInput>();
  for (const [synset, lemmas] of synsetLemmas) {
    const primaryLemmas: string[] = [];
    const members: HubGroupInput['members'] = [];
    const seenEntSeq = new Set<number>();
    for (const lemma of lemmas) {
      const candidates = [...(lookup.bySurface.get(lemma) ?? []), ...(lookup.byReading.get(lemma) ?? [])];
      const word = pickBest(candidates);
      if (!word) continue;
      const primary = word.surface === lemma || word.reading === lemma;
      if (primary) primaryLemmas.push(lemma);
      if (!seenEntSeq.has(word.entSeq)) {
        seenEntSeq.add(word.entSeq);
        members.push({ entryId: wordEntryId(word.entSeq), rank: wordHubRank(word) });
      }
    }
    // Representative lemma for the label: the lexicographically first
    // primary-matching lemma, deterministically; the synset ID itself
    // when no lemma resolved to a primary surface/reading match.
    const label = [...primaryLemmas].sort()[0] ?? synset;
    synsetGroups.set(synset, { key: synset, label, members });
  }
  const synsetHubs = buildHubs('synset', synsetGroups.values());

  // --- shared exact English gloss string ---
  const glossGroups = new Map<string, HubGroupInput>();
  for (const w of inputs.words) {
    for (const m of new Set(w.meanings)) {
      const group = glossGroups.get(m) ?? { key: m, label: m, members: [] };
      group.members.push({ entryId: wordEntryId(w.entSeq), rank: wordHubRank(w) });
      glossGroups.set(m, group);
    }
  }
  const glossHubsRaw = buildHubs('gloss', glossGroups.values());
  const { result: glossHubs, dropped: glossHubsDropped } = capHubSize(glossHubsRaw, GLOSS_HUB_SIZE_CAP);

  return { hubs: mergeHubResults(synsetHubs, glossHubs), glossHubsDropped };
}

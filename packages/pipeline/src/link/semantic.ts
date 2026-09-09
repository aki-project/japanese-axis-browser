/**
 * Semantic axis: JMdict cross-references (see_also), JMdict antonym
 * markers (antonym), Japanese WordNet synsets (synonym), and words that
 * share an exact English gloss string (shared_sense). See CLAUDE.md for
 * the axis contract.
 */
import { wordEntryId } from '@japanesesite/shared';
import type { EntryId, Link, VocabularyItem } from '@japanesesite/shared';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { WordnetEntry } from '../parsers/wordnet.js';
import { addSymmetric, capPerEntry, pushAll } from './common.js';

const SHARED_SENSE_CAP = 20;
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
  wordnet: WordnetEntry[];
}

export function buildSemanticLinks(inputs: SemanticLinkInputs): Link[] {
  const included = new Set(inputs.words.map((w) => w.entSeq));
  const lookup = buildLookup(inputs.words);
  const out: Link[] = [];

  // --- JMdict cross-references and antonyms ---
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

  // --- Japanese WordNet: words sharing a synset ---
  const synsetLemmas = new Map<string, string[]>();
  for (const row of inputs.wordnet) {
    const arr = synsetLemmas.get(row.synset) ?? [];
    arr.push(row.lemma);
    synsetLemmas.set(row.synset, arr);
  }
  for (const lemmas of synsetLemmas.values()) {
    const resolved: { word: VocabularyItem; primary: boolean }[] = [];
    for (const lemma of lemmas) {
      const candidates = [...(lookup.bySurface.get(lemma) ?? []), ...(lookup.byReading.get(lemma) ?? [])];
      const word = pickBest(candidates);
      if (!word) continue;
      const primary = word.surface === lemma || word.reading === lemma;
      resolved.push({ word, primary });
    }
    for (let i = 0; i < resolved.length; i += 1) {
      for (let j = i + 1; j < resolved.length; j += 1) {
        const a = resolved[i];
        const b = resolved[j];
        if (!a || !b || a.word.entSeq === b.word.entSeq) continue;
        const weight = a.primary && b.primary ? 1.0 : 0.7;
        addSymmetric(
          out,
          wordEntryId(a.word.entSeq),
          wordEntryId(b.word.entSeq),
          'semantic',
          'synonym',
          weight,
          'wordnet',
        );
      }
    }
  }

  // --- Shared exact English gloss string ---
  const glossGroups = new Map<string, number[]>();
  for (const w of inputs.words) {
    for (const m of new Set(w.meanings)) {
      const arr = glossGroups.get(m) ?? [];
      arr.push(w.entSeq);
      glossGroups.set(m, arr);
    }
  }
  const sharedSenseRaw: Link[] = [];
  for (const entSeqs of glossGroups.values()) {
    if (entSeqs.length < 2) continue;
    for (let i = 0; i < entSeqs.length; i += 1) {
      for (let j = i + 1; j < entSeqs.length; j += 1) {
        const a = entSeqs[i];
        const b = entSeqs[j];
        if (a === undefined || b === undefined || a === b) continue;
        addSymmetric(
          sharedSenseRaw,
          wordEntryId(a),
          wordEntryId(b),
          'semantic',
          'shared_sense',
          0.4,
          'jmdict',
        );
      }
    }
  }
  pushAll(out, capPerEntry(sharedSenseRaw, SHARED_SENSE_CAP));

  return out;
}

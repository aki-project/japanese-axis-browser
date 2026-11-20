import type { VocabularyItem } from '@japanesesite/shared';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { JlptCsvRow } from '../parsers/jlpt.js';
import { foldKana } from '@japanesesite/shared';
import { mapPartOfSpeech } from '../lib/partOfSpeech.js';

const MAX_MEANINGS = 10;

export interface JlptIndex {
  exact: Map<string, VocabularyItem['jlptLevel']>; // key: `${surface}|${reading}`
  byReading: Map<string, VocabularyItem['jlptLevel']>; // kana-only fallback
}

/** Builds the JLPT lookup index once from every jlpt-word-list row. Earlier
 * levels (processed N5 first) win on a tie, since 2_parse.ts writes rows in
 * N5..N1 order. */
export function buildJlptIndex(rows: JlptCsvRow[]): JlptIndex {
  const exact = new Map<string, VocabularyItem['jlptLevel']>();
  const byReading = new Map<string, VocabularyItem['jlptLevel']>();
  for (const row of rows) {
    const key = `${row.expression}|${row.reading}`;
    if (!exact.has(key)) exact.set(key, row.level);
    if (row.expression === row.reading && !byReading.has(row.reading)) {
      byReading.set(row.reading, row.level);
    }
  }
  return { exact, byReading };
}

function isAllKanjiInDict(surface: string, kanjiSet: ReadonlySet<string>): boolean {
  return [...surface].every((ch) => kanjiSet.has(ch));
}

export interface WordTransformInputs {
  entries: JMdictEntry[];
  jlptIndex: JlptIndex;
  kanjiSet: ReadonlySet<string>;
}

export interface WordTransformResult {
  words: VocabularyItem[];
  totalBeforeFilter: number;
  droppedNoGloss: number;
  /** Entries where re_restr changed which reading became primary (see
   * CLAUDE.md: a JMdict entry with multiple readings gets one primary
   * form chosen deterministically - re_restr says a reading only
   * applies to certain kanji forms, so blindly taking r_ele[0] can pick
   * a reading that does not even apply to the chosen surface). */
  changedByReRestr: number;
}

/**
 * Filter rule (CLAUDE.md): keep an entry if it is marked common, has a
 * JLPT level, or its primary surface is made entirely of kanji that
 * exist in KANJIDIC2 (with at least one sense - guaranteed since
 * entries with zero glosses are dropped outright). If the resulting
 * total exceeds 60k, the caller re-runs with `commonOrJlptOnly: true`.
 */
export function transformWords(
  inputs: WordTransformInputs,
  options: { commonOrJlptOnly: boolean },
): WordTransformResult {
  const words: VocabularyItem[] = [];
  let droppedNoGloss = 0;
  let changedByReRestr = 0;

  for (const entry of inputs.entries) {
    const meanings = dedupe(
      entry.sense.flatMap((s) => s.gloss.map((g) => g.text)),
    ).slice(0, MAX_MEANINGS);
    if (meanings.length === 0) {
      droppedNoGloss += 1;
      continue;
    }

    const kebs = entry.kEle.map((k) => k.keb);
    const rebs = entry.rEle.map((r) => r.reb);
    const surface = kebs[0] ?? rebs[0] ?? '';
    if (!surface || rebs.length === 0) {
      // Malformed entry with no reading at all; cannot satisfy the schema.
      droppedNoGloss += 1;
      continue;
    }

    // Primary reading: the first r_ele whose re_restr is empty (applies
    // to every kanji form) or explicitly includes the chosen surface -
    // not blindly r_ele[0], which can be a reading that doesn't even
    // apply to that surface when re_restr narrows it to a different
    // k_ele.
    const primaryIndex = entry.rEle.findIndex(
      (r) => r.reRestr.length === 0 || r.reRestr.includes(surface),
    );
    const chosenIndex = primaryIndex === -1 ? 0 : primaryIndex;
    const reading = rebs[chosenIndex] ?? '';
    if (chosenIndex !== 0) changedByReRestr += 1;

    const alternateSurfaces = kebs.slice(1);
    const alternateReadings = rebs.filter((_, idx) => idx !== chosenIndex);

    const partsOfSpeech = dedupe(
      entry.sense.flatMap((s) => s.pos.map((p) => mapPartOfSpeech(p))),
    );

    const isCommon = entry.kEle.some((k) => k.kePri.length > 0) || entry.rEle.some((r) => r.rePri.length > 0);

    const jlptLevel =
      inputs.jlptIndex.exact.get(`${surface}|${reading}`) ??
      (entry.kEle.length === 0 ? (inputs.jlptIndex.byReading.get(reading) ?? null) : null) ??
      null;

    const keep =
      isCommon ||
      jlptLevel !== null ||
      (!options.commonOrJlptOnly && isAllKanjiInDict(surface, inputs.kanjiSet));

    if (!keep) continue;

    words.push({
      entSeq: entry.entSeq,
      surface,
      reading,
      alternateSurfaces,
      alternateReadings,
      meanings,
      partsOfSpeech,
      jlptLevel,
      isCommon,
      audioUrl: null,
      searchKey: foldKana(reading),
    });
  }

  return { words, totalBeforeFilter: inputs.entries.length, droppedNoGloss, changedByReRestr };
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

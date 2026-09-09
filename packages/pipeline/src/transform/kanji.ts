import type { Kanji } from '@japanesesite/shared';
import type { Kanjidic2Character } from '../parsers/kanjidic2.js';
import { KANGXI_BY_NUMBER } from '../lib/kangxiRadicals.js';

const JLPT_OLD_SCALE: Record<number, Kanji['jlptLevel']> = {
  4: 'N5',
  3: 'N4',
  2: 'N2',
  1: 'N1',
};

/** Ideographic Description Characters (IDC), U+2FF0..U+2FFB: operators, never components. */
function isIdc(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x2ff0 && cp <= 0x2ffb;
}

/**
 * Flattens one IDS sequence into its component characters: strips a
 * trailing region tag like "[GJK]", drops the IDC operators, and keeps
 * only characters that are themselves kanji (present in `kanjiSet`) or
 * are common component shapes (present in `radicalShapes`, i.e. appear
 * as a radical in RADKFILE). Never includes the literal itself (an
 * atomic character's own IDS sequence is just the character again).
 */
export function decomposeIds(
  sequence: string,
  literal: string,
  kanjiSet: ReadonlySet<string>,
  radicalShapes: ReadonlySet<string>,
): string[] {
  const stripped = sequence.replace(/\[[^\]]*\]$/u, '');
  if (stripped === literal) return []; // atomic: cannot be decomposed further
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ch of stripped) {
    if (isIdc(ch)) continue;
    if (ch === literal) continue;
    if (!kanjiSet.has(ch) && !radicalShapes.has(ch)) continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

export interface KanjiTransformInputs {
  kanjidic2: Kanjidic2Character[];
  kradfile: Map<string, string[]>; // character -> components (first is the primary "radical")
  ids: Map<string, string[]>; // character -> alternate IDS sequences, first is primary
  radicalShapes: ReadonlySet<string>;
}

export interface KanjiTransformResult {
  kanji: Kanji[];
  /** Count of KANJIDIC2 characters dropped for having zero readings AND
   * zero meanings (unusable as an entry - e.g. a handful of very rare
   * JIS X 0212/0213 characters with no reading_meaning element at all). */
  droppedNoReadingNoMeaning: number;
}

export function transformKanji(inputs: KanjiTransformInputs): KanjiTransformResult {
  // First pass: compute readings/meanings for every character and decide
  // which survive, before building the "is this a real kanji entry" set
  // that decomposeIds and downstream structural links rely on - a
  // dropped character must be treated as a non-kanji component, not as
  // a valid link endpoint.
  const prepared = inputs.kanjidic2.map((c) => {
    const onReadings = c.readings.filter((r) => r.type === 'ja_on').map((r) => r.value);
    const kunReadings = c.readings.filter((r) => r.type === 'ja_kun').map((r) => r.value);
    const meanings = c.meanings
      .filter((m) => m.lang === null || m.lang === 'en')
      .map((m) => m.text);
    return { c, onReadings, kunReadings, meanings };
  });

  const kept = prepared.filter(
    (p) => p.onReadings.length > 0 || p.kunReadings.length > 0 || p.meanings.length > 0,
  );
  const droppedNoReadingNoMeaning = prepared.length - kept.length;

  const kanjiSet = new Set(kept.map((p) => p.c.literal));

  const kanji = kept.map(({ c, onReadings, kunReadings, meanings }): Kanji => {
    // KANJIDIC2's classical radical number is an actual radical
    // classification (KangXi Zidian order); KRADFILE is a *visual*
    // decomposition into on-screen components, not a radical-first
    // breakdown, so its first element is frequently not the radical at
    // all (e.g. 阿 decomposes visually to ｜ before its real radical 阜).
    // Prefer the classical number, and only fall back to KRADFILE's
    // first component when KANJIDIC2 has no classical radical listed.
    const classical = c.radicals.find((r) => r.type === 'classical');
    let radical: string | null = classical
      ? (KANGXI_BY_NUMBER.get(classical.value)?.character ?? null)
      : null;
    if (!radical) {
      const kradComponents = inputs.kradfile.get(c.literal);
      radical = kradComponents?.[0] ?? null;
    }

    const idsSequences = inputs.ids.get(c.literal);
    const components = idsSequences?.[0]
      ? decomposeIds(idsSequences[0], c.literal, kanjiSet, inputs.radicalShapes)
      : [];

    return {
      literal: c.literal,
      onReadings,
      kunReadings,
      meanings,
      strokeCount: c.strokeCount,
      radical,
      components,
      etymology: null,
      jlptLevel: c.jlpt !== null ? (JLPT_OLD_SCALE[c.jlpt] ?? null) : null,
      frequency: c.freq,
    };
  });

  return { kanji, droppedNoReadingNoMeaning };
}

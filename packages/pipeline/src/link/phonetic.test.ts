import { describe, expect, it } from 'vitest';
import type { Kanji, VocabularyItem } from '@japanesesite/shared';
import { buildPhoneticLinks } from './phonetic.js';
import { frequencyScaledWeight, wordWeightTier } from './common.js';

function word(overrides: Partial<VocabularyItem> & { entSeq: number; surface: string; reading: string }): VocabularyItem {
  return {
    alternateSurfaces: [],
    alternateReadings: [],
    meanings: [],
    partsOfSpeech: [],
    jlptLevel: null,
    isCommon: true,
    audioUrl: null,
    searchKey: overrides.reading,
    ...overrides,
  };
}

function kanji(overrides: Partial<Kanji> & { literal: string }): Kanji {
  return {
    onReadings: [],
    kunReadings: [],
    meanings: [],
    strokeCount: 5,
    radical: null,
    components: [],
    etymology: null,
    jlptLevel: null,
    frequency: null,
    ...overrides,
  };
}

// Five-word fixture: 甲/好 share the reading こう (homophone); 早々 has an
// alternate reading こう that also pairs it with them; 今日 has a distinct
// reading. Three kanji share the on-reading コウ (ranked by frequency);
// 行 and 生 share a kun-reading base い.
const words: VocabularyItem[] = [
  word({ entSeq: 1, surface: '甲', reading: 'こう', isCommon: true, jlptLevel: 'N3' }),
  word({ entSeq: 2, surface: '好', reading: 'こう', isCommon: true, jlptLevel: 'N4' }),
  word({ entSeq: 3, surface: '今日', reading: 'きょう', isCommon: true, jlptLevel: 'N5' }),
  word({ entSeq: 4, surface: '早々', reading: 'そうそう', alternateReadings: ['こう'], isCommon: false, jlptLevel: null }),
];

const kanjiList: Kanji[] = [
  kanji({ literal: '行', onReadings: ['コウ'], kunReadings: ['い.く'], frequency: 10 }),
  kanji({ literal: '高', onReadings: ['コウ'], kunReadings: ['たか.い'], frequency: 5 }),
  kanji({ literal: '校', onReadings: ['コウ'], kunReadings: [], frequency: 20 }),
  kanji({ literal: '生', kunReadings: ['い.きる'], frequency: 3 }),
  kanji({ literal: '本', onReadings: ['ホン'], frequency: 2 }),
];

describe('buildPhoneticLinks', () => {
  const links = buildPhoneticLinks({ words, kanji: kanjiList });

  it('links words with an identical reading as homophones, weighted by the partner word tier', () => {
    expect(links).toContainEqual({
      fromEntryId: 'w:1',
      toEntryId: 'w:2',
      axis: 'phonetic',
      relation: 'homophone',
      weight: wordWeightTier(words[1]!), // partner (w:2) tier, N4 -> 0.95
      source: 'jmdict',
    });
    expect(links).toContainEqual({
      fromEntryId: 'w:2',
      toEntryId: 'w:1',
      axis: 'phonetic',
      relation: 'homophone',
      weight: wordWeightTier(words[0]!), // partner (w:1) tier, N3 -> 0.9
      source: 'jmdict',
    });
  });

  it('includes alternateReadings when matching homophones, still comparing kana as written', () => {
    // w:4's alternate reading こう pairs it with both w:1 and w:2.
    expect(links).toContainEqual(
      expect.objectContaining({ fromEntryId: 'w:1', toEntryId: 'w:4', relation: 'homophone' }),
    );
    expect(links).toContainEqual(
      expect.objectContaining({ fromEntryId: 'w:4', toEntryId: 'w:1', relation: 'homophone' }),
    );
    expect(links).toContainEqual(
      expect.objectContaining({ fromEntryId: 'w:4', toEntryId: 'w:2', relation: 'homophone' }),
    );
  });

  it('does not link words with different readings', () => {
    expect(links.some((l) => l.relation === 'homophone' && (l.fromEntryId === 'w:3' || l.toEntryId === 'w:3'))).toBe(
      false,
    );
  });

  it('links kanji sharing an on-reading, weight scaled by the partner kanji frequency rank', () => {
    expect(links).toContainEqual({
      fromEntryId: 'k:行',
      toEntryId: 'k:高',
      axis: 'phonetic',
      relation: 'shared_on_reading',
      weight: frequencyScaledWeight(0.6, 5),
      source: 'kanjidic2',
    });
    // 高 (freq 5) ranks ahead of 校 (freq 20) from 行's perspective, but
    // both are within the (large) cap so both still appear.
    expect(links).toContainEqual(
      expect.objectContaining({
        fromEntryId: 'k:行',
        toEntryId: 'k:校',
        weight: frequencyScaledWeight(0.6, 20),
      }),
    );
  });

  it('links kanji sharing a kun-reading base, ignoring the reading after the dot', () => {
    expect(links).toContainEqual({
      fromEntryId: 'k:行',
      toEntryId: 'k:生',
      axis: 'phonetic',
      relation: 'shared_kun_reading',
      weight: frequencyScaledWeight(0.5, 3),
      source: 'kanjidic2',
    });
  });

  it('does not link 本, which shares no reading with anything else', () => {
    expect(links.some((l) => l.fromEntryId === 'k:本' || l.toEntryId === 'k:本')).toBe(false);
  });
});

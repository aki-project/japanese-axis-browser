import { describe, expect, it } from 'vitest';
import type { Kanji, VocabularyItem } from '@japanesesite/shared';
import { buildStructuralLinks } from './structural.js';
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

// Five-entry fixture: 日本 is made of 日 and 本; 本 decomposes to the
// component 木, which is itself a kanji entry here (so has_component /
// component_of can target it); 木 and 林 share the radical 木.
const words: VocabularyItem[] = [word({ entSeq: 1, surface: '日本', reading: 'にほん' })];

const kanjiList: Kanji[] = [
  kanji({ literal: '日', radical: '日', frequency: 1 }),
  kanji({ literal: '本', components: ['木'], radical: '木', frequency: 2 }),
  kanji({ literal: '木', radical: '木', frequency: 3 }),
  kanji({ literal: '林', components: ['木'], radical: '木', frequency: 4 }),
  kanji({ literal: '山', radical: '山', frequency: 5 }),
];

describe('buildStructuralLinks', () => {
  const links = buildStructuralLinks({ words, kanji: kanjiList });

  it('links a word to each kanji it contains, and the reverse under contained_in', () => {
    const tier = wordWeightTier(words[0]!); // is_common, no JLPT -> 0.7
    expect(links).toContainEqual({
      fromEntryId: 'w:1',
      toEntryId: 'k:日',
      axis: 'structural',
      relation: 'contains_kanji',
      weight: tier,
      source: 'jmdict',
    });
    expect(links).toContainEqual({
      fromEntryId: 'k:日',
      toEntryId: 'w:1',
      axis: 'structural',
      relation: 'contained_in',
      weight: tier,
      source: 'jmdict',
    });
  });

  it('links a kanji to a component that is itself a kanji entry (has_component/component_of)', () => {
    expect(links).toContainEqual({
      fromEntryId: 'k:本',
      toEntryId: 'k:木',
      axis: 'structural',
      relation: 'has_component',
      weight: 0.9,
      source: 'ids',
    });
    expect(links).toContainEqual({
      fromEntryId: 'k:木',
      toEntryId: 'k:本',
      axis: 'structural',
      relation: 'component_of',
      weight: 0.9,
      source: 'ids',
    });
  });

  it('links kanji sharing a radical, weight scaled by the partner kanji frequency rank', () => {
    expect(links).toContainEqual({
      fromEntryId: 'k:木',
      toEntryId: 'k:林',
      axis: 'structural',
      relation: 'shared_radical',
      weight: frequencyScaledWeight(0.5, 4), // 林's frequency
      source: 'kradfile',
    });
    expect(links).toContainEqual({
      fromEntryId: 'k:本',
      toEntryId: 'k:木',
      axis: 'structural',
      relation: 'shared_radical',
      weight: frequencyScaledWeight(0.5, 3), // 木's frequency
      source: 'kradfile',
    });
  });

  it('does not link 山, which shares no radical or component with anything else', () => {
    expect(links.some((l) => l.fromEntryId === 'k:山' || l.toEntryId === 'k:山')).toBe(false);
  });

  it('never links an entry to itself', () => {
    expect(links.every((l) => l.fromEntryId !== l.toEntryId)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { Kanji, VocabularyItem } from '@japanesesite/shared';
import { buildStructuralHubs, buildStructuralLinks } from './structural.js';
import { wordWeightTier } from './common.js';

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

  it('never links an entry to itself', () => {
    expect(links.every((l) => l.fromEntryId !== l.toEntryId)).toBe(true);
  });

  it('carries no shared_radical or shared_phonetic_component links - those are hubs now', () => {
    expect(links.some((l) => l.relation === 'shared_radical')).toBe(false);
    expect(links.some((l) => l.relation === 'shared_phonetic_component')).toBe(false);
  });
});

describe('buildStructuralHubs', () => {
  const result = buildStructuralHubs({ kanji: kanjiList });

  it('groups kanji sharing a radical into a radical hub, ranked by KANJIDIC2 frequency', () => {
    const hub = result.hubs.find((h) => h.hubId === 'h:radical:木');
    expect(hub?.memberCount).toBe(3);
    expect(hub?.label).toBe('木');
    const members = result.members.filter((m) => m.hubId === 'h:radical:木');
    expect(members.map((m) => m.entryId).sort()).toEqual(['k:本', 'k:木', 'k:林'].sort());
    const honRank = members.find((m) => m.entryId === 'k:本');
    expect(honRank?.rank).toBe(2);
  });

  it('does not create a radical hub for a radical used by only one kanji', () => {
    expect(result.hubs.some((h) => h.hubId === 'h:radical:日')).toBe(false);
    expect(result.hubs.some((h) => h.hubId === 'h:radical:山')).toBe(false);
  });

  it('does not double-count a kanji whose own radical equals its component', () => {
    // 本's component 木 equals its radical 木, so it must not also appear
    // as a "shared non-radical component" hub member.
    expect(result.hubs.some((h) => h.hubId === 'h:component:木')).toBe(false);
  });

  it('member_count always equals the number of membership rows written for that hub', () => {
    for (const hub of result.hubs) {
      const rows = result.members.filter((m) => m.hubId === hub.hubId).length;
      expect(hub.memberCount).toBe(rows);
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { Kanji, VocabularyItem } from '@japanesesite/shared';
import { buildPhoneticHubs } from './phonetic.js';

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

function hubMembers(result: ReturnType<typeof buildPhoneticHubs>, hubId: string) {
  return result.members.filter((m) => m.hubId === hubId).map((m) => m.entryId).sort();
}

// Five-word fixture: 甲/好 share the reading こう (homophone hub); 早々 has
// an alternate reading こう that also joins that hub; 今日 has a distinct
// reading. Three kanji share the on-reading コウ (ranked by frequency);
// 行 and 生 share a kun-reading base い but with different okurigana
// (い.く vs い.きる), so they must NOT share a kun hub.
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
  kanji({ literal: '日', kunReadings: ['ひ'], frequency: 1 }),
  kanji({ literal: '引', kunReadings: ['ひ.く'], frequency: 100 }),
];

describe('buildPhoneticHubs', () => {
  const result = buildPhoneticHubs({ words, kanji: kanjiList });

  it('groups words with an identical reading into a reading hub', () => {
    expect(hubMembers(result, 'h:reading:こう')).toEqual(['w:1', 'w:2', 'w:4']);
  });

  it('includes alternateReadings as an extra membership, still comparing kana as written', () => {
    // w:4's primary reading is そうそう (no hub, only one member) but its
    // alternate reading こう joins the こう hub above as well - one
    // membership per distinct reading.
    const hub = result.hubs.find((h) => h.hubId === 'h:reading:こう');
    expect(hub?.memberCount).toBe(3);
    expect(result.members.filter((m) => m.entryId === 'w:4')).toHaveLength(1);
    expect(result.hubs.some((h) => h.hubId === 'h:reading:そうそう')).toBe(false); // dropped, only one member
  });

  it('does not create a hub for a reading used by only one word', () => {
    expect(result.hubs.some((h) => h.hubId === 'h:reading:きょう')).toBe(false);
  });

  it('groups kanji sharing an on-reading into an on hub, ranked by KANJIDIC2 frequency', () => {
    expect(hubMembers(result, 'h:on:コウ')).toEqual(['k:校', 'k:行', 'k:高'].sort());
    const hub = result.hubs.find((h) => h.hubId === 'h:on:コウ');
    expect(hub?.memberCount).toBe(3);
    const highRank = result.members.find((m) => m.hubId === 'h:on:コウ' && m.entryId === 'k:高');
    expect(highRank?.rank).toBe(5);
  });

  it('separates kun-reading hubs that differ only in okurigana (ひ vs ひ.く)', () => {
    expect(result.hubs.some((h) => h.hubId === 'h:kun:ひ')).toBe(false); // 日 is the only member
    expect(result.hubs.some((h) => h.hubId === 'h:kun:ひく')).toBe(false); // 引 is the only member
    // 行 (い.く) and 生 (い.きる) differ after okurigana removal too (いく vs いきる).
    expect(result.hubs.some((h) => h.hubId === 'h:kun:いく')).toBe(false);
  });

  it('groups kanji sharing a full kun reading (including okurigana) into one kun hub', () => {
    const moreKanji = [...kanjiList, kanji({ literal: '弾', kunReadings: ['ひ.く'], frequency: 200 })];
    const withPair = buildPhoneticHubs({ words, kanji: moreKanji });
    expect(hubMembers(withPair, 'h:kun:ひく')).toEqual(['k:引', 'k:弾']);
  });

  it('gives every hub member_count equal to its row count', () => {
    for (const hub of result.hubs) {
      const rows = result.members.filter((m) => m.hubId === hub.hubId).length;
      expect(hub.memberCount).toBe(rows);
    }
  });

  it('does not create a hub for 本, which shares no reading with anything else', () => {
    expect(result.members.some((m) => m.entryId === 'k:本')).toBe(false);
  });
});

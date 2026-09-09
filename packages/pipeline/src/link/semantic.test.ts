import { describe, expect, it } from 'vitest';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { WordnetEntry } from '../parsers/wordnet.js';
import type { VocabularyItem } from '@japanesesite/shared';
import { GLOSS_HUB_SIZE_CAP, buildSemanticHubs, buildSemanticLinks } from './semantic.js';

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

function entry(overrides: Partial<JMdictEntry> & { entSeq: number }): JMdictEntry {
  return { kEle: [], rEle: [], sense: [], ...overrides };
}

// Five-word fixture: 行く -see_also-> 見る (via xref); 早い -antonym-> 遅い
// (via ant); 行く and 早い share a WordNet synset (synonym hub); 見る and
// 見物 share the exact gloss "to look" (shared_sense/gloss hub).
const words: VocabularyItem[] = [
  word({ entSeq: 1, surface: '行く', reading: 'いく', meanings: ['to go'] }),
  word({ entSeq: 2, surface: '見る', reading: 'みる', meanings: ['to see', 'to look'] }),
  word({ entSeq: 3, surface: '早い', reading: 'はやい', meanings: ['fast'] }),
  word({ entSeq: 4, surface: '遅い', reading: 'おそい', meanings: ['slow'] }),
  word({ entSeq: 5, surface: '見物', reading: 'けんぶつ', meanings: ['to look', 'sightseeing'] }),
];

const jmdictEntries: JMdictEntry[] = [
  entry({
    entSeq: 1,
    rEle: [{ reb: 'いく', reNokanji: false, reRestr: [], reInf: [], rePri: [] }],
    kEle: [{ keb: '行く', keInf: [], kePri: [] }],
    sense: [{ pos: [], xref: ['見る'], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [] }],
  }),
  entry({
    entSeq: 3,
    rEle: [{ reb: 'はやい', reNokanji: false, reRestr: [], reInf: [], rePri: [] }],
    kEle: [{ keb: '早い', keInf: [], kePri: [] }],
    sense: [{ pos: [], xref: [], ant: ['遅い'], field: [], misc: [], dial: [], sInf: [], gloss: [] }],
  }),
];

const wordnet: WordnetEntry[] = [
  { synset: 's1', lemma: '行く', source: 'hand' },
  { synset: 's1', lemma: '早い', source: 'hand' },
];

describe('buildSemanticLinks', () => {
  const links = buildSemanticLinks({ words, jmdictEntries });

  it('emits a see_also link both ways for a resolved xref', () => {
    expect(links).toContainEqual({
      fromEntryId: 'w:1',
      toEntryId: 'w:2',
      axis: 'semantic',
      relation: 'see_also',
      weight: 0.8,
      source: 'jmdict',
    });
    expect(links).toContainEqual({
      fromEntryId: 'w:2',
      toEntryId: 'w:1',
      axis: 'semantic',
      relation: 'see_also',
      weight: 0.8,
      source: 'jmdict',
    });
  });

  it('emits an antonym link both ways for a resolved ant, with an explicit weight', () => {
    expect(links).toContainEqual(
      expect.objectContaining({ fromEntryId: 'w:3', toEntryId: 'w:4', relation: 'antonym', weight: 0.9 }),
    );
    expect(links).toContainEqual(
      expect.objectContaining({ fromEntryId: 'w:4', toEntryId: 'w:3', relation: 'antonym', weight: 0.9 }),
    );
  });

  it('never links an entry to itself', () => {
    expect(links.every((l) => l.fromEntryId !== l.toEntryId)).toBe(true);
  });

  it('carries no synonym or shared_sense links - those are hubs now', () => {
    expect(links.some((l) => l.relation === 'synonym')).toBe(false);
    expect(links.some((l) => l.relation === 'shared_sense')).toBe(false);
  });
});

describe('buildSemanticHubs', () => {
  it('groups words sharing a WordNet synset into a synset hub, labelled by a representative lemma', () => {
    const { hubs } = buildSemanticHubs({ words, wordnet });
    const hub = hubs.hubs.find((h) => h.hubId === 'h:synset:s1');
    expect(hub?.memberCount).toBe(2);
    expect(hub?.label).toBe('早い'); // lexicographically first primary lemma
    expect(hubs.members.filter((m) => m.hubId === 'h:synset:s1').map((m) => m.entryId).sort()).toEqual(
      ['w:1', 'w:3'].sort(),
    );
  });

  it('falls back to the synset ID as the label when no lemma resolves to a primary match', () => {
    // Both lemmas resolve to a word only via an alternate surface, never
    // the word's own primary surface/reading, so neither counts as "primary".
    const wordsForFallback: VocabularyItem[] = [
      word({ entSeq: 10, surface: '甲', reading: 'こう', alternateSurfaces: ['alt-a'], meanings: ['x'] }),
      word({ entSeq: 11, surface: '乙', reading: 'おつ', alternateSurfaces: ['alt-b'], meanings: ['y'] }),
    ];
    const wordnetNonPrimary: WordnetEntry[] = [
      { synset: 's9', lemma: 'alt-a', source: 'auto' },
      { synset: 's9', lemma: 'alt-b', source: 'auto' },
    ];
    const { hubs } = buildSemanticHubs({ words: wordsForFallback, wordnet: wordnetNonPrimary });
    const hub = hubs.hubs.find((h) => h.hubId === 'h:synset:s9');
    expect(hub?.memberCount).toBe(2);
    expect(hub?.label).toBe('s9');
  });

  it('groups words sharing an exact gloss string into a gloss hub', () => {
    const { hubs } = buildSemanticHubs({ words, wordnet: [] });
    const hub = hubs.hubs.find((h) => h.hubId === 'h:gloss:to look');
    expect(hub?.memberCount).toBe(2);
    expect(hub?.label).toBe('to look');
    expect(hubs.members.filter((m) => m.hubId === 'h:gloss:to look').map((m) => m.entryId).sort()).toEqual(
      ['w:2', 'w:5'].sort(),
    );
  });

  it('does not create a gloss hub for a gloss used by only one word', () => {
    const { hubs } = buildSemanticHubs({ words, wordnet: [] });
    expect(hubs.hubs.some((h) => h.hubId === 'h:gloss:to go')).toBe(false);
  });

  it('drops any gloss hub with more than the size cap members, and reports the count', () => {
    const manyWords: VocabularyItem[] = Array.from({ length: GLOSS_HUB_SIZE_CAP + 5 }, (_, i) =>
      word({ entSeq: 1000 + i, surface: `w${i}`, reading: `r${i}`, meanings: ['to do'] }),
    );
    const { hubs, glossHubsDropped } = buildSemanticHubs({ words: manyWords, wordnet: [] });
    expect(hubs.hubs.some((h) => h.hubId === 'h:gloss:to do')).toBe(false);
    expect(glossHubsDropped).toBe(1);
  });

  it('member_count always equals the number of membership rows written for that hub', () => {
    const { hubs } = buildSemanticHubs({ words, wordnet });
    for (const hub of hubs.hubs) {
      const rows = hubs.members.filter((m) => m.hubId === hub.hubId).length;
      expect(hub.memberCount).toBe(rows);
    }
  });
});

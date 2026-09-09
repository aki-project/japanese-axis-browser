import { describe, expect, it } from 'vitest';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { WordnetEntry } from '../parsers/wordnet.js';
import type { VocabularyItem } from '@japanesesite/shared';
import { buildSemanticLinks } from './semantic.js';

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
// (via ant); 行く and 早い share a WordNet synset (synonym); 見る and 見物
// share the exact gloss "to look" (shared_sense).
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
  const links = buildSemanticLinks({ words, jmdictEntries, wordnet });

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

  it('emits a synonym link at weight 1.0 when both lemmas are primary matches', () => {
    expect(links).toContainEqual({
      fromEntryId: 'w:1',
      toEntryId: 'w:3',
      axis: 'semantic',
      relation: 'synonym',
      weight: 1.0,
      source: 'wordnet',
    });
  });

  it('emits a shared_sense link for words with an exact matching gloss string', () => {
    expect(links).toContainEqual(
      expect.objectContaining({
        fromEntryId: 'w:2',
        toEntryId: 'w:5',
        relation: 'shared_sense',
        weight: 0.4,
      }),
    );
  });

  it('never links an entry to itself', () => {
    expect(links.every((l) => l.fromEntryId !== l.toEntryId)).toBe(true);
  });
});

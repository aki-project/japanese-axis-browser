import { describe, expect, it } from 'vitest';
import { buildJlptIndex, transformWords } from './words.js';
import type { JMdictEntry } from '../parsers/jmdict.js';
import type { JlptCsvRow } from '../parsers/jlpt.js';

function makeEntry(overrides: Partial<JMdictEntry> & { entSeq: number }): JMdictEntry {
  return { kEle: [], rEle: [], sense: [], ...overrides };
}

const emptyJlpt = buildJlptIndex([]);
const kanjiSet = new Set(['日', '本', '語']);

describe('transformWords', () => {
  it('handles an entry with no k_ele (kana-only word) by using the reading as the surface', () => {
    const entry = makeEntry({
      entSeq: 1,
      rEle: [{ reb: 'あかん', reNokanji: false, reRestr: [], reInf: [], rePri: ['news1'] }],
      sense: [{ pos: ['exp'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'useless' }] }],
    });
    const { words } = transformWords({ entries: [entry], jlptIndex: emptyJlpt, kanjiSet }, { commonOrJlptOnly: false });
    expect(words).toHaveLength(1);
    expect(words[0]?.surface).toBe('あかん');
    expect(words[0]?.reading).toBe('あかん');
    expect(words[0]?.alternateSurfaces).toEqual([]);
  });

  it('picks the first k_ele/r_ele as primary and keeps the rest as alternates (multiple readings)', () => {
    const entry = makeEntry({
      entSeq: 2,
      kEle: [{ keb: '日本', keInf: [], kePri: ['news1'] }],
      rEle: [
        { reb: 'にほん', reNokanji: false, reRestr: [], reInf: [], rePri: ['news1'] },
        { reb: 'にっぽん', reNokanji: false, reRestr: [], reInf: [], rePri: [] },
      ],
      sense: [{ pos: ['n'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'Japan' }] }],
    });
    const { words } = transformWords({ entries: [entry], jlptIndex: emptyJlpt, kanjiSet }, { commonOrJlptOnly: false });
    expect(words[0]?.surface).toBe('日本');
    expect(words[0]?.reading).toBe('にほん');
    expect(words[0]?.alternateReadings).toEqual(['にっぽん']);
    expect(words[0]?.searchKey).toBe('にほん');
  });

  it('folds a katakana reading into the search_key without touching the surface/reading fields', () => {
    const entry = makeEntry({
      entSeq: 3,
      rEle: [{ reb: 'アカン', reNokanji: false, reRestr: [], reInf: [], rePri: ['news1'] }],
      sense: [{ pos: ['exp'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'useless' }] }],
    });
    const { words } = transformWords({ entries: [entry], jlptIndex: emptyJlpt, kanjiSet }, { commonOrJlptOnly: false });
    expect(words[0]?.reading).toBe('アカン');
    expect(words[0]?.searchKey).toBe('あかん');
  });

  it('drops an entry with no reading at all', () => {
    const entry = makeEntry({ entSeq: 4, sense: [{ pos: [], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'x' }] }] });
    const { words, droppedNoGloss } = transformWords(
      { entries: [entry], jlptIndex: emptyJlpt, kanjiSet },
      { commonOrJlptOnly: false },
    );
    expect(words).toHaveLength(0);
    expect(droppedNoGloss).toBe(1);
  });

  it('keeps a non-common, non-JLPT entry whose surface is entirely kanji already in KANJIDIC2', () => {
    const entry = makeEntry({
      entSeq: 5,
      kEle: [{ keb: '日本語', keInf: [], kePri: [] }],
      rEle: [{ reb: 'にほんご', reNokanji: false, reRestr: [], reInf: [], rePri: [] }],
      sense: [{ pos: ['n'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'Japanese' }] }],
    });
    const { words } = transformWords({ entries: [entry], jlptIndex: emptyJlpt, kanjiSet }, { commonOrJlptOnly: false });
    expect(words).toHaveLength(1);
  });

  it('drops that same all-kanji entry once commonOrJlptOnly tightening is in effect', () => {
    const entry = makeEntry({
      entSeq: 5,
      kEle: [{ keb: '日本語', keInf: [], kePri: [] }],
      rEle: [{ reb: 'にほんご', reNokanji: false, reRestr: [], reInf: [], rePri: [] }],
      sense: [{ pos: ['n'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'Japanese' }] }],
    });
    const { words } = transformWords({ entries: [entry], jlptIndex: emptyJlpt, kanjiSet }, { commonOrJlptOnly: true });
    expect(words).toHaveLength(0);
  });

  it('drops a non-common entry with a kana surface and no JLPT level', () => {
    const entry = makeEntry({
      entSeq: 6,
      rEle: [{ reb: 'ぽえ', reNokanji: false, reRestr: [], reInf: [], rePri: [] }],
      sense: [{ pos: ['int'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'huh' }] }],
    });
    const { words } = transformWords({ entries: [entry], jlptIndex: emptyJlpt, kanjiSet }, { commonOrJlptOnly: false });
    expect(words).toHaveLength(0);
  });

  it('caps meanings at 10 and dedupes them', () => {
    const gloss = Array.from({ length: 15 }, (_, i) => ({ lang: null, text: `meaning ${i % 12}` }));
    const entry = makeEntry({
      entSeq: 7,
      rEle: [{ reb: 'てすと', reNokanji: false, reRestr: [], reInf: [], rePri: ['news1'] }],
      sense: [{ pos: ['n'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss }],
    });
    const { words } = transformWords({ entries: [entry], jlptIndex: emptyJlpt, kanjiSet }, { commonOrJlptOnly: false });
    expect(words[0]?.meanings.length).toBe(10);
    expect(new Set(words[0]?.meanings).size).toBe(10);
  });

  it('assigns a JLPT level by exact (surface, reading) match, and by reading alone for kana-only words', () => {
    const rows: JlptCsvRow[] = [
      { level: 'N5', expression: '本', reading: 'ほん', meaning: 'book', tags: '' },
      { level: 'N4', expression: 'あかん', reading: 'あかん', meaning: 'useless', tags: '' },
    ];
    const index = buildJlptIndex(rows);
    const withKanji = makeEntry({
      entSeq: 8,
      kEle: [{ keb: '本', keInf: [], kePri: [] }],
      rEle: [{ reb: 'ほん', reNokanji: false, reRestr: [], reInf: [], rePri: [] }],
      sense: [{ pos: ['n'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'book' }] }],
    });
    const kanaOnly = makeEntry({
      entSeq: 9,
      rEle: [{ reb: 'あかん', reNokanji: false, reRestr: [], reInf: [], rePri: [] }],
      sense: [{ pos: ['exp'], xref: [], ant: [], field: [], misc: [], dial: [], sInf: [], gloss: [{ lang: null, text: 'useless' }] }],
    });
    const { words } = transformWords(
      { entries: [withKanji, kanaOnly], jlptIndex: index, kanjiSet },
      { commonOrJlptOnly: false },
    );
    expect(words.find((w) => w.entSeq === 8)?.jlptLevel).toBe('N5');
    expect(words.find((w) => w.entSeq === 9)?.jlptLevel).toBe('N4');
  });
});

import { describe, expect, it } from 'vitest';
import { decomposeIds, transformKanji } from './kanji.js';
import type { Kanjidic2Character } from '../parsers/kanjidic2.js';

function makeChar(overrides: Partial<Kanjidic2Character> & { literal: string }): Kanjidic2Character {
  return {
    codepoints: [],
    radicals: [],
    grade: null,
    strokeCount: 4,
    freq: null,
    jlpt: null,
    readings: [],
    meanings: [],
    nanori: [],
    ...overrides,
  };
}

describe('decomposeIds', () => {
  const kanjiSet = new Set(['日', '月', '明', '亀']);
  const radicalShapes = new Set(['⼕']);

  it('flattens a simple two-operand IDS sequence, dropping the IDC operator', () => {
    expect(decomposeIds('⿰日月', '明', kanjiSet, radicalShapes)).toEqual(['日', '月']);
  });

  it('is atomic (no components) when the sequence is just the literal itself', () => {
    expect(decomposeIds('日', '日', kanjiSet, radicalShapes)).toEqual([]);
  });

  it('strips a trailing region tag like [GJK] before decomposing', () => {
    expect(decomposeIds('⿰日月[GJK]', '明', kanjiSet, radicalShapes)).toEqual(['日', '月']);
  });

  it('flattens nested IDC operators, keeping every non-operator character', () => {
    // ⿱𠂊⿻日电 -> operators ⿱ and ⿻ dropped, 𠂊 and 电 are neither kanji
    // nor known radical shapes so they drop out too, leaving 日.
    expect(decomposeIds('⿱𠂊⿻日电', '亀', kanjiSet, radicalShapes)).toEqual(['日']);
  });

  it('drops characters that are neither a known kanji nor a common component shape', () => {
    expect(decomposeIds('⿰日𡈼', '明', kanjiSet, radicalShapes)).toEqual(['日']);
  });

  it('keeps a common component shape that is not itself a kanji entry', () => {
    expect(decomposeIds('⿰⼕日', '明', kanjiSet, radicalShapes)).toEqual(['⼕', '日']);
  });
});

describe('transformKanji', () => {
  it('maps the old 4-level KANJIDIC2 jlpt scale onto our JLPT levels', () => {
    const { kanji } = transformKanji({
      kanjidic2: [
        makeChar({ literal: '一', jlpt: 4, meanings: [{ lang: null, text: 'one' }] }),
        makeChar({ literal: '二', jlpt: 3, meanings: [{ lang: null, text: 'two' }] }),
        makeChar({ literal: '三', jlpt: 2, meanings: [{ lang: null, text: 'three' }] }),
        makeChar({ literal: '四', jlpt: 1, meanings: [{ lang: null, text: 'four' }] }),
        makeChar({ literal: '五', jlpt: null, meanings: [{ lang: null, text: 'five' }] }),
      ],
      kradfile: new Map(),
      ids: new Map(),
      radicalShapes: new Set(),
    });
    const [k1, k2, k3, k4, k5] = kanji;
    expect(k1?.jlptLevel).toBe('N5');
    expect(k2?.jlptLevel).toBe('N4');
    expect(k3?.jlptLevel).toBe('N2');
    expect(k4?.jlptLevel).toBe('N1');
    expect(k5?.jlptLevel).toBeNull(); // no N3 in the old scale
  });

  it('handles a kanji with no decomposition data at all (no KRADFILE, no IDS entry)', () => {
    const { kanji } = transformKanji({
      kanjidic2: [
        makeChar({
          literal: '嘸',
          radicals: [{ type: 'classical', value: 30 }],
          meanings: [{ lang: null, text: 'placeholder' }],
        }),
      ],
      kradfile: new Map(),
      ids: new Map(),
      radicalShapes: new Set(),
    });
    const [k] = kanji;
    expect(k?.components).toEqual([]);
    expect(k?.radical).toBe('口'); // classical radical 30, via the Kangxi fallback table
  });

  it('prefers the KANJIDIC2 classical radical number over KRADFILE (KRADFILE is a visual decomposition, not radical-first)', () => {
    const { kanji } = transformKanji({
      kanjidic2: [
        makeChar({
          literal: '明',
          radicals: [{ type: 'classical', value: 72 }],
          meanings: [{ lang: null, text: 'bright' }],
        }),
        makeChar({ literal: '日', meanings: [{ lang: null, text: 'day' }] }),
        makeChar({ literal: '月', meanings: [{ lang: null, text: 'moon' }] }),
      ],
      // KRADFILE's first listed component for 明 is 日 too here, but the
      // point of this test is that the classical number (-> 日, radical
      // #72) wins regardless of what KRADFILE says.
      kradfile: new Map([['明', ['日', '月']]]),
      ids: new Map([['明', ['⿰日月']]]),
      radicalShapes: new Set(),
    });
    const k = kanji.find((c) => c.literal === '明');
    expect(k?.radical).toBe('日'); // from KANGXI_BY_NUMBER[72], not KRADFILE
    expect(k?.components).toEqual(['日', '月']);
  });

  it('falls back to KRADFILE only when KANJIDIC2 has no classical radical number', () => {
    const { kanji } = transformKanji({
      kanjidic2: [
        makeChar({ literal: '阿', radicals: [], meanings: [{ lang: null, text: 'flatter' }] }),
      ],
      kradfile: new Map([['阿', ['｜', '一', '口']]]),
      ids: new Map(),
      radicalShapes: new Set(),
    });
    const [k] = kanji;
    expect(k?.radical).toBe('｜');
  });

  it('keeps only English (or unlabeled) meanings, dropping other-language glosses', () => {
    const { kanji } = transformKanji({
      kanjidic2: [
        makeChar({
          literal: '愛',
          meanings: [
            { lang: null, text: 'love' },
            { lang: 'fr', text: 'amour' },
            { lang: 'en', text: 'affection' },
          ],
        }),
      ],
      kradfile: new Map(),
      ids: new Map(),
      radicalShapes: new Set(),
    });
    const [k] = kanji;
    expect(k?.meanings).toEqual(['love', 'affection']);
  });

  it('drops a kanji with zero readings AND zero meanings, and reports the count', () => {
    const { kanji, droppedNoReadingNoMeaning } = transformKanji({
      kanjidic2: [
        makeChar({ literal: '一', meanings: [{ lang: null, text: 'one' }] }),
        makeChar({ literal: '空', readings: [{ type: 'ja_on', value: 'クウ' }] }),
        makeChar({ literal: '嘸' }), // no readings, no meanings at all
      ],
      kradfile: new Map(),
      ids: new Map(),
      radicalShapes: new Set(),
    });
    expect(kanji.map((k) => k.literal)).toEqual(['一', '空']);
    expect(droppedNoReadingNoMeaning).toBe(1);
  });

  it('treats a dropped (readingless, meaningless) character as a non-kanji component', () => {
    const { kanji } = transformKanji({
      kanjidic2: [
        makeChar({ literal: '明', meanings: [{ lang: null, text: 'bright' }] }),
        makeChar({ literal: '嘸' }), // dropped: no readings, no meanings
      ],
      kradfile: new Map(),
      ids: new Map([['明', ['⿰嘸日']]]),
      radicalShapes: new Set(),
    });
    const k = kanji.find((c) => c.literal === '明');
    // 嘸 is dropped from the kanji table, and 日 was never a kanjidic2
    // entry in this fixture either, so neither survives as a component.
    expect(k?.components).toEqual([]);
  });
});

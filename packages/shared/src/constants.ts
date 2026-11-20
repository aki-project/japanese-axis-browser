export const AXES = ['semantic', 'phonetic', 'structural'] as const;
export type Axis = (typeof AXES)[number];

export const RELATIONS_BY_AXIS = {
  semantic: ['synonym', 'antonym', 'see_also', 'shared_sense'],
  phonetic: ['homophone', 'shared_on_reading', 'shared_kun_reading'],
  structural: [
    'contains_kanji',
    'contained_in',
    'component_of',
    'has_component',
    'shared_radical',
    'shared_phonetic_component',
  ],
} as const satisfies Record<Axis, readonly string[]>;

export type Relation = (typeof RELATIONS_BY_AXIS)[Axis][number];
// Typed as a non-empty tuple (rather than a plain readonly Relation[]) so
// z.enum(RELATIONS) infers the Relation literal union instead of widening
// to `string`. See relationSchema in schemas.ts.
export const RELATIONS = Object.values(RELATIONS_BY_AXIS).flat() as unknown as readonly [
  Relation,
  ...Relation[],
];

export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
export type JlptLevel = (typeof JLPT_LEVELS)[number];

// The JLPT levels plus 'none' for entries with no level, as used by the
// links endpoint's `jlpt` filter.
export const JLPT_FILTER_KEYS = [...JLPT_LEVELS, 'none'] as const;
export type JlptFilterKey = (typeof JLPT_FILTER_KEYS)[number];

export const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'i-adjective',
  'na-adjective',
  'adverb',
  'particle',
  'conjunction',
  'pronoun',
  'counter',
  'expression',
  'prefix',
  'suffix',
  'other',
] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

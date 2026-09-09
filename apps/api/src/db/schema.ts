import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
} from 'drizzle-orm/pg-core';

/**
 * Content tables loaded by the pipeline. Nothing is written at request
 * time by the API. Column names and types are chosen to round-trip
 * exactly to the zod schemas in packages/shared/src/schemas.ts.
 */

export const kanji = pgTable(
  'kanji',
  {
    literal: text('literal').primaryKey(),
    onReadings: text('on_readings').array().notNull().default([]),
    kunReadings: text('kun_readings').array().notNull().default([]),
    meanings: text('meanings').array().notNull().default([]),
    strokeCount: integer('stroke_count').notNull(),
    radical: text('radical'),
    components: text('components').array().notNull().default([]),
    etymology: text('etymology'),
    jlptLevel: text('jlpt_level'),
    frequency: integer('frequency'),
  },
  (t) => [
    // Search-oriented index over readings: GIN on the array columns lets
    // an overlap test (`col && ARRAY[...]`) use the index instead of a
    // sequential scan, cheaply covering exact-reading search.
    index('kanji_on_readings_gin').using('gin', t.onReadings),
    index('kanji_kun_readings_gin').using('gin', t.kunReadings),
  ],
);

export const vocabularyItems = pgTable(
  'vocabulary_items',
  {
    entSeq: integer('ent_seq').primaryKey(),
    surface: text('surface').notNull(),
    reading: text('reading').notNull(),
    alternateSurfaces: text('alternate_surfaces').array().notNull().default([]),
    alternateReadings: text('alternate_readings').array().notNull().default([]),
    meanings: text('meanings').array().notNull().default([]),
    partsOfSpeech: text('parts_of_speech').array().notNull().default([]),
    jlptLevel: text('jlpt_level'),
    isCommon: boolean('is_common').notNull().default(false),
    audioUrl: text('audio_url'),
    // Folded (katakana -> hiragana), NFKC-free search key. Never rendered.
    searchKey: text('search_key').notNull(),
  },
  (t) => [index('vocabulary_items_search_key_idx').on(t.searchKey)],
);

export const radicals = pgTable('radicals', {
  character: text('character').primaryKey(),
  name: text('name').notNull(),
  strokeCount: integer('stroke_count').notNull(),
});

export const components = pgTable('components', {
  character: text('character').primaryKey(),
  isKanji: boolean('is_kanji').notNull(),
  etymology: text('etymology'),
});

export const sentences = pgTable('sentences', {
  tatoebaId: integer('tatoeba_id').primaryKey(),
  japanese: text('japanese').notNull(),
  english: text('english').notNull(),
  furigana: jsonb('furigana').notNull().$type<{ base: string; reading: string }[]>(),
  licence: text('licence').notNull(),
});

export const sentenceEntries = pgTable(
  'sentence_entries',
  {
    sentenceId: integer('sentence_id')
      .notNull()
      .references(() => sentences.tatoebaId),
    entryId: text('entry_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sentenceId, t.entryId] }),
    index('sentence_entries_entry_id_idx').on(t.entryId),
  ],
);

export const links = pgTable(
  'links',
  {
    fromEntryId: text('from_entry_id').notNull(),
    toEntryId: text('to_entry_id').notNull(),
    axis: text('axis').notNull(),
    relation: text('relation').notNull(),
    weight: real('weight'),
    source: text('source').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromEntryId, t.toEntryId, t.axis, t.relation] }),
    index('links_from_entry_axis_idx').on(t.fromEntryId, t.axis),
  ],
);

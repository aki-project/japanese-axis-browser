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

/**
 * A Hub is the shared thing at the centre of a family relation
 * ("everything that shares an X"): a radical, a component, an on
 * reading, a kun reading, a word reading, a WordNet synset, or an
 * English gloss. See CLAUDE.md's "Two storage shapes" and
 * packages/shared/src/hubs.ts (HUB_KINDS, HUB_KIND_RELATION). Hubs are
 * not Entries and have no page of their own yet.
 */
export const hubs = pgTable('hubs', {
  hubId: text('hub_id').primaryKey(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  memberCount: integer('member_count').notNull(),
});

/**
 * An entry's membership in a hub. Siblings of an entry on a family
 * relation are the other members of its hubs. `rank` is nullable
 * (lower sorts first; null sorts last) - kanji use KANJIDIC2
 * frequency, words use a commonness/JLPT tier.
 */
export const hubMembers = pgTable(
  'hub_members',
  {
    hubId: text('hub_id').notNull(),
    entryId: text('entry_id').notNull(),
    rank: integer('rank'),
  },
  (t) => [
    primaryKey({ columns: [t.hubId, t.entryId] }),
    // Ordered paging within a hub: members of one hub, by rank then id.
    index('hub_members_hub_rank_entry_idx').on(t.hubId, t.rank, t.entryId),
    // Entry-to-hubs lookup: which hubs does this entry belong to.
    index('hub_members_entry_id_idx').on(t.entryId),
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

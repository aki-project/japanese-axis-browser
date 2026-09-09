import { z } from 'zod';
import { AXES, JLPT_LEVELS, PARTS_OF_SPEECH, RELATIONS } from './constants.js';
import { isEntryId } from './entryId.js';

export const axisSchema = z.enum(AXES);
export const relationSchema = z.enum(RELATIONS);
export const jlptLevelSchema = z.enum(JLPT_LEVELS);
export const partOfSpeechSchema = z.enum(PARTS_OF_SPEECH);

export const entryIdSchema = z
  .string()
  .refine(isEntryId, { message: 'Entry ID must be k:<kanji> or w:<ent_seq>' });

export const furiganaSegmentSchema = z.object({
  base: z.string().min(1),
  reading: z.string(),
});
export type FuriganaSegment = z.infer<typeof furiganaSegmentSchema>;

export const radicalSchema = z.object({
  character: z.string().min(1),
  name: z.string(),
  strokeCount: z.number().int().positive(),
});
export type Radical = z.infer<typeof radicalSchema>;

export const componentSchema = z.object({
  character: z.string().min(1),
  isKanji: z.boolean(),
  etymology: z.string().nullable(),
});
export type Component = z.infer<typeof componentSchema>;

export const kanjiSchema = z.object({
  literal: z.string().min(1),
  onReadings: z.array(z.string()),
  kunReadings: z.array(z.string()),
  meanings: z.array(z.string()),
  strokeCount: z.number().int().positive(),
  radical: z.string().nullable(),
  components: z.array(z.string()),
  etymology: z.string().nullable(),
  jlptLevel: jlptLevelSchema.nullable(),
  frequency: z.number().int().positive().nullable(),
});
export type Kanji = z.infer<typeof kanjiSchema>;

export const vocabularyItemSchema = z.object({
  entSeq: z.number().int().positive(),
  surface: z.string().min(1),
  reading: z.string().min(1),
  alternateSurfaces: z.array(z.string()),
  alternateReadings: z.array(z.string()),
  meanings: z.array(z.string()).min(1),
  partsOfSpeech: z.array(partOfSpeechSchema),
  jlptLevel: jlptLevelSchema.nullable(),
  isCommon: z.boolean(),
  audioUrl: z.string().url().nullable(),
  searchKey: z.string(),
});
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>;

export const sentenceSchema = z.object({
  tatoebaId: z.number().int().positive(),
  japanese: z.string().min(1),
  english: z.string().min(1),
  furigana: z.array(furiganaSegmentSchema),
  licence: z.string(),
  entryIds: z.array(entryIdSchema),
});
export type Sentence = z.infer<typeof sentenceSchema>;

export const linkSchema = z.object({
  fromEntryId: entryIdSchema,
  toEntryId: entryIdSchema,
  axis: axisSchema,
  relation: relationSchema,
  weight: z.number().min(0).max(1).nullable(),
  source: z.string().min(1),
});
export type Link = z.infer<typeof linkSchema>;

// ---- API responses ----

export const entrySummarySchema = z.object({
  entryId: entryIdSchema,
  kind: z.enum(['kanji', 'word']),
  surface: z.string(),
  reading: z.string(),
  meanings: z.array(z.string()),
  jlptLevel: jlptLevelSchema.nullable(),
});
export type EntrySummary = z.infer<typeof entrySummarySchema>;

export const linkCountsSchema = z.object({
  semantic: z.number().int().nonnegative(),
  phonetic: z.number().int().nonnegative(),
  structural: z.number().int().nonnegative(),
});
export type LinkCounts = z.infer<typeof linkCountsSchema>;

export const entryResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('kanji'),
    entryId: entryIdSchema,
    kanji: kanjiSchema,
    sentences: z.array(sentenceSchema),
    linkCounts: linkCountsSchema,
  }),
  z.object({
    kind: z.literal('word'),
    entryId: entryIdSchema,
    word: vocabularyItemSchema,
    sentences: z.array(sentenceSchema),
    linkCounts: linkCountsSchema,
  }),
]);
export type EntryResponse = z.infer<typeof entryResponseSchema>;

export const linkedEntrySchema = z.object({
  relation: relationSchema,
  weight: z.number().min(0).max(1).nullable(),
  entry: entrySummarySchema,
});
export type LinkedEntry = z.infer<typeof linkedEntrySchema>;

export const relationGroupSchema = z.object({
  relation: relationSchema,
  entries: z.array(linkedEntrySchema),
});
export type RelationGroup = z.infer<typeof relationGroupSchema>;

export const axisGroupSchema = z.object({
  axis: axisSchema,
  total: z.number().int().nonnegative(),
  relations: z.array(relationGroupSchema),
  nextCursor: z.string().nullable(),
});
export type AxisGroup = z.infer<typeof axisGroupSchema>;

export const linksResponseSchema = z.object({
  entryId: entryIdSchema,
  axes: z.array(axisGroupSchema),
});
export type LinksResponse = z.infer<typeof linksResponseSchema>;

export const linksQuerySchema = z
  .object({
    axis: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(',').filter(Boolean) : [...AXES]))
      .pipe(z.array(axisSchema).min(1)),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    // A cursor is scoped to the single axis it was issued for (it
    // encodes {axis, relation, weight, toEntryId}: see
    // apps/api/src/services/cursor.ts). Supplying a cursor together
    // with more than one axis is ambiguous - which axis would it
    // resume? - so it is rejected below rather than silently applied
    // to every requested axis.
    cursor: z.string().optional(),
  })
  .refine((q) => !q.cursor || q.axis.length === 1, {
    message: 'cursor requires exactly one axis to be specified',
    path: ['cursor'],
  });
export type LinksQuery = z.infer<typeof linksQuerySchema>;

export const searchQuerySchema = z.object({
  // Folding (see apps/api's normalizeSearchKey) only maps katakana to
  // hiragana code point by code point, so it never turns a non-empty
  // string into an empty one; checking the trimmed value here is
  // equivalent to rejecting a query that would be empty after folding,
  // without needing to duplicate the folding logic in this package.
  q: z
    .string()
    .min(1)
    .max(100)
    .refine((s) => s.trim().length > 0, {
      message: 'q must contain a non-whitespace character',
    }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(entrySummarySchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

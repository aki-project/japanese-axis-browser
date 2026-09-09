import { kanjiEntryId, wordEntryId } from '@japanesesite/shared';
import type { EntrySummary, JlptLevel } from '@japanesesite/shared';

/** Shape of a row selected from the `kanji` table (see src/db/schema.ts). */
export interface KanjiRow {
  literal: string;
  onReadings: string[];
  kunReadings: string[];
  meanings: string[];
  jlptLevel: string | null;
}

/** Shape of a row selected from the `vocabulary_items` table. */
export interface VocabularyItemRow {
  entSeq: number;
  surface: string;
  reading: string;
  meanings: string[];
  jlptLevel: string | null;
}

export function kanjiRowToSummary(row: KanjiRow): EntrySummary {
  return {
    entryId: kanjiEntryId(row.literal),
    kind: 'kanji',
    surface: row.literal,
    // The on reading is the conventional citation form; fall back to
    // the kun reading only when there is no on reading at all.
    reading: row.onReadings[0] ?? row.kunReadings[0] ?? '',
    meanings: row.meanings,
    jlptLevel: (row.jlptLevel as JlptLevel | null) ?? null,
  };
}

export function wordRowToSummary(row: VocabularyItemRow): EntrySummary {
  return {
    entryId: wordEntryId(row.entSeq),
    kind: 'word',
    surface: row.surface,
    reading: row.reading,
    meanings: row.meanings,
    jlptLevel: (row.jlptLevel as JlptLevel | null) ?? null,
  };
}

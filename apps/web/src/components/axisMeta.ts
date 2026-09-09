import type { Axis, Relation } from '@japanesesite/shared';

export interface AxisMeta {
  label: string;
  glyph: string;
  description: string;
}

export const AXIS_META: Record<Axis, AxisMeta> = {
  semantic: { label: 'Semantic', glyph: 'S', description: 'meaning-based links' },
  phonetic: { label: 'Phonetic', glyph: 'P', description: 'sound-based links' },
  structural: { label: 'Structural', glyph: 'K', description: 'character-structure links' },
};

// Record<Relation, string> means TypeScript rejects this file if a
// relation is added to RELATIONS_BY_AXIS (in @japanesesite/shared) without
// a label being added here too.
const RELATION_LABELS: Record<Relation, string> = {
  synonym: 'synonym',
  antonym: 'antonym',
  see_also: 'see also',
  shared_sense: 'shared sense',
  homophone: 'homophone',
  shared_on_reading: 'shared on reading',
  shared_kun_reading: 'shared kun reading',
  contains_kanji: 'contains kanji',
  contained_in: 'contained in',
  component_of: 'component of',
  has_component: 'has component',
  shared_radical: 'shared radical',
  shared_phonetic_component: 'shared phonetic component',
};

export function relationLabel(relation: Relation): string {
  return RELATION_LABELS[relation];
}

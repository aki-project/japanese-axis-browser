import type { Axis, Relation } from './constants.js';

/**
 * A Hub is the shared thing at the centre of a family relation
 * ("everything that shares an X"). Family relations are stored as hubs
 * plus memberships rather than as pairwise link rows, because a family
 * of k members would cost k(k-1) edges. See CLAUDE.md.
 */
export const HUB_KINDS = [
  'radical',
  'component',
  'on',
  'kun',
  'reading',
  'synset',
  'gloss',
] as const;
export type HubKind = (typeof HUB_KINDS)[number];

/** Each hub kind materializes as exactly one axis and relation. */
export const HUB_KIND_RELATION = {
  radical: { axis: 'structural', relation: 'shared_radical' },
  component: { axis: 'structural', relation: 'shared_phonetic_component' },
  on: { axis: 'phonetic', relation: 'shared_on_reading' },
  kun: { axis: 'phonetic', relation: 'shared_kun_reading' },
  reading: { axis: 'phonetic', relation: 'homophone' },
  synset: { axis: 'semantic', relation: 'synonym' },
  gloss: { axis: 'semantic', relation: 'shared_sense' },
} as const satisfies Record<HubKind, { axis: Axis; relation: Relation }>;

/** Relations served from hubs. Every other relation is a pairwise link row. */
export const FAMILY_RELATIONS = Object.values(HUB_KIND_RELATION).map(
  (v) => v.relation,
) as readonly Relation[];

/** Relations served from the links table. */
export const PAIRWISE_RELATIONS = [
  'contains_kanji',
  'contained_in',
  'has_component',
  'component_of',
  'see_also',
  'antonym',
] as const satisfies readonly Relation[];

export function isFamilyRelation(relation: Relation): boolean {
  return FAMILY_RELATIONS.includes(relation);
}

export type HubId = `h:${HubKind}:${string}`;

export function hubId(kind: HubKind, key: string): HubId {
  return `h:${kind}:${key}`;
}

const HUB_ID_RE = /^h:([a-z]+):(.+)$/su;

export function parseHubId(id: string): { kind: HubKind; key: string } | null {
  const m = HUB_ID_RE.exec(id);
  if (!m) return null;
  const kind = m[1];
  const key = m[2];
  if (key === undefined || kind === undefined) return null;
  if (!(HUB_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as HubKind, key };
}

/**
 * Normalizes a KANJIDIC2 kun reading into a hub key: strips the prefix
 * and suffix hyphens that mark bound usage, and joins the okurigana to
 * the base so that ひ and ひ.く land in different hubs. Kana are never
 * folded here - that happens only in the search-key field.
 */
export function kunHubKey(reading: string): string {
  return reading.replace(/^-+|-+$/gu, '').replace(/\./gu, '');
}

/**
 * Maps a member's rank (lower sorts first) onto the 0..1 weight the API
 * reports, so hub-derived siblings order consistently with pairwise
 * links. Rank 0 gives `base`; the weight decays toward base*0.4.
 */
export function rankToWeight(base: number, rank: number | null): number {
  if (rank === null) return Math.min(1, Math.max(0, base * 0.4));
  const capped = Math.min(Math.max(rank, 0), 2500);
  return Math.min(1, Math.max(0, base * (1 - 0.6 * (capped / 2500))));
}

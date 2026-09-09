import type { Relation } from '@japanesesite/shared';

/**
 * Base weight per hub-derived (family) relation, fed into
 * rankToWeight(base, rank) (packages/shared/src/hubs.ts) to compute a
 * hub sibling's reported `weight`. This is the single source of truth
 * for the bases: both the in-process computation and the equivalent
 * SQL expression built in apps/api/src/db/queries.ts read from it, so
 * they cannot drift apart.
 */
export const HUB_WEIGHT_BASE: Record<
  | 'shared_radical'
  | 'shared_phonetic_component'
  | 'shared_on_reading'
  | 'shared_kun_reading'
  | 'homophone'
  | 'synonym'
  | 'shared_sense',
  number
> = {
  shared_radical: 0.5,
  shared_phonetic_component: 0.6,
  shared_on_reading: 0.6,
  shared_kun_reading: 0.5,
  homophone: 1.0,
  synonym: 1.0,
  shared_sense: 0.4,
};

/** Looks up a family relation's base weight; undefined for a pairwise relation. */
export function hubWeightBaseFor(relation: Relation): number | undefined {
  return (HUB_WEIGHT_BASE as Partial<Record<Relation, number>>)[relation];
}

/** Used by hubWeights.test.ts to assert this map's keys match FAMILY_RELATIONS exactly. */
export const HUB_WEIGHT_RELATIONS = Object.keys(HUB_WEIGHT_BASE) as Relation[];

import { describe, expect, it } from 'vitest';
import {
  FAMILY_RELATIONS,
  HUB_KINDS,
  HUB_KIND_RELATION,
  PAIRWISE_RELATIONS,
  hubId,
  isFamilyRelation,
  kunHubKey,
  parseHubId,
  rankToWeight,
} from './hubs.js';
import { RELATIONS } from './constants.js';

describe('hubs', () => {
  it('partitions every relation into exactly one shape', () => {
    const all = [...FAMILY_RELATIONS, ...PAIRWISE_RELATIONS].sort();
    expect(all).toEqual([...RELATIONS].sort());
    expect(new Set(all).size).toBe(RELATIONS.length);
  });

  it('maps every hub kind to a relation', () => {
    for (const kind of HUB_KINDS) {
      expect(HUB_KIND_RELATION[kind]).toBeDefined();
      expect(isFamilyRelation(HUB_KIND_RELATION[kind].relation)).toBe(true);
    }
  });

  it('round-trips hub IDs, including keys containing colons', () => {
    expect(parseHubId(hubId('radical', '心'))).toEqual({ kind: 'radical', key: '心' });
    expect(parseHubId(hubId('gloss', 'a:b'))).toEqual({ kind: 'gloss', key: 'a:b' });
    expect(parseHubId('h:nope:x')).toBeNull();
    expect(parseHubId('k:日')).toBeNull();
  });

  it('separates kun readings that differ only in okurigana', () => {
    expect(kunHubKey('ひ')).toBe('ひ');
    expect(kunHubKey('-び')).toBe('び');
    expect(kunHubKey('ひ.く')).toBe('ひく');
    expect(kunHubKey('ひ')).not.toBe(kunHubKey('ひ.く'));
  });

  it('orders weights by rank and clamps to 0..1', () => {
    expect(rankToWeight(0.6, 0)).toBeCloseTo(0.6);
    expect(rankToWeight(0.6, 1)).toBeLessThan(rankToWeight(0.6, 0));
    expect(rankToWeight(0.6, 99999)).toBeCloseTo(0.6 * 0.4);
    expect(rankToWeight(0.6, null)).toBeCloseTo(0.24);
    for (const r of [0, 10, 2500, 100000, null]) {
      const w = rankToWeight(1, r as number | null);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

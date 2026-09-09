import { FAMILY_RELATIONS, rankToWeight } from '@japanesesite/shared';
import { describe, expect, it } from 'vitest';
import { HUB_WEIGHT_BASE, HUB_WEIGHT_RELATIONS, hubWeightBaseFor } from './hubWeights.js';

describe('HUB_WEIGHT_BASE', () => {
  it('has exactly one base per family relation, no more, no less', () => {
    expect([...HUB_WEIGHT_RELATIONS].sort()).toEqual([...FAMILY_RELATIONS].sort());
  });

  it('every base is a finite number in (0, 1]', () => {
    for (const base of Object.values(HUB_WEIGHT_BASE)) {
      expect(base).toBeGreaterThan(0);
      expect(base).toBeLessThanOrEqual(1);
    }
  });

  it('hubWeightBaseFor is undefined for a pairwise relation', () => {
    expect(hubWeightBaseFor('contains_kanji')).toBeUndefined();
    expect(hubWeightBaseFor('see_also')).toBeUndefined();
  });

  it('hubWeightBaseFor feeds rankToWeight to produce a valid 0..1 weight', () => {
    const base = hubWeightBaseFor('shared_radical');
    expect(base).toBeDefined();
    if (base === undefined) return;
    expect(rankToWeight(base, 0)).toBeCloseTo(base);
    expect(rankToWeight(base, null)).toBeCloseTo(base * 0.4);
  });
});

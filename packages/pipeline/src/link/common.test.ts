import { describe, expect, it } from 'vitest';
import type { Link } from '@japanesesite/shared';
import {
  buildCappedGroupLinks,
  capPerEntry,
  dedupeLinks,
  frequencyScaledWeight,
  symmetrizeLinks,
  wordWeightTier,
} from './common.js';

function link(overrides: Partial<Link> & Pick<Link, 'fromEntryId' | 'toEntryId'>): Link {
  return {
    axis: 'structural',
    relation: 'shared_radical',
    weight: null,
    source: 'test',
    ...overrides,
  };
}

describe('dedupeLinks', () => {
  it('keeps the highest weight for a duplicate (from, to, axis, relation) key, null sorting below any number', () => {
    const links: Link[] = [
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', weight: null }),
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', weight: 0.1 }),
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', weight: 0.9 }),
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', weight: 0.5 }),
    ];
    const result = dedupeLinks(links);
    expect(result).toHaveLength(1);
    expect(result[0]?.weight).toBe(0.9);
  });

  it('keeps a null weight when it is the only entry for that key', () => {
    const links: Link[] = [link({ fromEntryId: 'k:日', toEntryId: 'k:本', weight: null })];
    expect(dedupeLinks(links)[0]?.weight).toBeNull();
  });

  it('treats distinct (from, to, axis, relation) tuples independently', () => {
    const links: Link[] = [
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', weight: 0.5 }),
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', axis: 'phonetic', relation: 'homophone', weight: 0.2 }),
    ];
    expect(dedupeLinks(links)).toHaveLength(2);
  });
});

describe('capPerEntry', () => {
  it('caps each from-entry to exactly the limit, keeping the highest weights', () => {
    const links: Link[] = Array.from({ length: 10 }, (_, i) =>
      link({ fromEntryId: 'k:日', toEntryId: `k:${i}`, weight: i / 10 }),
    );
    const result = capPerEntry(links, 3);
    expect(result).toHaveLength(3);
    expect(result.map((l) => l.weight).sort()).toEqual([0.7, 0.8, 0.9]);
  });

  it('does not cap below the limit when fewer links exist than the limit', () => {
    const links: Link[] = Array.from({ length: 2 }, (_, i) =>
      link({ fromEntryId: 'k:日', toEntryId: `k:${i}`, weight: i }),
    );
    expect(capPerEntry(links, 5)).toHaveLength(2);
  });

  it('ranks a null weight below any numeric weight, consistently with dedupeLinks', () => {
    const links: Link[] = [
      link({ fromEntryId: 'k:日', toEntryId: 'k:a', weight: null }),
      link({ fromEntryId: 'k:日', toEntryId: 'k:b', weight: 0 }),
    ];
    const result = capPerEntry(links, 1);
    expect(result).toHaveLength(1);
    expect(result[0]?.toEntryId).toBe('k:b');
  });
});

describe('buildCappedGroupLinks', () => {
  it('applies the cap once per member across every group it appears in, not once per group', () => {
    // One member ("x") appears in three groups of ~14 partners each (40
    // distinct partners total) - the cap must still be exactly 30 for
    // that member, not 30 per group.
    const groupA = ['x', ...Array.from({ length: 14 }, (_, i) => `a${i}`)];
    const groupB = ['x', ...Array.from({ length: 13 }, (_, i) => `b${i}`)];
    const groupC = ['x', ...Array.from({ length: 13 }, (_, i) => `c${i}`)];
    const totalPartners = 14 + 13 + 13;
    expect(totalPartners).toBe(40);

    const links = buildCappedGroupLinks(
      [groupA, groupB, groupC],
      (m) => `k:${m}` as const,
      () => null,
      30,
      'structural',
      'shared_radical',
      0.5,
      'test',
    );
    const fromX = links.filter((l) => l.fromEntryId === 'k:x');
    expect(fromX).toHaveLength(30);
  });

  it('weights each link by frequencyScaledWeight(baseWeight, partner rank)', () => {
    const links = buildCappedGroupLinks(
      [['a', 'b']],
      (m) => `k:${m}` as const,
      (m) => (m === 'b' ? 100 : null),
      30,
      'phonetic',
      'shared_on_reading',
      0.6,
      'test',
    );
    const aToB = links.find((l) => l.fromEntryId === 'k:a' && l.toEntryId === 'k:b');
    expect(aToB?.weight).toBe(frequencyScaledWeight(0.6, 100));
  });
});

describe('symmetrizeLinks', () => {
  it('adds the missing reverse of a mutual-relation link', () => {
    const links: Link[] = [
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', axis: 'phonetic', relation: 'shared_on_reading', weight: 0.6 }),
    ];
    const { links: result, added } = symmetrizeLinks(links);
    expect(added).toBe(1);
    expect(result).toContainEqual(
      link({ fromEntryId: 'k:本', toEntryId: 'k:日', axis: 'phonetic', relation: 'shared_on_reading', weight: 0.6 }),
    );
  });

  it('does not add a reverse that already exists', () => {
    const links: Link[] = [
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', axis: 'phonetic', relation: 'shared_on_reading', weight: 0.6 }),
      link({ fromEntryId: 'k:本', toEntryId: 'k:日', axis: 'phonetic', relation: 'shared_on_reading', weight: 0.6 }),
    ];
    const { added } = symmetrizeLinks(links);
    expect(added).toBe(0);
  });

  it('never mirrors a directed-pair relation (contains_kanji/contained_in, has_component/component_of)', () => {
    const links: Link[] = [
      link({ fromEntryId: 'w:1', toEntryId: 'k:日', axis: 'structural', relation: 'contains_kanji', weight: 0.7 }),
    ];
    const { links: result, added } = symmetrizeLinks(links);
    expect(added).toBe(0);
    expect(result.some((l) => l.relation === 'contained_in')).toBe(false);
  });
});

describe('wordWeightTier', () => {
  it('ranks JLPT levels N5 (easiest) down to N1 (hardest)', () => {
    expect(wordWeightTier({ jlptLevel: 'N5', isCommon: true })).toBe(1.0);
    expect(wordWeightTier({ jlptLevel: 'N4', isCommon: true })).toBe(0.95);
    expect(wordWeightTier({ jlptLevel: 'N3', isCommon: true })).toBe(0.9);
    expect(wordWeightTier({ jlptLevel: 'N2', isCommon: true })).toBe(0.85);
    expect(wordWeightTier({ jlptLevel: 'N1', isCommon: true })).toBe(0.8);
  });

  it('falls back to 0.7 for is_common words with no JLPT level, 0.5 otherwise', () => {
    expect(wordWeightTier({ jlptLevel: null, isCommon: true })).toBe(0.7);
    expect(wordWeightTier({ jlptLevel: null, isCommon: false })).toBe(0.5);
  });
});

describe('frequencyScaledWeight', () => {
  it('scales toward the full base weight for a very frequent (low rank) partner', () => {
    expect(frequencyScaledWeight(0.6, 1)).toBeCloseTo(0.6 * (1 - 0.5 * (1 / 2500)));
  });

  it('halves the base weight once rank reaches the 2500 ceiling', () => {
    expect(frequencyScaledWeight(0.6, 2500)).toBeCloseTo(0.3);
    expect(frequencyScaledWeight(0.6, 100_000)).toBeCloseTo(0.3); // clamped at the ceiling
  });

  it('uses a flat 0.4x multiplier when the partner has no recorded frequency', () => {
    expect(frequencyScaledWeight(0.6, null)).toBeCloseTo(0.24);
  });

  it('always clamps to [0, 1]', () => {
    expect(frequencyScaledWeight(2, 1)).toBeLessThanOrEqual(1);
    expect(frequencyScaledWeight(-1, null)).toBeGreaterThanOrEqual(0);
  });
});

import { describe, expect, it } from 'vitest';
import type { Link } from '@japanesesite/shared';
import { dedupeLinks, symmetrizeLinks, wordHubRank, wordWeightTier } from './common.js';

function link(overrides: Partial<Link> & Pick<Link, 'fromEntryId' | 'toEntryId'>): Link {
  return {
    axis: 'structural',
    relation: 'has_component',
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
      link({ fromEntryId: 'k:日', toEntryId: 'k:本', axis: 'semantic', relation: 'see_also', weight: 0.2 }),
    ];
    expect(dedupeLinks(links)).toHaveLength(2);
  });
});

describe('symmetrizeLinks', () => {
  it('adds the missing reverse of a mutual-relation link', () => {
    const links: Link[] = [
      link({ fromEntryId: 'w:1', toEntryId: 'w:2', axis: 'semantic', relation: 'see_also', weight: 0.8 }),
    ];
    const { links: result, added } = symmetrizeLinks(links);
    expect(added).toBe(1);
    expect(result).toContainEqual(
      link({ fromEntryId: 'w:2', toEntryId: 'w:1', axis: 'semantic', relation: 'see_also', weight: 0.8 }),
    );
  });

  it('does not add a reverse that already exists', () => {
    const links: Link[] = [
      link({ fromEntryId: 'w:1', toEntryId: 'w:2', axis: 'semantic', relation: 'see_also', weight: 0.8 }),
      link({ fromEntryId: 'w:2', toEntryId: 'w:1', axis: 'semantic', relation: 'see_also', weight: 0.8 }),
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

describe('wordHubRank', () => {
  it('ranks JLPT levels N5 (0, best) through N1 (400)', () => {
    expect(wordHubRank({ jlptLevel: 'N5', isCommon: true })).toBe(0);
    expect(wordHubRank({ jlptLevel: 'N4', isCommon: true })).toBe(100);
    expect(wordHubRank({ jlptLevel: 'N3', isCommon: true })).toBe(200);
    expect(wordHubRank({ jlptLevel: 'N2', isCommon: true })).toBe(300);
    expect(wordHubRank({ jlptLevel: 'N1', isCommon: true })).toBe(400);
  });

  it('ranks an is_common word with no JLPT level at 700, after every leveled word', () => {
    expect(wordHubRank({ jlptLevel: null, isCommon: true })).toBe(700);
  });

  it('ranks a non-common, unleveled word last at 1500', () => {
    expect(wordHubRank({ jlptLevel: null, isCommon: false })).toBe(1500);
  });
});

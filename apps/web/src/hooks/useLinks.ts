import { useInfiniteQuery } from '@tanstack/react-query';
import type { Axis, LinkedEntry, Relation, RelationGroup } from '@japanesesite/shared';
import { getLinks } from '../api/client.js';

export function axisLinksQueryKey(entryId: string, axis: Axis) {
  return ['links', entryId, axis] as const;
}

interface AxisPage {
  total: number;
  relations: readonly RelationGroup[];
  nextCursor: string | null;
}

async function fetchAxisPage(entryId: string, axis: Axis, cursor: string | undefined): Promise<AxisPage> {
  const response = await getLinks(entryId, cursor === undefined ? { axis: [axis] } : { axis: [axis], cursor });
  const group = response.axes.find((g) => g.axis === axis);
  if (!group) {
    return { total: 0, relations: [], nextCursor: null };
  }
  return { total: group.total, relations: group.relations, nextCursor: group.nextCursor };
}

export interface FlattenedAxisLinks {
  total: number;
  relations: readonly RelationGroup[];
}

/**
 * Flattens the pages of an axis's infinite query into a single set of
 * relation groups, deduplicating entries by (relation, target entry id)
 * so a target reached through more than one relation, or re-fetched
 * across pages, only appears once per relation.
 */
export function flattenAxisPages(pages: readonly AxisPage[]): FlattenedAxisLinks {
  if (pages.length === 0) {
    return { total: 0, relations: [] };
  }

  const seen = new Set<string>();
  const order: Relation[] = [];
  const byRelation = new Map<Relation, LinkedEntry[]>();

  for (const page of pages) {
    for (const relationGroup of page.relations) {
      for (const linked of relationGroup.entries) {
        const dedupeKey = `${relationGroup.relation}::${linked.entry.entryId}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        let bucket = byRelation.get(relationGroup.relation);
        if (!bucket) {
          bucket = [];
          byRelation.set(relationGroup.relation, bucket);
          order.push(relationGroup.relation);
        }
        bucket.push(linked);
      }
    }
  }

  const relations = order.map((relation) => ({
    relation,
    entries: byRelation.get(relation) ?? [],
  }));

  return { total: pages[0]?.total ?? 0, relations };
}

export interface AxisLinksResult {
  group: FlattenedAxisLinks | undefined;
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

/**
 * One infinite query per axis: the initial page and every "load more"
 * page both request only this axis, satisfying the API rule that a
 * cursor names exactly one axis. Pending/error/pagination state is
 * therefore naturally scoped per axis instead of shared across a panel.
 */
export function useAxisLinks(entryId: string, axis: Axis, enabled: boolean): AxisLinksResult {
  const query = useInfiniteQuery({
    queryKey: axisLinksQueryKey(entryId, axis),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => fetchAxisPage(entryId, axis, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: AxisPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });

  return {
    group: query.data ? flattenAxisPages(query.data.pages) : undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => {
      void query.fetchNextPage();
    },
  };
}

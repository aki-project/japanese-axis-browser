import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { EntryId, LinksResponse } from '@japanesesite/shared';
import type * as ApiClientModule from '../api/client.js';
import { flattenAxisPages, useAxisLinks } from './useLinks.js';

function entry(entryId: EntryId, surface: string) {
  return {
    entryId,
    kind: 'kanji' as const,
    surface,
    reading: '',
    meanings: [] as string[],
    jlptLevel: null,
  };
}

describe('flattenAxisPages', () => {
  it('dedupes entries by (relation, target entry id) across pages', () => {
    const pages = [
      {
        total: 3,
        relations: [
          {
            relation: 'synonym' as const,
            entries: [
              { relation: 'synonym' as const, weight: 1, entry: entry('k:a', 'a') },
              { relation: 'synonym' as const, weight: 1, entry: entry('k:b', 'b') },
            ],
          },
        ],
        nextCursor: 'page2',
      },
      {
        total: 3,
        relations: [
          {
            relation: 'synonym' as const,
            entries: [
              // Same (relation, entryId) as page 1 — must not duplicate.
              { relation: 'synonym' as const, weight: 1, entry: entry('k:a', 'a') },
              { relation: 'synonym' as const, weight: 1, entry: entry('k:c', 'c') },
            ],
          },
        ],
        nextCursor: null,
      },
    ];

    const flattened = flattenAxisPages(pages);

    expect(flattened.total).toBe(3);
    expect(flattened.relations).toHaveLength(1);
    expect(flattened.relations[0]?.entries.map((e) => e.entry.entryId)).toEqual(['k:a', 'k:b', 'k:c']);
  });

  it('returns an empty result for no pages', () => {
    expect(flattenAxisPages([])).toEqual({ total: 0, relations: [] });
  });
});

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, getLinks: vi.fn() };
});

import { getLinks } from '../api/client.js';

const mockedGetLinks = vi.mocked(getLinks);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useAxisLinks', () => {
  it('flattens and dedupes across a load-more page for a single axis', async () => {
    const page1: LinksResponse = {
      entryId: 'k:日',
      axes: [
        {
          axis: 'semantic',
          total: 3,
          relations: [
            {
              relation: 'synonym',
              entries: [{ relation: 'synonym', weight: 1, entry: entry('k:a', 'a') }],
            },
          ],
          nextCursor: 'cursor-2',
        },
      ],
    };
    const page2: LinksResponse = {
      entryId: 'k:日',
      axes: [
        {
          axis: 'semantic',
          total: 3,
          relations: [
            {
              relation: 'synonym',
              entries: [
                // Repeats the entry from page 1: must be deduped, not doubled.
                { relation: 'synonym', weight: 1, entry: entry('k:a', 'a') },
                { relation: 'synonym', weight: 1, entry: entry('k:b', 'b') },
              ],
            },
          ],
          nextCursor: null,
        },
      ],
    };
    mockedGetLinks.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const { result } = renderHook(() => useAxisLinks('k:日', 'semantic', true), { wrapper });

    await waitFor(() => expect(result.current.group?.total).toBe(3));
    expect(result.current.group?.relations[0]?.entries).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(true);

    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.group?.relations[0]?.entries.map((e) => e.entry.entryId)).toEqual(['k:a', 'k:b']);

    // Every request (initial + load more) names exactly one axis.
    for (const call of mockedGetLinks.mock.calls) {
      expect(call[1]?.axis).toEqual(['semantic']);
    }
  });

  it('does not fetch when the axis is not visible', () => {
    mockedGetLinks.mockClear();
    renderHook(() => useAxisLinks('k:日', 'phonetic', false), { wrapper });
    expect(mockedGetLinks).not.toHaveBeenCalled();
  });
});

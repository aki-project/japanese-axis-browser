import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ApiClientModule from '../api/client.js';
import { useSearch } from './useSearch.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, searchEntries: vi.fn() };
});

import { searchEntries } from '../api/client.js';

const mockedSearchEntries = vi.mocked(searchEntries);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSearch', () => {
  it('does not send a whitespace-only query', async () => {
    mockedSearchEntries.mockClear();
    const { result } = renderHook(() => useSearch('   ', 10), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedSearchEntries).not.toHaveBeenCalled();
    // Give any accidental async fetch a chance to fire before asserting again.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockedSearchEntries).not.toHaveBeenCalled();
  });

  it('sends a trimmed non-empty query', async () => {
    mockedSearchEntries.mockClear();
    mockedSearchEntries.mockResolvedValue({ query: '日', results: [] });

    const { result } = renderHook(() => useSearch('  日  ', 10), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedSearchEntries).toHaveBeenCalledWith('日', 10);
  });
});

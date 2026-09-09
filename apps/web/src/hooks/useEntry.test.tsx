import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ApiClientModule from '../api/client.js';
import { useEntry } from './useEntry.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, getEntry: vi.fn() };
});

import { ApiClientError, getEntry } from '../api/client.js';

const mockedGetEntry = vi.mocked(getEntry);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useEntry', () => {
  it('does not retry a 4xx error', async () => {
    mockedGetEntry.mockClear();
    mockedGetEntry.mockRejectedValue(new ApiClientError(400, 'bad_request', 'Malformed entry id'));

    const { result } = renderHook(() => useEntry('k:日'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockedGetEntry).toHaveBeenCalledTimes(1);
  });

  it('gates the query on a valid entry id, never hitting the network for an invalid one', () => {
    mockedGetEntry.mockClear();

    renderHook(() => useEntry('not-a-valid-id'), { wrapper });

    expect(mockedGetEntry).not.toHaveBeenCalled();
  });
});

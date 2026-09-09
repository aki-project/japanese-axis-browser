import { useQuery } from '@tanstack/react-query';
import { isEntryId } from '@japanesesite/shared';
import { ApiClientError, getEntry } from '../api/client.js';

export function entryQueryKey(entryId: string) {
  return ['entry', entryId] as const;
}

function isClientError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status >= 400 && error.status < 500;
}

export function useEntry(entryId: string) {
  return useQuery({
    queryKey: entryQueryKey(entryId),
    queryFn: () => getEntry(entryId),
    enabled: isEntryId(entryId),
    retry: (failureCount, error) => {
      if (isClientError(error)) return false;
      return failureCount < 2;
    },
  });
}

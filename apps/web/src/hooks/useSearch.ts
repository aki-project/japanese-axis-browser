import { useQuery } from '@tanstack/react-query';
import { searchEntries } from '../api/client.js';

export function searchQueryKey(query: string, limit?: number) {
  return ['search', query, limit ?? null] as const;
}

export function useSearch(query: string, limit?: number) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: searchQueryKey(trimmed, limit),
    queryFn: () => searchEntries(trimmed, limit),
    enabled: trimmed.length > 0,
  });
}

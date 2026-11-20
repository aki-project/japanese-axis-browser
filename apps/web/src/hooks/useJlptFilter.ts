import { useCallback, useState } from 'react';
import { JLPT_FILTER_KEYS, type JlptFilterKey } from '@japanesesite/shared';

const STORAGE_KEY = 'japanesesite:jlptFilter';

export type JlptFilter = Record<JlptFilterKey, boolean>;

function defaultFilter(): JlptFilter {
  return { N5: true, N4: true, N3: true, N2: true, N1: true, none: true };
}

function readFilter(): JlptFilter {
  const fallback = defaultFilter();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const result = { ...fallback };
    for (const key of JLPT_FILTER_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'boolean') result[key] = value;
    }
    return result;
  } catch {
    return fallback;
  }
}

function writeFilter(filter: JlptFilter): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // Storage unavailable (private mode, quota, etc.) — filter just won't
    // persist across reloads.
  }
}

/** True when at least one key is turned off, i.e. the filter hides something. */
export function isFilterActive(filter: JlptFilter): boolean {
  return JLPT_FILTER_KEYS.some((key) => !filter[key]);
}

/**
 * The filter as the links API's `jlpt` parameter: undefined when nothing
 * is filtered out (no parameter, so the unfiltered cache entry is shared),
 * otherwise the selected keys in JLPT_FILTER_KEYS order, which may be
 * empty when every key is off.
 */
export function selectedJlptKeys(filter: JlptFilter): JlptFilterKey[] | undefined {
  if (!isFilterActive(filter)) return undefined;
  return JLPT_FILTER_KEYS.filter((key) => filter[key]);
}

export function useJlptFilter() {
  const [filter, setFilter] = useState<JlptFilter>(() => readFilter());

  const toggle = useCallback((key: JlptFilterKey) => {
    setFilter((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      writeFilter(next);
      return next;
    });
  }, []);

  return { filter, toggle, isActive: isFilterActive(filter) } as const;
}

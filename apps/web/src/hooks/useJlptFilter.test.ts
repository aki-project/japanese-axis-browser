import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { isFilterActive, selectedJlptKeys, useJlptFilter } from './useJlptFilter.js';

const STORAGE_KEY = 'japanesesite:jlptFilter';

const ALL_ON = { N5: true, N4: true, N3: true, N2: true, N1: true, none: true };

describe('useJlptFilter', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults all six keys to true', () => {
    const { result } = renderHook(() => useJlptFilter());
    expect(result.current.filter).toEqual(ALL_ON);
    expect(result.current.isActive).toBe(false);
  });

  it('persists toggles to local storage', () => {
    const { result } = renderHook(() => useJlptFilter());

    act(() => {
      result.current.toggle('N3');
    });

    expect(result.current.filter.N3).toBe(false);
    expect(result.current.isActive).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.N3).toBe(false);
  });

  it('reads persisted filter back on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...ALL_ON, none: false }));
    const { result } = renderHook(() => useJlptFilter());
    expect(result.current.filter.none).toBe(false);
    expect(result.current.filter.N5).toBe(true);
  });

  it('falls back to defaults when stored JSON is corrupt', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not valid json');
    const { result } = renderHook(() => useJlptFilter());
    expect(result.current.filter).toEqual(ALL_ON);
  });

  it('fills missing keys from defaults when stored object is partial', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ N1: false }));
    const { result } = renderHook(() => useJlptFilter());
    expect(result.current.filter).toEqual({ ...ALL_ON, N1: false });
  });

  it('defaults to all on when storage throws on read', () => {
    vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    const { result } = renderHook(() => useJlptFilter());
    expect(result.current.filter).toEqual(ALL_ON);
  });

  it('does not throw when writing to storage fails', () => {
    vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { result } = renderHook(() => useJlptFilter());
    expect(() => {
      act(() => {
        result.current.toggle('N2');
      });
    }).not.toThrow();
    expect(result.current.filter.N2).toBe(false);
  });
});

describe('isFilterActive', () => {
  it('is false when every key is true', () => {
    expect(isFilterActive(ALL_ON)).toBe(false);
  });

  it('is true when any key is false', () => {
    expect(isFilterActive({ ...ALL_ON, N1: false })).toBe(true);
  });
});

describe('selectedJlptKeys', () => {
  it('is undefined when nothing is filtered out, so no jlpt parameter is sent', () => {
    expect(selectedJlptKeys(ALL_ON)).toBeUndefined();
  });

  it('lists the selected keys in canonical order', () => {
    expect(selectedJlptKeys({ ...ALL_ON, N4: false, N2: false })).toEqual(['N5', 'N3', 'N1', 'none']);
  });

  it('is empty when every key is off', () => {
    const allOff = { N5: false, N4: false, N3: false, N2: false, N1: false, none: false };
    expect(selectedJlptKeys(allOff)).toEqual([]);
  });
});

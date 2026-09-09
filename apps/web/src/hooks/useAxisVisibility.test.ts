import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAxisVisibility } from './useAxisVisibility.js';

const STORAGE_KEY = 'japanesesite:visibleAxes';

describe('useAxisVisibility', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to all axes on', () => {
    const { result } = renderHook(() => useAxisVisibility());
    expect(result.current.visibility).toEqual({ semantic: true, phonetic: true, structural: true });
    expect(result.current.visibleAxes).toEqual(['semantic', 'phonetic', 'structural']);
  });

  it('persists toggles to local storage', () => {
    const { result } = renderHook(() => useAxisVisibility());

    act(() => {
      result.current.toggle('phonetic');
    });

    expect(result.current.visibility.phonetic).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.phonetic).toBe(false);
  });

  it('reads persisted visibility back on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ semantic: false, phonetic: true, structural: true }));
    const { result } = renderHook(() => useAxisVisibility());
    expect(result.current.visibility.semantic).toBe(false);
  });

  it('defaults to all axes on when storage throws', () => {
    vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    const { result } = renderHook(() => useAxisVisibility());
    expect(result.current.visibility).toEqual({ semantic: true, phonetic: true, structural: true });
  });

  it('does not throw when writing to storage fails', () => {
    vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { result } = renderHook(() => useAxisVisibility());
    expect(() => {
      act(() => {
        result.current.toggle('semantic');
      });
    }).not.toThrow();
    expect(result.current.visibility.semantic).toBe(false);
  });
});

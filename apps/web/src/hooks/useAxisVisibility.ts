import { useCallback, useState } from 'react';
import { AXES, type Axis } from '@japanesesite/shared';

const STORAGE_KEY = 'japanesesite:visibleAxes';

export type AxisVisibility = Record<Axis, boolean>;

function defaultVisibility(): AxisVisibility {
  return { semantic: true, phonetic: true, structural: true };
}

function readVisibility(): AxisVisibility {
  const fallback = defaultVisibility();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const result = { ...fallback };
    for (const axis of AXES) {
      const value = (parsed as Record<string, unknown>)[axis];
      if (typeof value === 'boolean') result[axis] = value;
    }
    return result;
  } catch {
    return fallback;
  }
}

function writeVisibility(visibility: AxisVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Storage unavailable (private mode, quota, etc.) — visibility just
    // won't persist across reloads.
  }
}

export function useAxisVisibility() {
  const [visibility, setVisibility] = useState<AxisVisibility>(() => readVisibility());

  const toggle = useCallback((axis: Axis) => {
    setVisibility((prev) => {
      const next = { ...prev, [axis]: !prev[axis] };
      writeVisibility(next);
      return next;
    });
  }, []);

  const visibleAxes = AXES.filter((axis) => visibility[axis]);

  return { visibility, visibleAxes, toggle } as const;
}

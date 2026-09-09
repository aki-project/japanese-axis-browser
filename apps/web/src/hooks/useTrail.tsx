import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { NavigationType, useLocation, useNavigationType, type Location } from 'react-router';

export interface TrailStep {
  /** The history entry's location key, unique per visited location (even across a cycle). */
  key: string;
  entryId: string;
  /**
   * The browser history stack index for this step (react-router stores it
   * on `window.history.state.idx`), or `null` if it could not be read.
   * Used only to tell apart a POP to an *earlier* point in history we've
   * lost track of (e.g. after a reload) from a POP *forward* past what we
   * know.
   */
  index: number | null;
}

/** Reads react-router's own history index off `window.history.state`. */
function getHistoryIndex(): number | null {
  try {
    const idx = (window.history.state as { idx?: unknown } | null)?.idx;
    return typeof idx === 'number' ? idx : null;
  } catch {
    return null;
  }
}

/**
 * Reconciles the trail against a location change, keyed by history entry
 * rather than entry id so legitimate cycles (A -> B -> A) grow the trail
 * instead of collapsing it:
 *  - PUSH (following a link): append, even if the entry id repeats.
 *  - REPLACE: swap the last step for the new one.
 *  - POP (browser back/forward, or our own `navigate(delta)`):
 *      - if the location key is already in the trail, truncate back to it
 *        (this is what makes "back" shorten the trail by one instead of
 *        growing it);
 *      - otherwise, if we can tell this location is *earlier* in history
 *        than anything we've recorded (its index is lower than our last
 *        known step's), the path leading here is unknown — e.g. the app
 *        was reloaded, forgetting everything before the reload, and the
 *        visitor then pressed the browser's own Back button. Reset to
 *        just this step instead of appending, which would otherwise
 *        produce a reversed-looking trail;
 *      - otherwise append (a POP to a location further ahead than what
 *        we know, or one whose direction we can't determine).
 */
export function reconcileTrail(
  prev: readonly TrailStep[],
  navigationType: NavigationType,
  next: TrailStep,
): TrailStep[] {
  if (navigationType === NavigationType.Pop) {
    const idx = prev.findIndex((step) => step.key === next.key);
    if (idx !== -1) {
      return prev.slice(0, idx + 1);
    }

    const lastStep = prev[prev.length - 1];
    if (
      lastStep !== undefined &&
      lastStep.index !== null &&
      next.index !== null &&
      next.index < lastStep.index
    ) {
      return [next];
    }

    return [...prev, next];
  }
  if (navigationType === NavigationType.Replace) {
    return [...prev.slice(0, -1), next];
  }
  // PUSH, and the initial render (treated the same as PUSH: append).
  return [...prev, next];
}

interface TrailContextValue {
  trail: readonly TrailStep[];
}

const TrailContext = createContext<TrailContextValue | null>(null);

export function TrailProvider({ entryId, children }: { entryId: string; children: ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();

  // On reload / first mount the trail starts with only the current entry.
  const [trail, setTrail] = useState<readonly TrailStep[]>(() => [
    { key: location.key, entryId, index: getHistoryIndex() },
  ]);
  const lastKeyRef = useRef<Location['key']>(location.key);

  useEffect(() => {
    if (location.key === lastKeyRef.current) return;
    lastKeyRef.current = location.key;
    setTrail((prev) =>
      reconcileTrail(prev, navigationType, {
        key: location.key,
        entryId,
        index: getHistoryIndex(),
      }),
    );
  }, [location.key, navigationType, entryId]);

  return <TrailContext.Provider value={{ trail }}>{children}</TrailContext.Provider>;
}

export function useTrail(): readonly TrailStep[] {
  const ctx = useContext(TrailContext);
  if (!ctx) {
    throw new Error('useTrail must be used within a TrailProvider');
  }
  return ctx.trail;
}

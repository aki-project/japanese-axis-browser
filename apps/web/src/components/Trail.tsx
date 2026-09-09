import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { EntryResponse } from '@japanesesite/shared';
import { entryQueryKey } from '../hooks/useEntry.js';
import { useTrail } from '../hooks/useTrail.js';

function trailStepLabel(entryId: string, cached: EntryResponse | undefined): string {
  if (!cached) return entryId;
  return cached.kind === 'kanji' ? cached.kanji.literal : cached.word.surface;
}

/** Breadcrumb strip of visited entries. Each past step is clickable and jumps
 * back that many entries in history (a POP), which is what lets the trail
 * hook truncate to it instead of pushing a duplicate. */
export function Trail() {
  const trail = useTrail();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (trail.length <= 1) return null;

  return (
    <nav aria-label="Trail" className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
      {trail.map((step, index) => {
        const cached = queryClient.getQueryData<EntryResponse>(entryQueryKey(step.entryId));
        const label = trailStepLabel(step.entryId, cached);
        const isCurrent = index === trail.length - 1;
        const delta = index - (trail.length - 1);
        return (
          <span key={step.key} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true">›</span> : null}
            {isCurrent ? (
              <span lang="ja" aria-current="location" className="font-medium text-slate-700">
                {label}
              </span>
            ) : (
              <button
                type="button"
                lang="ja"
                onClick={() => navigate(delta)}
                className="hover:underline"
              >
                {label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

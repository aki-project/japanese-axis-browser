import { Link } from 'react-router';
import type { EntrySummary } from '@japanesesite/shared';

export interface EntryLinkProps {
  entry: EntrySummary;
  onClick?: () => void;
  /**
   * Readings this entry shares with the active entry (phonetic family
   * relations). Shown beside the entry's primary reading when they
   * differ from it, so the learner sees why the two entries are linked.
   */
  sharedReadings?: readonly string[];
}

export function EntryLink({ entry, onClick, sharedReadings = [] }: EntryLinkProps) {
  const gloss = entry.meanings[0];
  const extraReadings = sharedReadings.filter((r) => r !== entry.reading);
  return (
    <Link
      to={`/e/${entry.entryId}`}
      onClick={onClick}
      className="flex flex-col rounded border border-transparent px-2 py-1 hover:border-slate-300 hover:bg-slate-50 focus-visible:border-slate-300"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span lang="ja" className="text-base leading-snug">
          {entry.surface}
        </span>
        {gloss ? <span className="truncate text-xs text-slate-600">{gloss}</span> : null}
      </span>
      {entry.reading || extraReadings.length > 0 ? (
        <span className="text-xs leading-snug text-slate-500">
          {entry.reading ? <span lang="ja">{entry.reading}</span> : null}
          {extraReadings.length > 0 ? (
            <span>
              {entry.reading ? ' · ' : null}shared{' '}
              <span lang="ja" className="font-medium text-slate-700">
                {extraReadings.join('、')}
              </span>
            </span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}

import { Link } from 'react-router';
import type { EntrySummary } from '@japanesesite/shared';

export function EntryLink({ entry, onClick }: { entry: EntrySummary; onClick?: () => void }) {
  return (
    <Link
      to={`/e/${entry.entryId}`}
      onClick={onClick}
      className="flex flex-col rounded border border-transparent px-2 py-1 hover:border-slate-300 hover:bg-slate-50 focus-visible:border-slate-300"
    >
      <span lang="ja" className="text-base leading-snug">
        {entry.surface}
      </span>
      {entry.reading ? (
        <span lang="ja" className="text-xs text-slate-500 leading-snug">
          {entry.reading}
        </span>
      ) : null}
    </Link>
  );
}

import type { Axis } from '@japanesesite/shared';
import type { FlattenedAxisLinks } from '../hooks/useLinks.js';
import { AXIS_META, relationLabel } from './axisMeta.js';
import { EntryLink } from './EntryLink.js';

export interface AxisPanelProps {
  axis: Axis;
  /** Count from the entry response's linkCounts, available before the links request resolves. */
  count: number;
  /** Whether this axis is currently toggled on; when off, links are not fetched or shown. */
  isVisible: boolean;
  group: FlattenedAxisLinks | undefined;
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function AxisPanel({
  axis,
  count,
  isVisible,
  group,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: AxisPanelProps) {
  const meta = AXIS_META[axis];
  const headingId = `axis-${axis}-heading`;
  const isEmpty = isVisible && group !== undefined && group.total === 0;

  return (
    <section aria-labelledby={headingId} className="rounded border border-slate-200 p-3">
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-400 text-xs">
          {meta.glyph}
        </span>
        {meta.label}
        <span className="font-normal text-slate-400">({count})</span>
      </h2>

      {!isVisible ? (
        <p className="mt-2 text-sm text-slate-400">
          Hidden. Press {meta.glyph} or the toggle above to show {meta.label.toLowerCase()} links.
        </p>
      ) : null}

      {isVisible && isLoading && !group ? (
        <p className="mt-2 text-sm text-slate-500">Loading links…</p>
      ) : null}

      {isVisible && isError ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          Could not load {meta.label.toLowerCase()} links.
        </p>
      ) : null}

      {isEmpty ? (
        <p className="mt-2 text-sm text-slate-500">No {meta.label.toLowerCase()} links for this entry.</p>
      ) : null}

      {isVisible && group && group.relations.length > 0 ? (
        <div className="mt-2 flex flex-col gap-3">
          {group.relations.map((relationGroup) => (
            <div key={relationGroup.relation}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {relationLabel(relationGroup.relation)}
              </h3>
              <ul className="flex flex-col">
                {relationGroup.entries.map((linked) => (
                  <li key={linked.entry.entryId}>
                    <EntryLink entry={linked.entry} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {isVisible && hasNextPage ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isFetchingNextPage}
          className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}

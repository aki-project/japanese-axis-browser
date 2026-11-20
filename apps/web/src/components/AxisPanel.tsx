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
  /** Whether the JLPT filter hides any level. `group` is then already filtered by the API. */
  filterActive: boolean;
  /** Every JLPT level is switched off, so nothing is fetched. */
  noLevelsSelected: boolean;
  /**
   * How relation groups are arranged: stacked one above another, or
   * side by side in columns (for a wide panel).
   */
  layout?: 'stacked' | 'columns';
  /** Extra classes for the panel, e.g. to span grid columns. */
  className?: string | undefined;
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
  filterActive,
  noLevelsSelected,
  layout = 'stacked',
  className,
}: AxisPanelProps) {
  const meta = AXIS_META[axis];
  const headingId = `axis-${axis}-heading`;

  // With the filter active, `group.total` is the filtered count from the
  // API, shown against the unfiltered `count` from the entry response.
  const filteredTotal = noLevelsSelected ? 0 : group?.total;
  const countLabel =
    filterActive && filteredTotal !== undefined ? `(${filteredTotal} of ${count})` : `(${count})`;

  // Nothing at all on this axis, versus links that exist but none at the
  // selected JLPT levels: two different reasons for seeing nothing.
  const showsNothing = isVisible && (noLevelsSelected || (group !== undefined && group.total === 0));
  const isEmpty = showsNothing && (count === 0 || !filterActive);
  const isFilteredOut = showsNothing && count > 0 && filterActive;
  const relations = isVisible && !noLevelsSelected && group ? group.relations : [];

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded border border-slate-200 p-3${className ? ` ${className}` : ''}`}
    >
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-400 text-xs">
          {meta.glyph}
        </span>
        {meta.label}
        <span className="font-normal text-slate-400">{countLabel}</span>
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

      {isFilteredOut ? (
        <p className="mt-2 text-sm text-slate-500">
          {noLevelsSelected
            ? 'No JLPT levels selected.'
            : `No ${meta.label.toLowerCase()} links match the JLPT filter.`}
        </p>
      ) : null}

      {relations.length > 0 ? (
        <div
          className={
            layout === 'columns'
              ? 'mt-2 grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]'
              : 'mt-2 flex flex-col gap-3'
          }
        >
          {relations.map((relationGroup) => (
            <div key={relationGroup.relation} className="min-w-0">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {relationLabel(relationGroup.relation)}
              </h3>
              <ul className="flex flex-col">
                {relationGroup.entries.map((linked) => (
                  <li key={linked.entry.entryId}>
                    <EntryLink
                      entry={linked.entry}
                      {...(axis === 'phonetic' && { sharedReadings: linked.via })}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {isVisible && !noLevelsSelected && hasNextPage ? (
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

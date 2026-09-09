import { RELATIONS_BY_AXIS } from '@japanesesite/shared';
import type { Axis, AxisGroup, EntrySummary, Relation, RelationGroup } from '@japanesesite/shared';
import { decodeCursor, encodeCursor } from './cursor.js';

/** A single link row, flattened, before grouping or pagination. */
export interface FlatLinkRow {
  axis: Axis;
  relation: Relation;
  toEntryId: string;
  weight: number | null;
}

export interface GroupLinksInput {
  /** All link rows for the requested axes (unfiltered by cursor/limit). */
  rows: FlatLinkRow[];
  /** toEntryId -> entry summary. Rows with no matching summary are dropped. */
  summaries: Map<string, EntrySummary>;
  /** Axes to include, in output order. */
  axes: Axis[];
  limit: number;
  /**
   * Opaque cursor from a previous response. It is scoped to a single
   * axis (the axis it was issued for): it is applied only to that
   * axis's page, and every other axis starts from its first page. The
   * route layer additionally rejects cursor + multiple axes up front
   * (see linksQuerySchema), but this function stays defensive on its
   * own so it can never skip or repeat links even if called that way.
   */
  cursor?: string | undefined;
}

/**
 * weight desc (nulls last), then toEntryId asc, then relation asc: a
 * total order. weight+toEntryId alone is not unique within an axis
 * because the same target can appear under two relations, so relation
 * must be the final tiebreak.
 */
function compareLinkOrder(
  a: { weight: number | null; toEntryId: string; relation: Relation },
  b: { weight: number | null; toEntryId: string; relation: Relation },
): number {
  const aw = a.weight;
  const bw = b.weight;
  if (aw !== bw) {
    if (aw === null) return 1;
    if (bw === null) return -1;
    return bw - aw;
  }
  if (a.toEntryId < b.toEntryId) return -1;
  if (a.toEntryId > b.toEntryId) return 1;
  if (a.relation < b.relation) return -1;
  if (a.relation > b.relation) return 1;
  return 0;
}

/**
 * Groups flat link rows by axis, then by relation, ordered by weight
 * descending (ties broken by toEntryId, then relation, ascending).
 * Each axis is paginated independently: `limit` items per page,
 * continued via the opaque cursor returned as `nextCursor`.
 */
export function groupLinks(input: GroupLinksInput): AxisGroup[] {
  const { rows, summaries, axes, limit, cursor } = input;
  const decodedCursor = cursor ? decodeCursor(cursor) : null;

  return axes.map((axis): AxisGroup => {
    const sorted = rows
      .filter((r) => r.axis === axis && summaries.has(r.toEntryId))
      .sort(compareLinkOrder);

    const total = sorted.length;

    // The cursor only applies to the axis it was issued for; every
    // other axis (and a cursor for an axis not even in this request)
    // starts fresh from the first page.
    const cursorForAxis = decodedCursor && decodedCursor.axis === axis ? decodedCursor : null;

    let start = 0;
    if (cursorForAxis) {
      const idx = sorted.findIndex((r) => compareLinkOrder(r, cursorForAxis) > 0);
      start = idx === -1 ? sorted.length : idx;
    }

    const page = sorted.slice(start, start + limit);
    const hasMore = start + limit < total;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ axis, relation: last.relation, weight: last.weight, toEntryId: last.toEntryId })
        : null;

    const relationOrder = RELATIONS_BY_AXIS[axis] as readonly Relation[];
    const relations: RelationGroup[] = [];
    for (const relation of relationOrder) {
      const entries = page
        .filter((r) => r.relation === relation)
        .map((r) => {
          const entry = summaries.get(r.toEntryId);
          // Guarded by the summaries.has() filter above.
          if (!entry) throw new Error(`missing summary for ${r.toEntryId}`);
          return { relation, weight: r.weight, entry };
        });
      if (entries.length > 0) {
        relations.push({ relation, entries });
      }
    }

    return { axis, total, relations, nextCursor };
  });
}

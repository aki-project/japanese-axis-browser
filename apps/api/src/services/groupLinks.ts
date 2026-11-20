import { RELATIONS_BY_AXIS } from '@japanesesite/shared';
import type { Axis, AxisGroup, EntrySummary, Relation, RelationGroup } from '@japanesesite/shared';
import { compareCodePoints } from './codePointOrder.js';
import { decodeCursor, encodeCursor, type RelationPosition } from './cursor.js';

/** A single link row, flattened, before grouping or pagination. */
export interface FlatLinkRow {
  axis: Axis;
  relation: Relation;
  toEntryId: string;
  weight: number | null;
  /** Hub labels shared with the active entry (family relations only). */
  via?: string[];
}

export interface GroupLinksInput {
  /**
   * Link rows for the requested axes. For a pairwise relation this is
   * every row (the links table has no cap). For a hub-derived (family)
   * relation this may be only the rows after that relation's cursor
   * position, limited by the caller (a hub can have 500+ members, so
   * the caller pushes that predicate into SQL rather than fetching them
   * all here) - see apps/api/src/db/queries.ts. A limited relation must
   * supply up to `limit + 1` rows: a relation can take the whole page
   * when the others are empty, and one extra row proves another page
   * exists. Because family rows may be a strict subset of the full set,
   * `total` cannot be derived from `rows.length`; see `totals`.
   */
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
  /**
   * Authoritative per-axis total (distinct partner count, summed over
   * relations), typically the same query used for GET /entries/:id's
   * linkCounts so the two endpoints agree exactly. When an axis is
   * present here its value is reported as `total` instead of
   * `rows.length`, since `rows` may be a partial page for a hub-backed
   * relation. When an axis is absent, `total` falls back to counting
   * the (assumed-complete) rows, which is the only option available to
   * callers - such as tests - that pass a fully-materialized `rows`
   * array directly.
   */
  totals?: Partial<Record<Axis, number>>;
}

/**
 * Order within one relation: weight desc (nulls last), then toEntryId
 * asc by code point (matching the SQL side's COLLATE "C"). toEntryId is
 * unique within a relation, so this is a total order there.
 */
function compareInRelation(a: RelationPosition, b: RelationPosition): number {
  const aw = a.weight;
  const bw = b.weight;
  if (aw !== bw) {
    if (aw === null) return 1;
    if (bw === null) return -1;
    return bw - aw;
  }
  return compareCodePoints(a.toEntryId, b.toEntryId);
}

/**
 * Splits a page of `limit` items between relations, given how many
 * items each relation still has (`available`, in display order). Each
 * relation with items gets an equal share, limit / K for K such
 * relations; a relation with fewer items than its share takes all it
 * has and its unused share is split among the rest, so the page is
 * full whenever enough items exist. Shares that don't divide evenly go
 * one each to the earliest relations.
 */
export function allocateQuotas(available: readonly number[], limit: number): number[] {
  const quotas = available.map(() => 0);
  let remaining = limit;
  let open = available.map((n, i) => i).filter((i) => (available[i] ?? 0) > 0);

  while (remaining > 0 && open.length > 0) {
    const share = Math.floor(remaining / open.length);
    const small = open.filter((i) => (available[i] ?? 0) <= share);
    if (small.length > 0) {
      for (const i of small) {
        quotas[i] = available[i] ?? 0;
        remaining -= quotas[i] ?? 0;
      }
      open = open.filter((i) => !small.includes(i));
      continue;
    }
    // Every open relation has more than its share: give each the share,
    // then the leftover (fewer than open.length) one each in order.
    const extra = remaining - share * open.length;
    open.forEach((i, k) => {
      quotas[i] = share + (k < extra ? 1 : 0);
    });
    remaining = 0;
  }
  return quotas;
}

/**
 * Groups flat link rows by axis, then by relation, ordered by weight
 * descending (ties broken by toEntryId ascending). Each axis is
 * paginated independently, `limit` items per page, and each page is
 * split between the axis's relations by allocateQuotas so one large
 * relation cannot crowd the others off the first page. Later pages
 * continue each relation where it left off, via the opaque cursor
 * returned as `nextCursor`.
 */
export function groupLinks(input: GroupLinksInput): AxisGroup[] {
  const { rows, summaries, axes, limit, cursor, totals } = input;
  const decodedCursor = cursor ? decodeCursor(cursor) : null;

  return axes.map((axis): AxisGroup => {
    const axisRows = rows.filter((r) => r.axis === axis && summaries.has(r.toEntryId));
    const total = totals?.[axis] ?? axisRows.length;

    // The cursor only applies to the axis it was issued for; every
    // other axis (and a cursor for an axis not even in this request)
    // starts fresh from the first page.
    const after = decodedCursor && decodedCursor.axis === axis ? decodedCursor.after : {};

    const relationOrder = RELATIONS_BY_AXIS[axis] as readonly Relation[];
    const remainingByRelation = relationOrder.map((relation) => {
      const position = after[relation];
      return axisRows
        .filter((r) => r.relation === relation && (!position || compareInRelation(r, position) > 0))
        .sort(compareInRelation);
    });

    const quotas = allocateQuotas(
      remainingByRelation.map((r) => r.length),
      limit,
    );

    const relations: RelationGroup[] = [];
    const nextAfter = { ...after };
    let hasMore = false;
    relationOrder.forEach((relation, i) => {
      const remaining = remainingByRelation[i] ?? [];
      const page = remaining.slice(0, quotas[i] ?? 0);
      // Decided from the rows after this relation's position, not from
      // `total`: family rows are cursor-filtered and LIMIT-bound in SQL,
      // so only the rows supplied here say whether more follow.
      if (remaining.length > page.length) hasMore = true;
      const last = page[page.length - 1];
      if (!last) return;
      nextAfter[relation] = { weight: last.weight, toEntryId: last.toEntryId };
      relations.push({
        relation,
        entries: page.map((r) => {
          const entry = summaries.get(r.toEntryId);
          // Guarded by the summaries.has() filter above.
          if (!entry) throw new Error(`missing summary for ${r.toEntryId}`);
          return { relation, weight: r.weight, entry, via: r.via ?? [] };
        }),
      });
    });

    const nextCursor = hasMore ? encodeCursor({ axis, after: nextAfter }) : null;
    return { axis, total, relations, nextCursor };
  });
}

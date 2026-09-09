import { AXES, RELATIONS } from '@japanesesite/shared';
import type { Axis, Relation } from '@japanesesite/shared';

/**
 * Pure helpers for the links list cursor. The cursor is scoped to a
 * single axis (it encodes which axis it continues) and encodes the
 * last (weight, toEntryId, relation) triple seen by the client. That
 * triple, together with the axis, is unique because the same target
 * entry can appear under more than one relation on the same axis, so
 * relation must be part of both the cursor and the sort key.
 *
 * Ordering everywhere links are listed: weight descending (nulls
 * last), then toEntryId ascending, then relation ascending as the
 * final, total tiebreaker.
 */

export interface LinkCursor {
  axis: Axis;
  relation: Relation;
  weight: number | null;
  toEntryId: string;
}

export function encodeCursor(cursor: LinkCursor): string {
  const json = JSON.stringify({
    axis: cursor.axis,
    relation: cursor.relation,
    weight: cursor.weight,
    toEntryId: cursor.toEntryId,
  });
  return Buffer.from(json, 'utf8').toString('base64url');
}

const AXIS_SET: ReadonlySet<string> = new Set(AXES);
const RELATION_SET: ReadonlySet<string> = new Set(RELATIONS);

export function decodeCursor(encoded: string): LinkCursor | null {
  let json: string;
  try {
    json = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const { axis, relation, weight, toEntryId } = obj;

  if (typeof axis !== 'string' || !AXIS_SET.has(axis)) return null;
  if (typeof relation !== 'string' || !RELATION_SET.has(relation)) return null;
  if (typeof toEntryId !== 'string') return null;
  if (weight !== null && typeof weight !== 'number') return null;

  return { axis: axis as Axis, relation: relation as Relation, weight, toEntryId };
}

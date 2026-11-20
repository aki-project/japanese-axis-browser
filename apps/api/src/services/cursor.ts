import { AXES, RELATIONS_BY_AXIS } from '@japanesesite/shared';
import type { Axis, Relation } from '@japanesesite/shared';

/**
 * Pure helpers for the links list cursor. A page of an axis is split
 * between that axis's relations (see allocateQuotas in groupLinks.ts),
 * so each relation is paged independently and the cursor records, per
 * relation, the last (weight, toEntryId) the client has seen. A
 * relation with no position has not been started and resumes from its
 * first row. Within one relation, toEntryId is unique, so the pair is
 * a total position.
 *
 * Ordering within a relation: weight descending (nulls last), then
 * toEntryId ascending by code point (see codePointOrder.ts).
 */

export interface RelationPosition {
  weight: number | null;
  toEntryId: string;
}

export interface LinkCursor {
  axis: Axis;
  after: Partial<Record<Relation, RelationPosition>>;
}

export function encodeCursor(cursor: LinkCursor): string {
  const json = JSON.stringify({ axis: cursor.axis, after: cursor.after });
  return Buffer.from(json, 'utf8').toString('base64url');
}

const AXIS_SET: ReadonlySet<string> = new Set(AXES);

function parsePosition(value: unknown): RelationPosition | null {
  if (typeof value !== 'object' || value === null) return null;
  const { weight, toEntryId } = value as Record<string, unknown>;
  if (typeof toEntryId !== 'string') return null;
  if (weight !== null && typeof weight !== 'number') return null;
  return { weight, toEntryId };
}

export function decodeCursor(encoded: string): LinkCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const { axis, after } = parsed as Record<string, unknown>;

  if (typeof axis !== 'string' || !AXIS_SET.has(axis)) return null;
  if (typeof after !== 'object' || after === null || Array.isArray(after)) return null;

  // Every key must be a relation on this axis: a position for another
  // axis's relation would be silently ignored, so the cursor is bad.
  const axisRelations: ReadonlySet<string> = new Set(RELATIONS_BY_AXIS[axis as Axis]);
  const positions: Partial<Record<Relation, RelationPosition>> = {};
  for (const [relation, value] of Object.entries(after)) {
    if (!axisRelations.has(relation)) return null;
    const position = parsePosition(value);
    if (!position) return null;
    positions[relation as Relation] = position;
  }

  return { axis: axis as Axis, after: positions };
}

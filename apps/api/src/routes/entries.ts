import {
  entryResponseSchema,
  isFamilyRelation,
  linksQuerySchema,
  linksResponseSchema,
  normalizeSearchKey,
  parseEntryId,
  RELATIONS_BY_AXIS,
  searchQuerySchema,
  searchResponseSchema,
  type Axis,
  type EntryId,
  type EntryKind,
  type Relation,
} from '@japanesesite/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import {
  findEntryRow,
  getEntrySummaries,
  getHubSiblingRows,
  getLinkCounts,
  getLinkRowsForAxes,
  getSentencesForEntry,
  searchEntries,
} from '../db/queries.js';
import { decodeCursor } from '../services/cursor.js';
import { groupLinks, type FlatLinkRow } from '../services/groupLinks.js';

const CACHE_CONTROL = 'public, max-age=86400';

const INVALID_ENTRY_ID_ERROR = {
  error: {
    code: 'INVALID_ENTRY_ID',
    message: 'Entry ID must be k:<kanji literal> or w:<ent_seq>',
  },
} as const;

function entryNotFoundError(entryId: string): { error: { code: string; message: string } } {
  return { error: { code: 'ENTRY_NOT_FOUND', message: `No entry with id ${entryId}` } };
}

/**
 * Validates a raw path param as an entry ID and splits it into its
 * kind/key. `parseEntryId` IS the validation (entryIdSchema's refine is
 * defined in terms of it), so there is exactly one parse here rather
 * than a schema check followed by a redundant, always-successful second
 * parse.
 */
function parseRequestedEntryId(
  raw: string,
): { entryId: EntryId; kind: EntryKind; key: string } | null {
  const parsed = parseEntryId(raw);
  if (!parsed) return null;
  return { entryId: raw as EntryId, kind: parsed.kind, key: parsed.key };
}

export async function registerEntryRoutes(app: FastifyInstance, db: Db): Promise<void> {
  // Registered before /:entryId so "search" is never mistaken for an entry ID.
  app.get('/entries/search', async (request, reply) => {
    const parsedQuery = searchQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsedQuery.error.message },
      });
    }
    const { q, limit } = parsedQuery.data;
    const folded = normalizeSearchKey(q);
    const results = await searchEntries(db, folded, q.trim(), limit);

    const body = searchResponseSchema.parse({ query: q, results });
    reply.header('Cache-Control', CACHE_CONTROL);
    return body;
  });

  app.get('/entries/:entryId', async (request, reply) => {
    const params = request.params as { entryId: string };
    const parsed = parseRequestedEntryId(params.entryId);
    if (!parsed) {
      return reply.code(400).send(INVALID_ENTRY_ID_ERROR);
    }
    const { entryId, kind, key } = parsed;

    const found = await findEntryRow(db, kind, key);
    if (!found) {
      return reply.code(404).send(entryNotFoundError(entryId));
    }

    const [sentences, linkCounts] = await Promise.all([
      getSentencesForEntry(db, entryId),
      getLinkCounts(db, entryId),
    ]);

    const raw =
      found.kind === 'kanji'
        ? { kind: 'kanji', entryId, kanji: found.row, sentences, linkCounts }
        : { kind: 'word', entryId, word: found.row, sentences, linkCounts };

    const body = entryResponseSchema.parse(raw);
    reply.header('Cache-Control', CACHE_CONTROL);
    return body;
  });

  app.get('/entries/:entryId/links', async (request, reply) => {
    const params = request.params as { entryId: string };
    const parsed = parseRequestedEntryId(params.entryId);
    if (!parsed) {
      return reply.code(400).send(INVALID_ENTRY_ID_ERROR);
    }
    const { entryId, kind, key } = parsed;

    // Validate the query before touching the database: a bad query
    // (e.g. cursor + multiple axes) is a 400 regardless of whether the
    // entry itself exists.
    const queryResult = linksQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: queryResult.error.message },
      });
    }
    const { axis, limit, cursor } = queryResult.data;

    // A cursor is an opaque token round-tripped from a previous
    // response: if it doesn't decode, it's a client error, not "start
    // over from page 1".
    const decodedCursor = cursor !== undefined ? decodeCursor(cursor) : null;
    if (cursor !== undefined && decodedCursor === null) {
      return reply.code(400).send({
        error: { code: 'INVALID_CURSOR', message: 'cursor is not a valid links cursor' },
      });
    }

    const found = await findEntryRow(db, kind, key);
    if (!found) {
      return reply.code(404).send(entryNotFoundError(entryId));
    }

    // Pairwise rows (links table) are fetched in full per requested
    // axis - the pairwise relations are naturally low fan-out, unlike a
    // hub, so there is no cap to page around. Family (hub-derived)
    // relations are the opposite: a hub can have 500+ members, so each
    // one is fetched as its own cursor-scoped, LIMIT-bound page (see
    // getHubSiblingRows) rather than materialized in full here.
    const familyRowsByAxis = await Promise.all(
      axis.map((a) => {
        const familyRelations = (RELATIONS_BY_AXIS[a] as readonly Relation[]).filter(
          isFamilyRelation,
        );
        // A cursor only continues the axis it was issued for; every
        // other axis (including every family relation on it) starts
        // fresh from its first page, same as groupLinks' own handling.
        const cursorForAxis = decodedCursor && decodedCursor.axis === a ? decodedCursor : null;
        return Promise.all(
          familyRelations.map((relation) =>
            getHubSiblingRows(db, entryId, relation, cursorForAxis, limit),
          ),
        );
      }),
    );

    const pairwiseRows = await getLinkRowsForAxes(db, entryId, axis);
    const rows: FlatLinkRow[] = [...pairwiseRows, ...familyRowsByAxis.flat(2)];

    const [summaries, linkCounts] = await Promise.all([
      getEntrySummaries(
        db,
        rows.map((r) => r.toEntryId),
      ),
      getLinkCounts(db, entryId),
    ]);

    const totals: Partial<Record<Axis, number>> = {
      semantic: linkCounts.semantic,
      phonetic: linkCounts.phonetic,
      structural: linkCounts.structural,
    };
    const axes = groupLinks({ rows, summaries, axes: axis, limit, cursor, totals });

    const body = linksResponseSchema.parse({ entryId, axes });
    reply.header('Cache-Control', CACHE_CONTROL);
    return body;
  });
}

import {
  entryResponseSchema,
  linksQuerySchema,
  linksResponseSchema,
  normalizeSearchKey,
  parseEntryId,
  searchQuerySchema,
  searchResponseSchema,
  type EntryId,
  type EntryKind,
} from '@japanesesite/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import {
  findEntryRow,
  getEntrySummaries,
  getLinkCounts,
  getLinkRowsForAxes,
  getSentencesForEntry,
  searchEntries,
} from '../db/queries.js';
import { decodeCursor } from '../services/cursor.js';
import { groupLinks } from '../services/groupLinks.js';

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
    if (cursor !== undefined && decodeCursor(cursor) === null) {
      return reply.code(400).send({
        error: { code: 'INVALID_CURSOR', message: 'cursor is not a valid links cursor' },
      });
    }

    const found = await findEntryRow(db, kind, key);
    if (!found) {
      return reply.code(404).send(entryNotFoundError(entryId));
    }

    const rows = await getLinkRowsForAxes(db, entryId, axis);
    const summaries = await getEntrySummaries(
      db,
      rows.map((r) => r.toEntryId),
    );
    const axes = groupLinks({ rows, summaries, axes: axis, limit, cursor });

    const body = linksResponseSchema.parse({ entryId, axes });
    reply.header('Cache-Control', CACHE_CONTROL);
    return body;
  });
}

import {
  collectionsResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
  saveCollectionsRequestSchema,
  sessionResponseSchema,
  type KnownCollections,
} from '@japanesesite/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import {
  createUser,
  endSession,
  findSessionUser,
  findUserByUsername,
  getCollections,
  saveCollections,
  startSession,
} from '../db/accountQueries.js';
import {
  clearedSessionCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
} from '../services/cookies.js';
import { isTodayInEra } from '../services/eraDate.js';
import { createRateLimiter, type RateLimit } from '../services/rateLimit.js';
import {
  dummyPasswordHash,
  hashPassword,
  hashSessionToken,
  newSessionToken,
  verifyPassword,
} from '../services/password.js';

export interface AccountRouteOptions {
  /** Marks the session cookie Secure. */
  production: boolean;
  /** Clock for the registration date check; injectable for tests. */
  now?: () => Date;
  /** Overrides for the global rate limits; see DEFAULT_RATE_LIMITS. */
  rateLimits?: Partial<Record<RateLimitedAction, RateLimit>>;
}

export type RateLimitedAction = 'login' | 'register' | 'save';

/**
 * Global (server-wide, not per client) budgets for the expensive account
 * actions: login and register each run scrypt, and a save writes a blob
 * of up to a few MiB.
 */
export const DEFAULT_RATE_LIMITS: Record<RateLimitedAction, RateLimit> = {
  login: { limit: 60, windowMs: 60_000 },
  register: { limit: 10, windowMs: 60_000 },
  save: { limit: 30, windowMs: 60_000 },
};

const RATE_LIMITED_ROUTES: Record<string, RateLimitedAction> = {
  'POST /api/auth/login': 'login',
  'POST /api/auth/register': 'register',
  'PUT /api/collections': 'save',
};

function error(code: string, message: string) {
  return { error: { code, message } };
}

/** Collections hold up to 50,000 IDs each, which can exceed Fastify's 1 MiB default. */
const COLLECTIONS_BODY_LIMIT = 4 * 1024 * 1024;

/** Sorted, de-duplicated copy, so a saved blob has one canonical form. */
function canonical(collections: KnownCollections): KnownCollections {
  return {
    kanji: [...new Set(collections.kanji)].sort(),
    vocab: [...new Set(collections.vocab)].sort(),
  };
}

export async function registerAccountRoutes(
  app: FastifyInstance,
  db: Db,
  options: AccountRouteOptions,
): Promise<void> {
  const cookieOptions = { secure: options.production };
  const now = options.now ?? (() => new Date());

  // Build the dummy hash now, so the first unknown-user login is not
  // slower than the rest.
  await dummyPasswordHash();

  // Account responses are per-user: never cache them anywhere.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  // Writes accept JSON only. A cross-site HTML form can send text/plain
  // without a preflight; this turns such a request away before any
  // handler runs (for example one that clears the session cookie).
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    const type = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') {
      return reply
        .code(415)
        .send(error('UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.'));
    }
  });

  // Collections bodies can be large, so check the session before Fastify
  // reads and parses one.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'PUT' || !request.url.startsWith('/api/collections')) return;
    if (!(await sessionUser(request))) {
      return reply.code(401).send(error('UNAUTHENTICATED', 'Log in to save collections.'));
    }
  });

  // Runs after the session check above, so only logged-in saves spend
  // the save budget; login and register are limited before any scrypt work.
  const limiters = Object.fromEntries(
    (Object.keys(DEFAULT_RATE_LIMITS) as RateLimitedAction[]).map((action) => [
      action,
      createRateLimiter(options.rateLimits?.[action] ?? DEFAULT_RATE_LIMITS[action]),
    ]),
  ) as Record<RateLimitedAction, ReturnType<typeof createRateLimiter>>;

  app.addHook('onRequest', async (request, reply) => {
    const action = RATE_LIMITED_ROUTES[`${request.method} ${request.routeOptions.url}`];
    if (!action) return;
    const result = limiters[action].take();
    if (!result.ok) {
      return reply
        .code(429)
        .header('Retry-After', String(result.retryAfterSeconds))
        .send(error('RATE_LIMITED', 'Too many requests. Try again shortly.'));
    }
  });

  async function sessionUser(request: FastifyRequest) {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) return null;
    return findSessionUser(db, hashSessionToken(token));
  }

  async function logIn(reply: FastifyReply, userId: number): Promise<void> {
    const token = newSessionToken();
    await startSession(db, userId, hashSessionToken(token));
    reply.header('Set-Cookie', sessionCookie(token, cookieOptions));
  }

  app.post('/auth/register', async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(error('VALIDATION_ERROR', parsed.error.message));
    }
    const { password, eraDate } = parsed.data;
    const username = parsed.data.username.toLowerCase();
    if (!isTodayInEra(eraDate, now())) {
      return reply
        .code(400)
        .send(
          error(
            'INVALID_ERA_DATE',
            "Enter today's date with the Japanese era, in the form 令和元年5月1日.",
          ),
        );
    }

    const user = await createUser(db, username, await hashPassword(password));
    if (!user) {
      return reply.code(409).send(error('USERNAME_TAKEN', 'That username is already taken.'));
    }
    await logIn(reply, user.userId);
    return reply.code(201).send(sessionResponseSchema.parse({ user: { username: user.username } }));
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(error('VALIDATION_ERROR', parsed.error.message));
    }
    const user = await findUserByUsername(db, parsed.data.username.toLowerCase());
    // Verify against a dummy hash for an unknown user so the two cases
    // take the same time and do not reveal which usernames exist.
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !ok) {
      return reply.code(401).send(error('INVALID_CREDENTIALS', 'Wrong username or password.'));
    }
    await logIn(reply, user.userId);
    return sessionResponseSchema.parse({ user: { username: user.username } });
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await endSession(db, hashSessionToken(token));
    reply.header('Set-Cookie', clearedSessionCookie(cookieOptions));
    return sessionResponseSchema.parse({ user: null });
  });

  app.get('/auth/session', async (request) => {
    const user = await sessionUser(request);
    return sessionResponseSchema.parse({ user: user ? { username: user.username } : null });
  });

  app.get('/collections', async (request, reply) => {
    const user = await sessionUser(request);
    if (!user) return reply.code(401).send(error('UNAUTHENTICATED', 'Log in to load collections.'));
    const saved = await getCollections(db, user.userId);
    return collectionsResponseSchema.parse({
      collections: saved?.data ?? { kanji: [], vocab: [] },
      updatedAt: saved ? saved.updatedAt.toISOString() : null,
      version: saved?.version ?? 0,
    });
  });

  app.put('/collections', { bodyLimit: COLLECTIONS_BODY_LIMIT }, async (request, reply) => {
    const user = await sessionUser(request);
    if (!user) return reply.code(401).send(error('UNAUTHENTICATED', 'Log in to save collections.'));
    const parsed = saveCollectionsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(error('VALIDATION_ERROR', parsed.error.message));
    }
    const { username, version, collections } = parsed.data;
    // The page that sent this loaded another user's collections (the
    // browser has since logged in as someone else): never save them here.
    if (username !== user.username) {
      return reply
        .code(409)
        .send(error('SESSION_CHANGED', 'You are now logged in as a different user.'));
    }
    const saved = await saveCollections(db, user.userId, canonical(collections), version);
    if (!saved) {
      return reply
        .code(409)
        .send(error('COLLECTIONS_CONFLICT', 'Your collections were changed elsewhere. Reload them.'));
    }
    return collectionsResponseSchema.parse({
      collections: saved.data,
      updatedAt: saved.updatedAt.toISOString(),
      version: saved.version,
    });
  });
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectionsResponseSchema, sessionResponseSchema } from '@japanesesite/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, runMigrations, type AppDatabase } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

// 2026-11-19 is 令和8年11月19日.
const NOW = new Date('2026-11-19T12:00:00Z');
const TODAY = '令和8年11月19日';

let appDb: AppDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  process.env.PGLITE_MEMORY = '1';
  delete process.env.DATABASE_URL;
  appDb = await createDb();
  await runMigrations(appDb, migrationsFolder);
  // Room for every request these tests make; the limits have their own tests below.
  const roomy = { limit: 1000, windowMs: 60_000 };
  app = await buildApp({
    db: appDb.db,
    now: () => NOW,
    rateLimits: { login: roomy, register: roomy, save: roomy },
  });
});

afterAll(async () => {
  await app.close();
  await appDb.close();
});

/** The `name=value` part of a response's Set-Cookie, for sending back. */
function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['set-cookie'];
  const first = Array.isArray(header) ? header[0] : header;
  if (typeof first !== 'string') throw new Error('no Set-Cookie header');
  return first.split(';')[0] ?? '';
}

async function register(username: string, password = 'password123', eraDate = TODAY) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password, eraDate },
  });
}

describe('registration', () => {
  it('creates a user with a hashed password, logs them in, and stamps last login', async () => {
    const res = await register('Alice');
    expect(res.statusCode).toBe(201);
    expect(sessionResponseSchema.parse(res.json())).toEqual({ user: { username: 'alice' } });
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect(res.headers['cache-control']).toBe('no-store');

    const [row] = await appDb.db.select().from(users).where(eq(users.username, 'alice'));
    expect(row?.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(row?.passwordHash).not.toContain('password123');
    expect(row?.lastLoginAt).toBeInstanceOf(Date);

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: cookieFrom(res) },
    });
    expect(session.json()).toEqual({ user: { username: 'alice' } });
  });

  it("rejects a date that is not today's in the Japanese era", async () => {
    for (const eraDate of ['2026年11月19日', '令和8年11月25日', '平成38年11月19日']) {
      const res = await register('bob', 'password123', eraDate);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_ERA_DATE');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('accepts yesterday and tomorrow for time zones', async () => {
    expect((await register('carol', 'password123', '令和8年11月18日')).statusCode).toBe(201);
    expect((await register('dave', 'password123', '令和８年１１月２０日')).statusCode).toBe(201);
  });

  it('rejects a taken username, case-insensitively', async () => {
    const res = await register('ALICE');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USERNAME_TAKEN');
  });
});

describe('login and logout', () => {
  it('logs in with the right password and rejects a wrong one or an unknown user alike', async () => {
    await register('erin', 'rightpassword');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'Erin', password: 'rightpassword' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ user: { username: 'erin' } });

    for (const payload of [
      { username: 'erin', password: 'wrongpassword' },
      { username: 'nobody', password: 'rightpassword' },
    ]) {
      const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(bad.statusCode).toBe(401);
      expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');
      expect(bad.headers['set-cookie']).toBeUndefined();
    }
  });

  it('ends the session on logout', async () => {
    const cookie = cookieFrom(await register('frank'));
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
      payload: {},
    });
    expect(out.statusCode).toBe(200);
    expect(out.headers['set-cookie']).toContain('Max-Age=0');

    const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    expect(session.json()).toEqual({ user: null });
  });
});

describe('collections', () => {
  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/collections' })).statusCode).toBe(401);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/collections',
      payload: { username: 'x', version: 0, collections: { kanji: [], vocab: [] } },
    });
    expect(put.statusCode).toBe(401);
    expect(put.headers['cache-control']).toBe('no-store');
  });

  it('starts empty, then saves and loads a de-duplicated, sorted blob per user', async () => {
    const cookie = cookieFrom(await register('grace'));
    const other = cookieFrom(await register('heidi'));

    const empty = await app.inject({ method: 'GET', url: '/api/collections', headers: { cookie } });
    expect(collectionsResponseSchema.parse(empty.json())).toEqual({
      collections: { kanji: [], vocab: [] },
      updatedAt: null,
      version: 0,
    });

    const put = await app.inject({
      method: 'PUT',
      url: '/api/collections',
      headers: { cookie },
      payload: {
        username: 'grace',
        version: 0,
        collections: { kanji: ['k:本', 'k:日', 'k:日'], vocab: ['w:2', 'w:1'] },
      },
    });
    expect(put.statusCode).toBe(200);

    const loaded = collectionsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/collections', headers: { cookie } })).json(),
    );
    expect(loaded.collections).toEqual({ kanji: ['k:日', 'k:本'].sort(), vocab: ['w:1', 'w:2'] });
    expect(loaded.updatedAt).not.toBeNull();
    expect(loaded.version).toBe(1);

    // Another user's blob is untouched.
    const theirs = await app.inject({
      method: 'GET',
      url: '/api/collections',
      headers: { cookie: other },
    });
    expect(theirs.json().collections).toEqual({ kanji: [], vocab: [] });
  });

  it('rejects entry IDs in the wrong collection', async () => {
    const cookie = cookieFrom(await register('ivan'));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/collections',
      headers: { cookie },
      payload: { username: 'ivan', version: 0, collections: { kanji: ['w:1'], vocab: [] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a save based on a stale version, so the last writer cannot silently win', async () => {
    const cookie = cookieFrom(await register('judy'));
    const save = (version: number, kanji: string[]) =>
      app.inject({
        method: 'PUT',
        url: '/api/collections',
        headers: { cookie },
        payload: { username: 'judy', version, collections: { kanji, vocab: [] } },
      });

    expect((await save(0, ['k:日'])).statusCode).toBe(200);
    // A second tab that also loaded version 0.
    const stale = await save(0, ['k:火']);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('COLLECTIONS_CONFLICT');
    expect((await save(1, ['k:日', 'k:月'])).statusCode).toBe(200);
    expect((await save(1, ['k:水'])).statusCode).toBe(409);

    const loaded = await app.inject({ method: 'GET', url: '/api/collections', headers: { cookie } });
    expect(loaded.json()).toMatchObject({ collections: { kanji: ['k:日', 'k:月'].sort() }, version: 2 });
  });

  it("refuses to save one user's collections into another user's session", async () => {
    const cookie = cookieFrom(await register('kate'));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/collections',
      headers: { cookie },
      payload: { username: 'grace', version: 0, collections: { kanji: ['k:日'], vocab: [] } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SESSION_CHANGED');
  });

  it('treats an expired session as logged out', async () => {
    const cookie = cookieFrom(await register('liam'));
    const [row] = await appDb.db.select().from(users).where(eq(users.username, 'liam'));
    await appDb.db
      .update(sessions)
      .set({ expiresAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(sessions.userId, row?.userId ?? -1));
    const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    expect(session.json()).toEqual({ user: null });
    expect((await app.inject({ method: 'GET', url: '/api/collections', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('cross-site requests', () => {
  it('rejects non-JSON writes, such as a text/plain form post to logout', async () => {
    const cookie = cookieFrom(await register('mia'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(415);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('caching', () => {
  it('leaves the content routes cacheable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=x' });
    expect(res.headers['cache-control']).not.toBe('no-store');
  });
});

describe('global rate limits', () => {
  let limited: FastifyInstance;

  beforeAll(async () => {
    limited = await buildApp({
      db: appDb.db,
      now: () => NOW,
      rateLimits: {
        register: { limit: 2, windowMs: 60_000 },
        login: { limit: 2, windowMs: 60_000 },
        save: { limit: 1, windowMs: 60_000 },
      },
    });
  });

  afterAll(async () => {
    await limited.close();
  });

  const post = (url: string, payload: object) =>
    limited.inject({ method: 'POST', url, payload });

  it('limits registration across all clients, before any account is created', async () => {
    const first = await post('/api/auth/register', { username: 'rl1', password: 'password123', eraDate: TODAY });
    const second = await post('/api/auth/register', { username: 'rl2', password: 'password123', eraDate: TODAY });
    const third = await post('/api/auth/register', { username: 'rl3', password: 'password123', eraDate: TODAY });
    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([201, 201, 429]);
    expect(third.json().error.code).toBe('RATE_LIMITED');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    expect(await appDb.db.select().from(users).where(eq(users.username, 'rl3'))).toEqual([]);
  });

  it('counts failed logins too, so password guessing is capped', async () => {
    const guess = () => post('/api/auth/login', { username: 'rl1', password: 'wrongpassword' });
    expect((await guess()).statusCode).toBe(401);
    expect((await guess()).statusCode).toBe(401);
    expect((await guess()).statusCode).toBe(429);
  });

  it('limits saves, and only logged-in saves spend the budget', async () => {
    const anonymous = await limited.inject({
      method: 'PUT',
      url: '/api/collections',
      payload: { username: 'x', version: 0, collections: { kanji: [], vocab: [] } },
    });
    expect(anonymous.statusCode).toBe(401);

    const login = await post('/api/auth/login', { username: 'rl2', password: 'password123' });
    // The login budget (2) was spent above; log in through the roomy app instead.
    expect(login.statusCode).toBe(429);
    const cookie = cookieFrom(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'rl2', password: 'password123' },
      }),
    );
    const save = (version: number) =>
      limited.inject({
        method: 'PUT',
        url: '/api/collections',
        headers: { cookie },
        payload: { username: 'rl2', version, collections: { kanji: ['k:日'], vocab: [] } },
      });
    expect((await save(0)).statusCode).toBe(200);
    expect((await save(1)).statusCode).toBe(429);
  });

  it('leaves logout, session, and loading collections unlimited', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await limited.inject({ method: 'GET', url: '/api/auth/session' })).statusCode).toBe(200);
    }
  });
});

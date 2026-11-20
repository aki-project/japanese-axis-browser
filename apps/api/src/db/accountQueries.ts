import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { KnownCollections } from '@japanesesite/shared';
import { SESSION_MAX_AGE_SECONDS } from '../services/cookies.js';
import type { Db } from './client.js';
import { sessions, userCollections, users } from './schema.js';

export interface UserRow {
  userId: number;
  username: string;
  passwordHash: string;
}

/** Inserts a user, or returns null if the username is taken. */
export async function createUser(
  db: Db,
  username: string,
  passwordHash: string,
): Promise<{ userId: number; username: string } | null> {
  const rows = await db
    .insert(users)
    .values({ username, passwordHash })
    .onConflictDoNothing({ target: users.username })
    // Db is a union of two drivers, which hides returning()'s field
    // selection overload, so take the whole row and pick from it.
    .returning();
  const row = rows[0];
  return row ? { userId: row.userId, username: row.username } : null;
}

export async function findUserByUsername(db: Db, username: string): Promise<UserRow | null> {
  const rows = await db
    .select({ userId: users.userId, username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Starts a session for `userId` keyed by `tokenHash`, stamps the user's
 * last login, and clears out the user's expired sessions.
 */
export async function startSession(db: Db, userId: number, tokenHash: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, sql`now()`)));
    await tx.insert(sessions).values({
      tokenHash,
      userId,
      expiresAt: sql`now() + make_interval(secs => ${SESSION_MAX_AGE_SECONDS})`,
    });
    await tx.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.userId, userId));
  });
}

export async function endSession(db: Db, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** The user owning an unexpired session, or null. */
export async function findSessionUser(
  db: Db,
  tokenHash: string,
): Promise<{ userId: number; username: string } | null> {
  const rows = await db
    .select({ userId: users.userId, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(users.userId, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return rows[0] ?? null;
}

export interface SavedCollections {
  data: KnownCollections;
  updatedAt: Date;
  version: number;
}

export async function getCollections(db: Db, userId: number): Promise<SavedCollections | null> {
  const rows = await db
    .select({
      data: userCollections.data,
      updatedAt: userCollections.updatedAt,
      version: userCollections.version,
    })
    .from(userCollections)
    .where(eq(userCollections.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Replaces the user's collections blob if it is still at
 * `expectedVersion` (0 = never saved), bumping the version. Returns
 * null when another save got there first. One statement either way, so
 * two concurrent saves from the same version cannot both succeed.
 */
export async function saveCollections(
  db: Db,
  userId: number,
  data: KnownCollections,
  expectedVersion: number,
): Promise<SavedCollections | null> {
  const rows =
    expectedVersion === 0
      ? await db
          .insert(userCollections)
          .values({ userId, data, version: 1 })
          .onConflictDoNothing({ target: userCollections.userId })
          .returning()
      : await db
          .update(userCollections)
          .set({ data, updatedAt: sql`now()`, version: sql`${userCollections.version} + 1` })
          .where(
            and(
              eq(userCollections.userId, userId),
              eq(userCollections.version, expectedVersion),
            ),
          )
          .returning();
  const row = rows[0];
  return row ? { data: row.data, updatedAt: row.updatedAt, version: row.version } : null;
}

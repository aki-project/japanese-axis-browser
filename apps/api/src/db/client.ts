import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as dbSchema from './schema.js';

const schema = dbSchema;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/db -> src -> api -> apps -> <repo root>
const REPO_ROOT = path.resolve(__dirname, '../../../..');
export const PGLITE_DATA_DIR = path.join(REPO_ROOT, 'data', 'pglite');

export type AppSchema = typeof schema;

/** The drizzle database handle, whichever driver is active. */
export type Db = NodePgDatabase<AppSchema> | PgliteDatabase<AppSchema>;

export type AppDatabase =
  | {
      kind: 'node-postgres';
      db: NodePgDatabase<AppSchema>;
      close: () => Promise<void>;
    }
  | {
      kind: 'pglite';
      db: PgliteDatabase<AppSchema>;
      close: () => Promise<void>;
    };

/**
 * Creates a database connection. Uses `pg` + node-postgres when
 * DATABASE_URL is set; otherwise falls back to an embedded PGlite
 * database (file-backed under data/pglite/, or in-memory when
 * PGLITE_MEMORY=1) so the app runs without a Postgres daemon.
 */
export async function createDb(): Promise<AppDatabase> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString });
    const db = drizzle(pool, { schema });
    return {
      kind: 'node-postgres',
      db,
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const inMemory = process.env.PGLITE_MEMORY === '1';
  const client = inMemory ? new PGlite() : new PGlite(PGLITE_DATA_DIR);
  const db = drizzle(client, { schema });
  return {
    kind: 'pglite',
    db,
    close: () => client.close(),
  };
}

/** Runs pending migrations against whichever driver `app` was built with. */
export async function runMigrations(app: AppDatabase, migrationsFolder: string): Promise<void> {
  if (app.kind === 'node-postgres') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(app.db, { migrationsFolder });
    return;
  }
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  await migrate(app.db, { migrationsFolder });
}

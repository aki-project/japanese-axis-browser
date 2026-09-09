import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { createDb, runMigrations } from './db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../drizzle');

async function main(): Promise<void> {
  const appDb = await createDb();
  await runMigrations(appDb, migrationsFolder);

  const app = await buildApp({ db: appDb.db });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await appDb.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

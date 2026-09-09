import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, runMigrations } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

async function main(): Promise<void> {
  const app = await createDb();
  try {
    await runMigrations(app, migrationsFolder);
    console.log(`Migrations applied (${app.kind}).`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

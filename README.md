# Japanese Learning Site

One page, one entry, three axes. See `CLAUDE.md` for the full specification and
`DECISIONS.md` for why it is built this way.

## Quick start

```
corepack enable && corepack prepare pnpm@10 --activate
pnpm install
cp .env.example .env         # optional; without DATABASE_URL an embedded PGlite DB is used
docker compose up -d postgres  # optional; Postgres on 127.0.0.1 (needs DATABASE_URL in .env)
pnpm --filter api db:migrate
pnpm --filter pipeline seed
pnpm dev                     # api on :3001, web on :5173
```

Postgres from Docker Compose listens on 127.0.0.1 only, never on the network. The api
`dev`/`db:migrate` and pipeline `load`/`seed`/`check` scripts load the repo-root `.env`
(variables already set in the shell take precedence); tests never read it.

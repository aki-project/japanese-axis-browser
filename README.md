# Japanese Learning Site

One page, one entry, three axes. See `CLAUDE.md` for the full specification and
`DECISIONS.md` for why it is built this way.

## Quick start

```
corepack enable && corepack prepare pnpm@10 --activate
pnpm install
cp .env.example .env         # optional; without DATABASE_URL an embedded PGlite DB is used
pnpm --filter api db:migrate
pnpm --filter pipeline seed
pnpm dev                     # api on :3001, web on :5173
```

With Docker: `docker compose up -d postgres` and set `DATABASE_URL` from `.env.example`.

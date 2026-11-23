# Architecture

How the code is laid out and how a request flows through it. `CLAUDE.md` states
the rules, `DECISIONS.md` explains why they exist; this file is the map.

## Overview

A pnpm monorepo, TypeScript end to end, with four workspaces:

| Workspace | Package name | Role |
|---|---|---|
| `packages/shared` | `@japanesesite/shared` | zod schemas, inferred types, constants. The API contract. |
| `apps/api` | `api` | Fastify server. Read-only REST API over Postgres via Drizzle. |
| `apps/web` | `web` | React 19 + Vite single-page app. The entry page. |
| `packages/pipeline` | `pipeline` | Offline scripts that build and load every content row. |

```
              packages/shared  (schemas, types, constants)
               ▲       ▲       ▲
               │       │       │
  packages/pipeline   apps/api ◄──── HTTP /api/* ──── apps/web
        │              ▲  │
        │  imports     │  │ Drizzle
        └─ api/db/* ───┘  ▼
                      PostgreSQL 16  (or embedded PGlite under data/pglite/)
```

Data flows one way. The pipeline writes every table; the API only reads; the web
app only talks to the API. Nothing is written at request time.

Dependency rules:

- `shared` depends on nothing but zod.
- `api` and `web` both depend on `shared`, never on each other. The web app sees
  the API only through HTTP and the shared schemas.
- `pipeline` depends on `shared` and imports `api/db/schema` and `api/db/client`
  (exposed through the `exports` field of `apps/api/package.json`) so it loads
  into exactly the tables the API reads.

## Repository layout

```
.
├── ARCHITECTURE.md       this file
├── CLAUDE.md             specification and rules
├── DECISIONS.md          rationale for the major decisions
├── README.md             quick start
├── package.json          root scripts: dev, build, test, typecheck, lint, format
├── pnpm-workspace.yaml   apps/*, packages/*
├── tsconfig.base.json    shared strict compiler options
├── eslint.config.js      flat config for the whole repo
├── docker-compose.yml    postgres:16 for local dev
├── .env.example          DATABASE_URL, API_PORT
├── .claude/agents/       backend-dev, frontend-dev, data-pipeline, reviewer
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   ├── shared/
│   └── pipeline/
└── data/
    ├── SOURCES.md        source, version, licence, attribution per dataset
    ├── raw/              gitignored source downloads
    ├── processed/        gitignored JSON Lines output of the pipeline
    ├── seed/             committed connected subset (JSON Lines)
    └── pglite/           gitignored embedded database files
```

---

## packages/shared: the contract

```
packages/shared/src/
├── index.ts         re-exports everything below
├── constants.ts     AXES, RELATIONS_BY_AXIS, RELATIONS, JLPT_LEVELS,
│                    PARTS_OF_SPEECH, DEFAULT_PAGE_SIZE (50), MAX_PAGE_SIZE (200)
├── entryId.ts       EntryId (`k:<literal>` | `w:<ent_seq>`), kanjiEntryId,
│                    wordEntryId, parseEntryId, isEntryId
├── hubs.ts          HUB_KINDS, HUB_KIND_RELATION (kind → axis + relation),
│                    FAMILY_RELATIONS, PAIRWISE_RELATIONS, isFamilyRelation,
│                    hubId / parseHubId, kunHubKey, rankToWeight
├── schemas.ts       zod schemas + inferred types for every entity and every
│                    request/response (see below)
└── searchKey.ts     foldKana, normalizeSearchKey, KATAKANA_CHARS / HIRAGANA_CHARS
```

Each file has a sibling `*.test.ts`.

`schemas.ts` defines:

- **Entities:** `kanjiSchema`, `vocabularyItemSchema`, `radicalSchema`,
  `componentSchema`, `sentenceSchema`, `furiganaSegmentSchema`, `linkSchema`.
- **Responses:** `entryResponseSchema` (discriminated union on `kind`:
  `kanji` | `word`, plus `sentences` and `linkCounts`), `linksResponseSchema`
  (`axes: AxisGroup[]` → `relations: RelationGroup[]` → `entries: LinkedEntry[]`,
  with `total` and `nextCursor` per axis), `searchResponseSchema`,
  `apiErrorSchema`.
- **Queries:** `linksQuerySchema` (comma-separated `axis`, `limit`, `cursor`,
  and an optional comma-separated `jlpt` filter of `JLPT_FILTER_KEYS`; a cursor
  is only valid with a single axis), `searchQuerySchema`.

Both sides validate at runtime with the same objects: the API `.parse()`s every
response body before sending it, and the web client `.parse()`s every body it
receives. `kunHubKey` and `normalizeSearchKey` live here because the pipeline
(which writes the keys) and the API (which queries them) must compute them
identically.

---

## apps/api: backend

```
apps/api/
├── package.json         dev (tsx watch), build, test, db:generate, db:migrate
├── drizzle.config.ts    schema ./src/db/schema.ts → ./drizzle
├── drizzle/             append-only SQL migrations + drizzle-kit metadata
│   ├── 0000_secret_dust.sql   initial tables
│   ├── 0001_tidy_morg.sql     hubs + hub_members
│   └── meta/
└── src/
    ├── server.ts        entry point: createDb → runMigrations → buildApp → listen (API_PORT, default 3001)
    ├── app.ts           buildApp({ db }): Fastify instance, CORS, error and 404 handlers, /api prefix
    ├── routes/
    │   ├── health.ts            GET /api/health
    │   ├── entries.ts           GET /api/entries/search, /:entryId, /:entryId/links
    │   └── entries.test.ts      route tests through app.inject against in-memory PGlite
    ├── db/
    │   ├── schema.ts    Drizzle table definitions
    │   ├── client.ts    createDb (node-postgres or PGlite), runMigrations, Db type
    │   ├── migrate.ts   CLI for db:migrate
    │   └── queries.ts   every SQL query the routes run
    └── services/        pure functions: no HTTP, no database imports
        ├── groupLinks.ts      merge, group by axis → relation, sort, paginate
        ├── cursor.ts          encode/decode the opaque per-axis cursor
        ├── hubWeights.ts      HUB_WEIGHT_BASE per family relation
        ├── searchRanking.ts   mergeSearchResults: interleave kanji/word tiers
        └── entrySummary.ts    kanji/word row → EntrySummary
```

### Layers

1. **Routes** (`routes/`) validate params and query with the shared zod schemas,
   call `db/queries.ts`, hand rows to a service, validate the response with the
   shared schema, and set `Cache-Control` (see Caching below).
2. **Queries** (`db/queries.ts`) own all SQL. Key functions:
   - `findEntryRow` looks up a kanji or a word by the parsed entry ID.
   - `getLinkCounts` returns per-axis totals: pairwise rows plus distinct
     hub siblings. The entry endpoint and the links endpoint both use it, so
     counts and paged totals always agree.
   - `getLinkRowsForAxes` returns all pairwise `links` rows for the requested axes.
   - `getHubSiblingRows` returns one page of siblings for one family relation,
     plus one row so `groupLinks` can tell whether another page follows. It
     computes `weight` in SQL with the same formula as `rankToWeight`, and
     pushes the cursor predicate and `LIMIT` into the query.
   - All of these, and `getLinkCounts`, check targets with one predicate,
     `entryExistsSql`: the target entry exists and, when the request has a
     `jlpt` filter, its JLPT level matches. So filtered totals equal what the
     pages hold, and every page but the last is exactly `limit` long.
   - `getEntrySummaries`, `getSentencesForEntry`, `searchEntries`.
3. **Services** (`services/`) are pure and unit-tested on their own.

### Request flow: `GET /api/entries/:entryId/links?axis=…`

```
parse entryId ─► validate query ─► decode cursor ─► findEntryRow (404 if missing)
   │
   ├─ getLinkRowsForAxes            pairwise rows, full set per axis
   ├─ getHubSiblingRows × relation   family rows, one cursor-bound page each
   │
   ├─ getEntrySummaries(targets)    display data for every target
   ├─ getLinkCounts                 authoritative per-axis totals
   ▼
groupLinks(rows, summaries, axes, limit, cursor, totals)
   ▼
linksResponseSchema.parse ─► Cache-Control ─► 200
```

Ordering within a relation: weight descending (nulls last), then `toEntryId`
ascending by code point (`COLLATE "C"` in SQL, `compareCodePoints` in
JavaScript). Each page of an axis is split between its relations by
`allocateQuotas`: with K relations that still have rows, each gets `limit / K`,
a relation with fewer rows than its share passes the rest to the others, and
any remainder goes one each to the earliest relations. So one large hub never
crowds the other relations off the first page. Each relation then pages
independently: the cursor encodes the axis and, per relation, the last
`(weight, toEntryId)` seen, base64url.

### Errors

All errors use `{ error: { code, message } }`. Route-level codes:
`INVALID_ENTRY_ID`, `ENTRY_NOT_FOUND`, `VALIDATION_ERROR`, `INVALID_CURSOR`. The
global handler maps uncaught `ZodError` to 400 and other errors by status code
(`NOT_FOUND`, `BAD_REQUEST`, `INTERNAL_ERROR`, …).

### Database

| Table | Primary key | Notes |
|---|---|---|
| `kanji` | `literal` | readings, meanings, radical, components, JLPT, frequency |
| `vocabulary_items` | `ent_seq` | surface and reading as separate columns; `search_key` indexed |
| `radicals` | `character` | |
| `components` | `character` | `is_kanji`, etymology |
| `sentences` | `tatoeba_id` | furigana as jsonb segments; empty (deferred) |
| `sentence_entries` | `(sentence_id, entry_id)` | index on `entry_id` |
| `links` | `(from, to, axis, relation)` | pairwise relations only; index `(from_entry_id, axis)` |
| `hubs` | `hub_id` | `kind`, `label`, `member_count` |
| `hub_members` | `(hub_id, entry_id)` | `rank`; indexes `(hub_id, rank, entry_id)` and `(entry_id)` |

Entries are not a table: an entry ID resolves to `kanji` (`k:`) or
`vocabulary_items` (`w:`). Axis, relation and JLPT level are text columns,
validated by zod rather than Postgres enums.

`db/client.ts` picks the driver at startup: `pg` when `DATABASE_URL` is set,
otherwise PGlite stored in `data/pglite/` (or in memory with
`PGLITE_MEMORY=1`, which the tests use). Only one process can open
`data/pglite/` at a time.

---

## apps/web: frontend

```
apps/web/
├── index.html
├── vite.config.ts       React + Tailwind plugins; dev proxy /api → localhost:3001; Vitest (jsdom)
└── src/
    ├── main.tsx         QueryClientProvider → BrowserRouter → App
    ├── App.tsx          header with SearchBox; routes
    ├── index.css        Tailwind entry
    ├── setupTests.ts    Testing Library matchers
    ├── api/
    │   ├── index.ts     re-exports client
    │   └── client.ts    getEntry, getLinks, searchEntries; ApiClientError
    ├── pages/
    │   ├── EntryPage.tsx      the whole product: entry, trail, axis panels
    │   └── NotFoundPage.tsx
    ├── hooks/
    │   ├── useEntry.ts            TanStack Query for one entry
    │   ├── useLinks.ts            useAxisLinks: one infinite query per axis
    │   ├── useSearch.ts           search query
    │   ├── useDebouncedValue.ts
    │   ├── useTrail.tsx           TrailProvider + useTrail, reconciled with history
    │   ├── useAxisVisibility.ts   axis toggles, persisted in localStorage
    │   ├── useJlptFilter.ts       JLPT level filter, persisted in localStorage
    │   └── useKeyboardNav.ts      Backspace / [ back; S P K toggle axes
    └── components/
        ├── EntryDetails.tsx     the centred entry: readings, meanings, furigana
        ├── Furigana.tsx         the only <ruby>/<rt> renderer
        ├── AxisPanel.tsx        one axis: relation groups, states, "Load more"
        ├── AxisToggleBar.tsx    S / P / K toggles
        ├── JlptFilterPanel.tsx  N5–N1 / none toggles
        ├── axisMeta.ts          per-axis label + glyph; relation labels
        ├── EntryLink.tsx        a link to another entry (client-side route change)
        ├── Trail.tsx            breadcrumb of visited entries
        ├── SearchBox.tsx        debounced search with results dropdown
        ├── JlptBadge.tsx
        ├── SentenceList.tsx     example sentences (empty until Tatoeba is enabled)
        ├── EntrySkeleton.tsx    loading state
        ├── ErrorScreen.tsx      error state with retry
        └── NotFoundScreen.tsx   invalid or unknown entry
```

Tests sit next to the files they cover (`*.test.ts(x)`).

### Routing

| Path | Renders |
|---|---|
| `/` | redirect to `/e/k:日` |
| `/e/:entryId` | `TrailProvider` → `EntryPage` |
| `*` | `NotFoundPage` |

### Data flow on the entry page

```
EntryPage(entryId)
 ├─ useEntry(entryId) ──────────► GET /api/entries/:id
 │     entry + linkCounts, so axis headers show counts before links arrive
 ├─ useAxisLinks(id, 'semantic',   visible, jlpt) ─► GET …/links?axis=semantic[&jlpt][&cursor]
 ├─ useAxisLinks(id, 'phonetic',   visible, jlpt) ─► GET …/links?axis=phonetic[&jlpt][&cursor]
 ├─ useAxisLinks(id, 'structural', visible, jlpt) ─► GET …/links?axis=structural[&jlpt][&cursor]
 │     hidden axes are not fetched; "Load more" fetches the next cursor page
 ├─ useAxisVisibility / useJlptFilter      local storage, try/catch, default all on
 ├─ useTrail                               visited entries, mirrored in history
 └─ useKeyboardNav                         back = navigate(-1); S/P/K = toggle
```

- **Server state** lives only in TanStack Query. Components never call `fetch`;
  hooks call `src/api/client.ts`, which validates every response with the
  shared schemas and throws `ApiClientError` (status + code) on failure.
- **Client state** is axis visibility and the JLPT filter (local storage) and
  the trail (React context in `useTrail.tsx`). `reconcileTrail` matches the
  trail to the browser history index, so the back button and the in-page back
  key always agree.
- **States:** each view separates loading, empty, and error. `AxisPanel` also
  separates "hidden by toggle", "no links match the JLPT filter" and "no JLPT
  levels selected" from "no links".
- **Axis identity** is shown by a letter glyph (S / P / K) and a label from
  `axisMeta.ts`, not only by colour.
- The JLPT filter is applied by the API. `selectedJlptKeys` turns it into the
  `jlpt` parameter (omitted when every level is on, so the unfiltered cache is
  shared), and it is part of each links query key. With every level off,
  nothing is fetched. Axis headers show the filtered total from the links
  response against the unfiltered count from the entry response.

---

## packages/pipeline: data

The pipeline is not part of the runtime, but it produces every row the API
serves, so it is listed here.

```
packages/pipeline/src/
├── stages/            one script per stage, run with tsx, in order
│   ├── 1_download.ts    fetch sources into data/raw/ (skip if present unless --force)
│   ├── 2_parse.ts       stream each source to data/processed/raw-*.jsonl
│   ├── 3_transform.ts   build kanji, words, radicals, components .jsonl
│   ├── 4_link.ts        build links.jsonl, hubs.jsonl, hub_members.jsonl
│   ├── 5_validate.ts    zod-validate every line; check referential integrity and member_count
│   ├── 6_load.ts        migrate, then upsert in batches of 500 (--dir=processed|seed)
│   ├── 7_seed.ts        build the connected subset into data/seed/
│   ├── 8_sentences.ts   stub: Tatoeba deferred, exits 0
│   └── 9_check.ts       post-load counts and quality report against the live DB
├── parsers/           streaming parsers: jmdict, kanjidic2, kradfile, radkfile,
│                      ids, wordnet, jlpt, gunzipFile
├── transform/         kanji, words, radicals, components: raw records → shared schemas
├── link/              one module per axis plus shared helpers
│   ├── semantic.ts      see_also, antonym (pairwise); synonym, shared_sense (hubs)
│   ├── phonetic.ts      homophone, shared_on_reading, shared_kun_reading (hubs only)
│   ├── structural.ts    contains_kanji/contained_in, has_component/component_of (pairwise);
│   │                    shared_radical, shared_phonetic_component (hubs)
│   ├── hubs.ts          buildHubs: dedupe members, drop hubs with fewer than 2 members
│   └── common.ts        symmetrize, dedupe, rank tiers
└── lib/               paths, jsonl reader/writer, hubRecords schemas,
                       kangxiRadicals, partOfSpeech
```

Scripts in `packages/pipeline/package.json`: `download`, `parse`, `transform`,
`link`, `validate`, `load`, `seed:build` (rebuild and validate `data/seed/` from
`data/processed/`), `seed` (validate and load the committed `data/seed/`; works on
a fresh clone), `sentences`, `check`, and `all`.

---

## Cross-cutting

- **Pairwise vs family.** `links` holds two-entry facts. Hubs plus memberships
  hold "everything that shares an X". The API merges both into one response
  shape, so the frontend cannot tell them apart. The mapping from hub kind to
  axis and relation lives in `HUB_KIND_RELATION` (`packages/shared/src/hubs.ts`).
- **Japanese text.** Surface and reading are separate fields at every layer.
  Kana folding happens only in `search_key` and search, through
  `normalizeSearchKey`. Furigana is stored as segments and rendered only by
  `Furigana.tsx`. Elements containing Japanese carry `lang="ja"`.
- **Caching.** In production (`NODE_ENV=production`, set by the api `start`
  script) entry, links and search responses are `public, max-age=86400`, since
  content changes only when the pipeline reloads. Otherwise they are `no-cache`,
  so a reload shows up immediately. `buildApp({ db, production })` takes the
  flag; `server.ts` derives it from `NODE_ENV`. Error responses carry no
  `Cache-Control`.
- **Testing.** Vitest in every workspace. API route tests run against in-memory
  PGlite through `app.inject`. Web tests use jsdom and Testing Library. Pipeline
  tests use small fixtures for the JMdict and KANJIDIC2 parsers, the kanji and
  word transforms, and every axis module.

## Common commands

```
pnpm install
pnpm dev                          # api :3001 and web :5173
pnpm test | pnpm typecheck | pnpm lint
pnpm --filter api db:generate     # new migration from a schema.ts change
pnpm --filter api db:migrate
pnpm --filter pipeline seed       # validate and load the committed data/seed
pnpm --filter pipeline seed:build # rebuild data/seed from data/processed
pnpm --filter pipeline all        # full pipeline from the raw sources
```

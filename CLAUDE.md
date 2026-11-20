# Japanese Learning Site

A web application for exploring Japanese as a linguistic web. At any moment the page is centred on a single active **Entry**, a kanji or a word. The learner moves through the language by following links from that entry to related entries, choosing which **axis** to travel along. There is nothing else: no lessons, decks, reviews, quizzes, or accounts. The whole site is the web and the page that shows one node of it.

## Core concept

- **One active entry at a time.** The entry occupies the centre of the page with its readings, meanings, and furigana. Everything else on screen is a link away from it.
- **Three axes.** Every link between entries belongs to exactly one axis:
  - **Semantic** - synonyms, near-synonyms, antonyms, and words sharing a sense. Source: JMdict cross-references and sense groupings, Japanese WordNet.
  - **Phonetic** - homonyms and near-homonyms: entries sharing a reading, or kanji sharing an on-reading. Source: derived from readings in JMdict and KANJIDIC2.
  - **Structural** - kanji composition and etymology: a word to the kanji it contains, a kanji to its components and radicals, kanji sharing a radical or phonetic component. Source: KRADFILE, RADKFILE, and a component decomposition dataset.
- **Navigation is the product.** Following a link replaces the active entry and pushes the previous one onto a trail. The trail is visible, and the learner can step back along it. The URL always identifies the active entry so any position in the web is shareable and reloadable.
- **Axis filtering.** The learner can show one axis, several, or all. The chosen axes persist across navigation until changed.
- **No user state.** The site is anonymous and read-only. There are no accounts and no user-specific tables. The only per-viewer state is axis visibility, kept in local storage.
- Relationships are content, computed by the pipeline and stored, not inferred at request time. The API serves them; the frontend never derives relationships itself.
- **Two storage shapes.** A *pairwise* relation (A relates to B and to nothing else by that fact) is a row in `links`. A *family* relation ("everything that shares an X") is a **Hub** plus its memberships, and the API materializes siblings from it. Never store a family as pairwise edges: a family of k members costs k(k-1) rows and forces per-entry caps that hide members.

## Stack

Decided. Do not propose alternatives unless asked.

- **Language:** TypeScript end to end, strict mode, Node 22 LTS.
- **Monorepo:** pnpm workspaces.
- **Backend:** Fastify, Drizzle ORM, PostgreSQL 16, zod for validation. No authentication.
- **Frontend:** React 19 with Vite, React Router, TanStack Query for server state, Tailwind CSS, Vitest and Testing Library.
- **Shared types:** a `packages/shared` workspace exporting zod schemas and inferred TypeScript types. Both sides import from it. It is the API contract.
- **Data pipeline:** TypeScript scripts under `packages/pipeline`, run with `tsx`. Raw sources are gitignored. Processed output is JSON Lines.
- **Tooling:** ESLint, Prettier, Vitest everywhere. Docker Compose for local Postgres.

## Layout

```
apps/
  api/          Fastify server. src/routes, src/services (pure logic: link grouping and ranking), src/db (Drizzle schema + migrations)
  web/          React app. src/components, src/pages, src/api (typed client), src/hooks
packages/
  shared/       zod schemas, inferred types, shared constants (JLPT levels, parts of speech)
  pipeline/     download, parse, transform, validate, load stages; seed subset in data/seed/
data/
  raw/          gitignored source downloads (JMdict, KANJIDIC2, KRADFILE, RADKFILE, Japanese WordNet, component decomposition data, Tatoeba, JLPT lists)
  processed/    gitignored JSON Lines output
  seed/         small committed subset for local dev and tests
  SOURCES.md    source, version, licence, and attribution for every dataset
.claude/agents/ backend-dev, frontend-dev, data-pipeline, reviewer
```

Until a directory exists, create it at the path above rather than inventing a new location.

## Commands

Run from the repo root once the workspace is scaffolded.

```
pnpm install
pnpm dev                 # api and web concurrently
pnpm --filter api dev
pnpm --filter web dev
pnpm test                # all workspaces
pnpm typecheck
pnpm lint
pnpm --filter api db:generate   # create migration from schema change
pnpm --filter api db:migrate
pnpm --filter pipeline seed     # load data/seed into local Postgres
docker compose up -d postgres
```

## Domain model

Entity names are fixed. Use them in code, tables, and API paths.

- **Entry** - the navigable unit. Either a Kanji or a VocabularyItem. Has a stable `entry_id` of the form `k:<literal>` or `w:<ent_seq>`. Entries are not a separate table; the ID scheme is the union.
- **Link** - a stored edge between two entries for a **pairwise** relation only: `from_entry_id`, `to_entry_id`, `axis`, `relation`, optional `weight`, and `source`. Stored once per direction so a lookup by `from_entry_id` is a single indexed query. The pairwise relations are `contains_kanji`, `contained_in`, `has_component`, `component_of`, `see_also`, and `antonym`.
- **Hub** - the shared thing at the centre of a **family** relation: a radical, a component, an on reading, a kun reading, a word reading, a WordNet synset, or an English gloss. `hub_id` is `h:<kind>:<key>`, plus `kind`, `label` (what to display), and `member_count`. Hubs are not Entries and have no page of their own yet.
- **HubMember** - an entry's membership in a hub: `hub_id`, `entry_id`, `rank` (lower sorts first; kanji use KANJIDIC2 frequency, words use a commonness and JLPT tier). Siblings of an entry on a family relation are the other members of its hubs.
- **Radical** - character, name, stroke count. Referenced by Kanji.
- **Component** - a kanji or non-kanji shape that appears inside other kanji, with an optional etymology note. Referenced by Kanji as parts.
- **VocabularyItem** - surface form, kana reading, alternates, meanings, parts of speech, JLPT level, `is_common` (JMdict priority flag, used by the pipeline to filter and rank), optional audio URL, `search_key`. Source ID from JMdict `ent_seq`.
- **Kanji** - character, on and kun readings, meanings, stroke count, radical, component parts, etymology note, JLPT level, `frequency` (KANJIDIC2 rank, used by the pipeline to cap fan-out on shared-reading and shared-radical links). Source ID is the literal.
- **Sentence** - Japanese text, English translation, aligned furigana segments, Tatoeba ID and licence. Shown on an entry page as examples; not itself an Entry. **Deferred:** the Tatoeba download and sentence stage are left out of the first build. The table, schema, and frontend section stay; the pipeline stage is a skipped stub until enabled.

All tables are content tables, loaded by the pipeline. Nothing is written at request time.

### Future user customization

Not built now. When it is added, the only per-user data will be a learned or unlearned status per entry: one table keyed on `(user_id, entry_id)` with a `learned_at` timestamp. No decks, review schedules, scores, or progress aggregates. Do not add columns or tables in anticipation of it.

## Rules that apply everywhere

### Japanese text
- UTF-8 everywhere, explicit on file reads and writes.
- Never apply NFKC normalization. NFC is acceptable.
- Surface form and reading are always separate fields. Never concatenate them into one string.
- Furigana is stored as aligned segments `{ base, reading }[]` and rendered with `<ruby>` and `<rt>`.
- Elements containing Japanese carry `lang="ja"`.
- Preserve hiragana and katakana as written. Conversion happens only in an explicitly named search-key field.

### API contract
- Schemas in `packages/shared` are the single source of truth. Change the schema first, then the server, then the client.
- REST paths: `/api/entries/:entryId`, `/api/entries/:entryId/links?axis=semantic,phonetic,structural`, `/api/entries/search?q=`. All routes are GET and public.
- `/api/entries/:entryId` returns the full entry plus a summary count of links per axis so the page can render axis controls before links load.
- Links are returned grouped by axis, then by relation, ordered by weight descending. Link lists are paginated per axis, and each page is split evenly between the axis's relations that still have links (`limit / K` each for K such relations; a relation's unused share goes to the others), so every relation appears on the first page. The cursor carries a position per relation.
- The links endpoint takes an optional `jlpt` filter (comma-separated JLPT levels and `none`). It is applied in SQL before paging and in `total`, so every page but the last is full. The entry endpoint's per-axis counts are never filtered.
- The response shape does not distinguish pairwise from family relations. The API materializes family siblings from hubs at request time, derives their `weight` from `rank`, and merges them with the pairwise rows before grouping. A relation appears in exactly one of the two shapes, never both.
- Error shape: `{ error: { code: string, message: string } }`.
- Lists that can grow are paginated. Cursor-based, default 50.
- Responses for entries and links are cacheable. In production (`NODE_ENV=production`, set by the api `start` script) send `Cache-Control: public, max-age=86400`, since content changes only when the pipeline reloads. Outside production send `no-cache`, so a data reload shows up immediately.

### Business logic
- Link grouping, ranking, and search-key handling live in `apps/api/src/services` as pure functions with no HTTP or database imports, each with unit tests.

### Database
- Every schema change is a new Drizzle migration. Never edit an applied migration.
- `(from_entry_id, axis)` index on links is required. Links are upserted keyed on `(from_entry_id, to_entry_id, axis, relation)`.
- Hub membership lives in `hubs(hub_id PK, kind, label, member_count)` and `hub_members(hub_id, entry_id, rank, PK(hub_id, entry_id))`, with an index on `(hub_id, rank, entry_id)` for ordered paging and one on `entry_id` for the entry-to-hubs lookup. Upserts key on the primary keys.
- Each hub kind maps to exactly one axis and relation: `radical` to structural/`shared_radical`, `component` to structural/`shared_phonetic_component`, `on` to phonetic/`shared_on_reading`, `kun` to phonetic/`shared_kun_reading`, `reading` to phonetic/`homophone`, `synset` to semantic/`synonym`, `gloss` to semantic/`shared_sense`.
- Family relations have no cap. A hub with 500 members is served by paging, not by truncation at load time.
- Per-axis counts and paged results must agree exactly. Count distinct partner entries per relation, so an entry sharing two hubs of the same kind with the same partner counts once.
- Seed and pipeline loads use upserts keyed on source IDs so re-runs update rather than duplicate.

### Pipeline
- Link generation is its own stage, run after all entries are loaded. Each axis has a separate module with a documented rule for when a link is emitted, and unit tests on small fixtures.
- The same stage emits hubs and memberships for the family relations. A hub with fewer than two members is dropped. `member_count` is written by the pipeline and must equal the number of membership rows.
- Kun-reading hubs key on the full reading including okurigana, so 日 (ひ) and 彈 (ひ.く) do not share a hub. Prefix and suffix hyphens are stripped; the okurigana dot is removed and the parts joined.
- Phonetic links are derived from readings, never from surface forms. Kana are compared as written; no hiragana-to-katakana folding outside the search-key field.
- Structural links come from decomposition data, not from string matching on characters.
- Every link records its `source` so a bad rule can be re-run without touching links from other sources.
- The seed subset must form a connected web: every seed entry has at least one link on at least one axis.

### Frontend
- Components never call `fetch`. All requests go through `apps/web/src/api`.
- Every data view handles loading, empty, and error states distinctly.
- The entry page is the home route. Route is `/e/:entryId`. The active entry is centred; links are arranged around it grouped by axis, with each axis visually distinct by more than colour alone.
- Following a link is a client-side route change. The trail is kept in client state and mirrored in history so the browser back button steps back one entry.
- Axis visibility lives in local storage, wrapped in try/catch, defaulting to all axes on. It survives navigation and reload.
- Entry page is keyboard-navigable: Tab moves between links, Enter follows, Backspace or `[` steps back along the trail, `S` `P` `K` toggle the semantic, phonetic, and structural axes.
- Colour is never the only signal for which axis a link belongs to.

## Working conventions

- Read neighbouring files before adding new ones and match their style.
- Smallest change that fully does the job. No drive-by refactors.
- Run `pnpm typecheck` and the relevant tests before reporting done.
- Do not commit unless asked. When asked, use conventional commit prefixes: `feat`, `fix`, `chore`, `data`, `docs`.

## Agents

Use the agents in `.claude/agents/` for work that fits their scope. `backend-dev`, `frontend-dev`, and `data-pipeline` each stay on their own side and report cross-boundary needs instead of editing across. Run `reviewer` on any non-trivial diff before it is committed.

## Follow-ups

Known gaps and decisions deferred at the end of the first build (2026-09-08). Not scheduled; pick up when asked.

- **Hubs are not navigable.** A hub has no entry ID and no page. Giving hubs an `h:` entry kind would let a learner step to the radical 心 or the reading ニチ and see the whole family, which is closer to the linguistic-web idea than a sibling list. Needs an entry-ID change, a hub page, and a frontend route.
- **Hub migration not independently reviewed.** The review agent for the hub change was cut short by an account spend limit. The change is covered by the test suite and by full pagination walks against the loaded data, and the SQL weight expression was hand-checked against `rankToWeight`, but no second pass has read it end to end.
- **Kanji have no semantic links.** Japanese WordNet covers words only, so the semantic axis on any kanji page is empty. A kanji-side sense source, or deriving kanji senses from the words that contain them, would fill it.
- **Unused indexes.** The two GIN indexes on `kanji.on_readings` and `kanji.kun_readings` are not used by any query; drop them in a new migration.
- **Not checked in a real browser.** Layout, ruby rendering, and kana/kanji/Latin baseline alignment are verified only by jsdom tests and a production build.
- **Version pins.** TypeScript 5.9, Vite 7, Vitest 4, and React Router 7 were pinned deliberately below the newest majors. Upgrade one at a time when wanted.
- **Sentences.** Tatoeba download, the sentence stage, and the furigana segmenter are stubbed. The tables and frontend section exist and are empty.
- **Local database.** This machine now runs the Docker Compose Postgres on host port 5433, because the system Postgres holds 5432; `.env` sets `POSTGRES_PORT` and `DATABASE_URL` accordingly. The full dataset is loaded into it. The api `dev`/`db:migrate` and pipeline `load`/`seed`/`check` scripts load `.env` with `--env-file-if-exists`; tests do not. Without `DATABASE_URL` everything falls back to PGlite in `data/pglite/` (one process at a time).

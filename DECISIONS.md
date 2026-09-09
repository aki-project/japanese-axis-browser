# Design decisions

Why this project is built the way it is. `CLAUDE.md` states the rules; this
file explains the reasoning behind them, so a later reader can tell which
choices are load-bearing and which are conveniences. Written 2026-09-08.

---

## 1. What the product is

**One entry at a time, and navigation is the product.** The page is centred on
a single kanji or word. Everything else on screen is a way to leave it. Lessons,
decks, spaced repetition, quizzes, and accounts were specified early and then
deliberately removed, because they compete with the one thing the site is for.

**Three axes, not a flat list of "related words".** Every connection between
two entries is labelled with the *kind* of relatedness:

| Axis | Question it answers |
|---|---|
| Semantic | What else means roughly this? |
| Phonetic | What else sounds like this? |
| Structural | What is this built from, and what shares those parts? |

The axis is the interesting part. A learner exploring 日 through its radical is
doing something different from a learner exploring it through its reading, and
collapsing the two into one "related" list would destroy that distinction.

**The URL is the entry.** Any position in the web is shareable and reloadable,
and the browser back button steps back one entry. This is why the trail is
reconciled against browser history rather than kept as a private stack.

**No user state.** The site is anonymous and read-only. Nothing is written at
request time; every row comes from the pipeline. If per-user state is ever
added, the plan is a single learned/unlearned flag per entry and nothing more.

---

## 2. Language and data decisions

These are the decisions that determine whether the site is *correct about
Japanese*, as opposed to merely working.

**Surface form and reading are always separate fields.** They are never
concatenated, not in the database, not in the API, not in React keys. A word is
a pairing of a written form and a reading, and merging them loses the pairing
irrecoverably.

**Never apply NFKC normalization; NFC is fine.** NFKC folds half-width and
full-width forms together, which silently rewrites the user's content. This is
the single most dangerous default in Unicode handling for Japanese.

**Kana folding happens in exactly one place.** Katakana-to-hiragana conversion
is confined to the `search_key` field, so that a search for ニホン finds にほん
without any *stored* or *displayed* value ever being altered. The fold lives in
one shared function used by both the pipeline that writes the field and the API
that queries it, so the two cannot drift.

**Furigana is data, not markup.** It is stored as aligned `{base, reading}`
segments and rendered to `<ruby>`/`<rt>` by exactly one component. Storing
pre-rendered markup would make the reading unqueryable and lock the display
format into the database.

**Japanese text carries `lang="ja"`.** Without it, browsers may render Chinese
glyph variants for characters the two languages share. This is invisible in
tests and obvious to a reader.

**Radicals come from KANJIDIC2, not KRADFILE.** The first implementation took
KRADFILE's first listed component as the radical. KRADFILE is a *visual search
decomposition*, not a radical-first list, and 36.6% of kanji got the wrong
radical: 悪 was assigned ｜ rather than 心, 本 was assigned 一. Because
`shared_radical` is the largest relation on the site, this was quietly poisoning
the structural axis. KANJIDIC2's classical radical is now preferred, with
KRADFILE only as a fallback.

**Kun-reading families key on the full reading, including okurigana.** Keying on
the part before the dot made 日 (ひ) a phonetic sibling of 彈 (ひ.く). That is
defensible linguistically, since the kanji really is read ひ there, but as a
navigation edge it is noise. The full reading is the useful grouping.

**Phonetic matching compares kana exactly as written.** No folding, no
normalization. Two words are homophones only if their readings are literally
identical. Alternate readings participate, so a word with two readings joins
both families.

**Structural links come from decomposition data, not string matching.** Whether
一 is a *component* of a kanji is a fact from the IDS dataset, not something to
be inferred by looking for the character inside another character.

**Word choice within a JMdict entry respects reading restrictions.** An entry
can list several written forms and several readings, where a given reading only
applies to some forms. Naively pairing the first of each produced combinations
that do not occur in the language. This changed 39 entries.

**Coverage was deliberately narrowed.** Of 130,480 JMdict entries that passed
basic filtering, 30,437 were kept: those marked common or carrying a JLPT level.
All 13,108 KANJIDIC2 kanji were kept, less 475 that have neither a reading nor a
meaning and so cannot be displayed. The tradeoff is real and visible: 日本 has
no homophone because 二本 fell outside the kept set.

**JLPT levels are approximate and sourced.** Word levels come from a community
list. Kanji levels come from KANJIDIC2's old four-level scale, which maps to
N5, N4, N2, and N1 with no N3, so no kanji is ever labelled N3. Documented
rather than guessed at.

**Ranking is by commonness, not by code point.** Within a relation, words rank
by JLPT level then commonness, and kanji rank by KANJIDIC2 frequency. Before
this, every link in a group carried an identical weight and the display order
collapsed to Unicode order, so 日 led with お誕生日おめでとうございます and a
string of obscure kanji. It now leads with the days of the week.

---

## 3. The storage decision: pairwise links versus hubs

This is the largest structural decision in the project and it was made twice.

**First attempt: everything is an edge.** Every relation, including "shares a
radical", was stored as a row linking two entries. This is simple and uniform,
and it does not work. A family of k members costs k(k-1) edges, so the table
reached 2.35 million rows and required a cap of 30 partners per entry. The cap
meant a learner could never see the full family, and the pipeline silently chose
which 30 survived.

**Second attempt: split by shape.** A relation that connects exactly two things
stays an edge. A relation that means "everything sharing an X" becomes a hub
plus memberships, and the API materialises the siblings when asked.

| Kept as edges | Moved to hubs |
|---|---|
| `contains_kanji`, `contained_in` | `shared_radical`, `shared_phonetic_component` |
| `has_component`, `component_of` | `shared_on_reading`, `shared_kun_reading` |
| `see_also`, `antonym` | `homophone`, `synonym`, `shared_sense` |

The result: 155,070 edges plus 32,668 hubs and 169,415 memberships, replacing
2,349,570 edges. The caps are gone, so the largest radical family, 648 members,
is fully reachable by paging.

**`synonym` is a family, not a pair.** This is the easy mistake. It sounds
pairwise, but it comes from WordNet synsets, which are sets. It alone accounted
for 158,000 of the removed rows. Any future relation should be classified by
asking whether it is a fact about two things or about membership in a group.

**The API response shape did not change.** Hubs are an internal storage
decision. The frontend was not touched by the migration, which is the main
evidence that the contract boundary was drawn in the right place.

---

## 4. Engineering decisions

**TypeScript end to end.** One language across the API, the web app, and the
pipeline means the zod schemas in `packages/shared` are imported directly by all
three. No generated clients, no drift between a server type and a client type.

**The schemas are the contract, and they run.** zod validates at runtime and the
TypeScript types are inferred from the same objects, so there is exactly one
definition per shape. The API validates its own responses in tests; the client
validates what it receives.

**Pure services.** Ranking, grouping, cursor encoding, and search-key handling
are plain functions with no HTTP and no database imports, so they can be tested
directly. Route handlers validate, query once, call a service, and respond.

**Counts and pages come from one query.** The per-axis counts on the entry page
and the totals on the links endpoint are computed by the same function. When
they were computed separately they disagreed, because one counted links whose
target was not loaded and the other did not.

**Pagination is cursor-based with a total sort order.** The cursor is scoped to
one axis and includes the relation, because the same target entry can appear
under two relations and a key of (weight, target) alone let rows fall through
the cracks permanently. Correctness here is verified by walking a whole axis at
small page sizes and checking the distinct count against the reported total.

**Axis, relation, and JLPT level are stored as text, not Postgres enums.** The
zod schemas already validate them, and text keeps the same migration runnable
against both the real Postgres driver and the embedded fallback.

**Migrations are append-only.** Two exist; neither has been edited after being
applied.

**Responses are cacheable.** Content changes only when the pipeline reloads, so
entry, link, and search responses carry a long max-age.

**The pipeline is staged and idempotent.** Download, parse, transform, link,
validate, load, seed, check. Each stage can be re-run and produces the same
output. Intermediate data is JSON Lines so it can be diffed, grepped, and
streamed. Parsers stream rather than loading XML into a DOM, because JMdict does
not fit comfortably in memory.

**IDs come from the source, never from position.** Kanji are keyed by their
literal, words by the JMdict entry sequence, hubs by kind and key. Re-running a
load updates rows instead of duplicating them.

**A committed seed subset.** A small connected slice of the data lives in the
repo so the app runs and tests pass without a multi-hour import. The seed build
fails if any entry in it is isolated.

---

## 5. Decisions forced by this machine

**The database is embedded by default.** Docker is not installed here and the
local Postgres rejects every available credential, so when no connection string
is set, both the API and the pipeline use PGlite, an in-process build of
Postgres, storing data under `data/pglite/`. The same schema and migrations run
on both. Docker Compose and a connection string remain the documented path.
Only one process can hold that directory, so the API must be stopped before a
pipeline load.

**Dependencies are pinned one major behind in four places.** TypeScript,
Vite, Vitest, and React Router were pinned to the latest release of their
previous major, because their current majors postdate what I can verify. Each is
a single bump when wanted.

---

## 6. How the work was organised

Four subagents, defined in `.claude/agents/`, each owning one side: backend,
frontend, data pipeline, and a read-only reviewer. The three implementers stay
on their own side of the API contract and report cross-boundary needs instead of
editing across, which is what made it safe to run backend and frontend work
concurrently against a contract fixed in advance.

Every substantial change was reviewed before being committed. The reviewer found
the pagination bugs, the radical bug, and the search bugs, all of which passed
the test suite at the time, because the tests only exercised the cases that
worked. The exception is the hub migration itself, whose review was cut short by
an account spend limit; it is covered by tests and by pagination walks, but has
not had a second pass.

---

## 7. Deliberately not done

- **Example sentences.** Tatoeba is by far the heaviest source and needs a
  Japanese segmenter for furigana alignment. The tables, schema, and frontend
  section exist and are empty.
- **Hubs as destinations.** A hub has no entry ID and no page, so a learner can
  see the siblings that share a radical but cannot step to the radical itself.
  This is the most promising next feature.
- **Semantic links for kanji.** WordNet covers words only, so the semantic axis
  is empty on every kanji page.
- **A real browser check.** Layout, ruby rendering, and glyph alignment are
  verified only by jsdom tests and a production build.

---

## 8. Sources

JMdict and KANJIDIC2 for words and kanji, KRADFILE and RADKFILE for radicals,
the CJKVI IDS dataset for kanji composition, Japanese WordNet for synonyms, and
a community JLPT word list. Every dataset, with its licence and required
attribution, is recorded in `data/SOURCES.md`. Raw downloads and processed
output are gitignored.

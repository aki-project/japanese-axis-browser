import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryResponseSchema, linksResponseSchema, searchResponseSchema } from '@japanesesite/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, runMigrations, type AppDatabase } from '../db/client.js';
import {
  hubMembers,
  hubs,
  kanji,
  links,
  sentenceEntries,
  sentences,
  vocabularyItems,
} from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

let appDb: AppDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  process.env.PGLITE_MEMORY = '1';
  delete process.env.DATABASE_URL;

  appDb = await createDb();
  await runMigrations(appDb, migrationsFolder);
  const db = appDb.db;

  await db.insert(kanji).values([
    {
      literal: '日',
      onReadings: ['ニチ', 'ジツ'],
      kunReadings: ['ひ', 'か'],
      meanings: ['day', 'sun'],
      strokeCount: 4,
      radical: '日',
      components: ['日'],
      etymology: null,
      jlptLevel: 'N5',
      frequency: 1,
    },
    {
      literal: '本',
      onReadings: ['ホン'],
      kunReadings: ['もと'],
      meanings: ['book', 'origin'],
      strokeCount: 5,
      radical: '木',
      components: ['木'],
      etymology: null,
      jlptLevel: 'N5',
      frequency: 2,
    },
    {
      literal: '語',
      onReadings: ['ゴ'],
      kunReadings: ['かたる'],
      meanings: ['language', 'word'],
      strokeCount: 14,
      radical: '言',
      components: ['言', '吾'],
      etymology: null,
      jlptLevel: 'N4',
      frequency: 3,
    },
    // A reading match with no loaded meanings: must be excluded from
    // search results even though its kun reading exactly matches.
    {
      literal: '峠',
      onReadings: [],
      kunReadings: ['とうげ'],
      meanings: [],
      strokeCount: 9,
      radical: null,
      components: [],
      etymology: null,
      jlptLevel: null,
      frequency: null,
    },
    // Five kanji sharing one made-up reading, used to prove that a
    // flood of kanji matches cannot crowd a word match out entirely.
    ...['壱', '弐', '参', '肆', '伍'].map((literal, i) => ({
      literal,
      onReadings: ['ダミー'],
      kunReadings: [],
      meanings: [`dummy ${i}`],
      strokeCount: 1,
      radical: null,
      components: [],
      etymology: null,
      jlptLevel: null,
      frequency: 100 + i,
    })),
  ]);

  await db.insert(vocabularyItems).values([
    {
      entSeq: 1001,
      surface: '日本語',
      reading: 'にほんご',
      alternateSurfaces: [],
      alternateReadings: [],
      meanings: ['Japanese language'],
      partsOfSpeech: ['noun'],
      jlptLevel: 'N5',
      isCommon: true,
      audioUrl: null,
      searchKey: 'にほんご',
    },
    {
      entSeq: 1002,
      surface: '日本',
      reading: 'にほん',
      alternateSurfaces: [],
      alternateReadings: ['にっぽん'],
      meanings: ['Japan'],
      partsOfSpeech: ['noun'],
      jlptLevel: 'N5',
      isCommon: true,
      audioUrl: null,
      searchKey: 'にほん',
    },
    {
      entSeq: 1003,
      surface: '本',
      reading: 'ほん',
      alternateSurfaces: [],
      alternateReadings: [],
      meanings: ['book', 'origin'],
      partsOfSpeech: ['noun'],
      jlptLevel: 'N5',
      isCommon: true,
      audioUrl: null,
      searchKey: 'ほん',
    },
    {
      entSeq: 1004,
      surface: 'えだみー語',
      reading: 'えだみーご',
      alternateSurfaces: [],
      alternateReadings: [],
      meanings: ['filler'],
      partsOfSpeech: ['noun'],
      jlptLevel: null,
      isCommon: false,
      audioUrl: null,
      // Contains the crowd-out test's query ("だみー") as a substring,
      // but not at the start, so this is a weak (tier 3) match.
      searchKey: 'えだみーご',
    },
    {
      entSeq: 1005,
      surface: '日本製',
      reading: 'にほんせい',
      alternateSurfaces: [],
      alternateReadings: [],
      // Ends with " Japan": a word-boundary match for query "Japan",
      // but not an exact gloss, unlike w:1002's meaning "Japan".
      meanings: ['made in Japan'],
      partsOfSpeech: ['noun'],
      jlptLevel: 'N5',
      isCommon: false,
      audioUrl: null,
      searchKey: 'にほんせい',
    },
    // Two words with no pairwise relation to anything above, used only
    // to test the semantic synset hub and the "same partner via both a
    // hub and a pairwise link, under different relations" case.
    {
      entSeq: 2001,
      surface: 'アルファ',
      reading: 'あるふぁ',
      alternateSurfaces: [],
      alternateReadings: [],
      meanings: ['alpha'],
      partsOfSpeech: ['noun'],
      jlptLevel: null,
      isCommon: false,
      audioUrl: null,
      searchKey: 'あるふぁ',
    },
    {
      entSeq: 2002,
      surface: 'ベータ',
      reading: 'べーた',
      alternateSurfaces: [],
      alternateReadings: [],
      meanings: ['beta'],
      partsOfSpeech: ['noun'],
      jlptLevel: null,
      isCommon: false,
      audioUrl: null,
      searchKey: 'べーた',
    },
  ]);

  await db.insert(sentences).values([
    {
      tatoebaId: 5000,
      japanese: '日本語を勉強します。',
      english: 'I study Japanese.',
      furigana: [
        { base: '日本語', reading: 'にほんご' },
        { base: 'を勉強します。', reading: 'をべんきょうします。' },
      ],
      licence: 'CC-BY 2.0 (FR)',
    },
  ]);

  await db.insert(sentenceEntries).values([
    { sentenceId: 5000, entryId: 'w:1001' },
    { sentenceId: 5000, entryId: 'k:語' },
  ]);

  // Only PAIRWISE_RELATIONS live in `links` now (synonym and homophone
  // moved to hubs below): contains_kanji, see_also, and antonym here.
  await db.insert(links).values([
    // structural: w:1001 (日本語) is made of the three kanji, tied weight -> toEntryId asc
    { fromEntryId: 'w:1001', toEntryId: 'k:日', axis: 'structural', relation: 'contains_kanji', weight: 1, source: 'test' },
    { fromEntryId: 'w:1001', toEntryId: 'k:本', axis: 'structural', relation: 'contains_kanji', weight: 1, source: 'test' },
    { fromEntryId: 'w:1001', toEntryId: 'k:語', axis: 'structural', relation: 'contains_kanji', weight: 1, source: 'test' },
    // semantic: w:1001's only remaining pairwise relation
    { fromEntryId: 'w:1001', toEntryId: 'w:1003', axis: 'semantic', relation: 'see_also', weight: 0.4, source: 'test' },
    // k:日 has a single semantic link, used to check linkCounts differ per entry
    { fromEntryId: 'k:日', toEntryId: 'w:1002', axis: 'semantic', relation: 'see_also', weight: 0.5, source: 'test' },
    // w:2001 and w:2002 also share a hub-derived `synonym` relation
    // (below): this pairwise `antonym` row makes the same partner
    // (w:2002) reachable from w:2001 under two different relations on
    // the same axis, which must count and list twice, once per
    // relation - never deduped the way same-kind-hub overlap is.
    { fromEntryId: 'w:2001', toEntryId: 'w:2002', axis: 'semantic', relation: 'antonym', weight: 0.9, source: 'test' },
  ]);

  // Family relations, materialized as hubs + memberships instead of
  // pairwise rows (CLAUDE.md's "Two storage shapes").
  await db.insert(hubs).values([
    { hubId: 'h:radical:日', kind: 'radical', label: '日', memberCount: 4 },
    { hubId: 'h:on:ダミー', kind: 'on', label: 'ダミー', memberCount: 3 },
    // A second, distinct on-reading hub that 壱 also belongs to,
    // sharing a member (弐) with the first: proves that a partner
    // reachable through two hubs of the same kind counts once.
    { hubId: 'h:on:ダミー2', kind: 'on', label: 'ダミー2', memberCount: 2 },
    { hubId: 'h:synset:group1', kind: 'synset', label: 'alpha/beta', memberCount: 2 },
    // One real member (w:1003) and one dangling member (w:9999, never
    // loaded into vocabulary_items): proves a hub member with no entry
    // row does not inflate counts.
    { hubId: 'h:gloss:てすと', kind: 'gloss', label: 'てすと', memberCount: 3 },
  ]);

  await db.insert(hubMembers).values([
    // Radical hub: k:日's siblings are k:本, k:語, k:峠 (self excluded).
    // k:峠 has a null rank, used to test that null sorts last.
    { hubId: 'h:radical:日', entryId: 'k:日', rank: 0 },
    { hubId: 'h:radical:日', entryId: 'k:本', rank: 0 },
    { hubId: 'h:radical:日', entryId: 'k:語', rank: 1 },
    { hubId: 'h:radical:日', entryId: 'k:峠', rank: null },

    // On-reading hub #1: k:壱's siblings include 弐 (rank 1) and 参 (rank 2).
    { hubId: 'h:on:ダミー', entryId: 'k:壱', rank: 0 },
    { hubId: 'h:on:ダミー', entryId: 'k:弐', rank: 1 },
    { hubId: 'h:on:ダミー', entryId: 'k:参', rank: 2 },
    // On-reading hub #2: also relates 壱 and 弐, with a lower (better)
    // rank for 弐 than hub #1 gave it - the deduped result must keep
    // the lowest rank (0), not the first-seen one.
    { hubId: 'h:on:ダミー2', entryId: 'k:壱', rank: 0 },
    { hubId: 'h:on:ダミー2', entryId: 'k:弐', rank: 0 },

    // Synset hub: w:2001's only hub-derived sibling is w:2002.
    { hubId: 'h:synset:group1', entryId: 'w:2001', rank: 0 },
    { hubId: 'h:synset:group1', entryId: 'w:2002', rank: 1 },

    // Gloss hub: k:語's only real shared_sense sibling is w:1003; the
    // w:9999 membership is dangling and must not inflate the count.
    { hubId: 'h:gloss:てすと', entryId: 'k:語', rank: 0 },
    { hubId: 'h:gloss:てすと', entryId: 'w:9999', rank: 1 },
    { hubId: 'h:gloss:てすと', entryId: 'w:1003', rank: 2 },
  ]);

  // Code-point ordering fixture, isolated from everything above: a
  // radical hub whose unranked members tie on weight, so their order
  // comes down to entry ID alone. U+FA43 is a CJK compatibility
  // ideograph and U+20B9F an Extension B kanji (a surrogate pair):
  // UTF-16 code-unit order and code point order disagree on them, and
  // a locale collation such as en_US.utf8 sorts U+FA43 next to U+6691.
  const codePointKanji = ['旦', '暑', '\uFA43', '\u{20B9F}'];
  await db.insert(kanji).values(
    ['昌', ...codePointKanji].map((literal, i) => ({
      literal,
      onReadings: [],
      kunReadings: [],
      meanings: [`code point fixture ${i}`],
      strokeCount: 8,
      radical: null,
      components: [],
      etymology: null,
      jlptLevel: null,
      frequency: null,
    })),
  );
  await db
    .insert(hubs)
    .values([{ hubId: 'h:radical:code-point', kind: 'radical', label: '日', memberCount: 5 }]);
  await db
    .insert(hubMembers)
    .values([
      { hubId: 'h:radical:code-point', entryId: 'k:昌', rank: 0 },
      ...codePointKanji.map((literal) => ({
        hubId: 'h:radical:code-point',
        entryId: `k:${literal}`,
        rank: null,
      })),
    ]);

  app = await buildApp({ db });
});

afterAll(async () => {
  await app.close();
  await appDb.close();
});

describe('GET /api/entries/:entryId', () => {
  it('400s on a malformed entry ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/bad-id' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'INVALID_ENTRY_ID', message: expect.any(String) },
    });
  });

  it('400s on a wrong-prefix entry ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/x:foo' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ENTRY_ID');
  });

  it('404s on an unknown but well-formed entry ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/k:桜' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'ENTRY_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('returns a kanji entry that parses with entryResponseSchema, with correct link counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/k:日' });
    expect(res.statusCode).toBe(200);
    const body = entryResponseSchema.parse(res.json());
    expect(body.kind).toBe('kanji');
    if (body.kind !== 'kanji') throw new Error('unreachable');
    expect(body.kanji.literal).toBe('日');
    // structural: 3 hub-derived siblings (本, 語, 峠) via the radical hub.
    expect(body.linkCounts).toEqual({ semantic: 1, phonetic: 0, structural: 3 });
  });

  it('returns a word entry with sentences and link counts across axes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:1001' });
    expect(res.statusCode).toBe(200);
    const body = entryResponseSchema.parse(res.json());
    expect(body.kind).toBe('word');
    if (body.kind !== 'word') throw new Error('unreachable');
    expect(body.word.surface).toBe('日本語');
    // synonym and homophone are now hub-derived elsewhere in the
    // fixture; w:1001's only remaining semantic relation is see_also.
    expect(body.linkCounts).toEqual({ semantic: 1, phonetic: 0, structural: 3 });

    expect(body.sentences).toHaveLength(1);
    expect(body.sentences[0]?.tatoebaId).toBe(5000);
    expect(body.sentences[0]?.entryIds.sort()).toEqual(['k:語', 'w:1001']);
  });

  it('sets no-cache outside production', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:1001' });
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('agrees with the /links endpoint total when a hub member points to an unloaded target', async () => {
    const entryRes = await app.inject({ method: 'GET', url: '/api/entries/k:語' });
    const entryBody = entryResponseSchema.parse(entryRes.json());

    const linksRes = await app.inject({ method: 'GET', url: '/api/entries/k:語/links?axis=semantic' });
    const linksBody = linksResponseSchema.parse(linksRes.json());
    const semantic = linksBody.axes[0];

    // The gloss hub k:語 belongs to has three members: k:語 itself,
    // w:1003 (real), and w:9999 (never loaded into vocabulary_items).
    // Both endpoints must exclude the dangling member and agree on a
    // count of exactly 1.
    expect(entryBody.linkCounts.semantic).toBe(1);
    expect(semantic?.total).toBe(1);
    expect(entryBody.linkCounts.semantic).toBe(semantic?.total);
    expect(semantic?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId)).toEqual([
      'w:1003',
    ]);
  });

  it('does not let a partner reachable via two hubs of the same kind inflate the count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/k:壱' });
    const body = entryResponseSchema.parse(res.json());
    // k:壱 belongs to two "on" hubs, both of which include 弐, plus one
    // that also includes 参: deduped, that is 2 distinct siblings, not 3.
    expect(body.linkCounts).toEqual({ semantic: 0, phonetic: 2, structural: 0 });
  });

  it('counts the same partner twice when it is both a pairwise link and a hub sibling under a different relation', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:2001' });
    const body = entryResponseSchema.parse(res.json());
    // w:2002 is a synset-hub sibling (synonym) and a pairwise antonym
    // target: two distinct (relation, partner) facts, not deduped.
    expect(body.linkCounts).toEqual({ semantic: 2, phonetic: 0, structural: 0 });
  });
});

describe('GET /api/entries/:entryId/links', () => {
  it('groups links by axis then relation, ordered by weight desc / toEntryId asc for ties', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:1001/links?axis=structural' });
    expect(res.statusCode).toBe(200);
    const body = linksResponseSchema.parse(res.json());
    expect(body.axes).toHaveLength(1);
    const structural = body.axes[0];
    expect(structural?.axis).toBe('structural');
    expect(structural?.total).toBe(3);
    expect(structural?.relations).toHaveLength(1);
    expect(structural?.relations[0]?.relation).toBe('contains_kanji');
    expect(structural?.relations[0]?.entries.map((e) => e.entry.entryId)).toEqual([
      'k:日',
      'k:本',
      'k:語',
    ]);
  });

  it('orders semantic links by weight descending', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:1001/links?axis=semantic' });
    const body = linksResponseSchema.parse(res.json());
    const semantic = body.axes[0];
    const allEntries = semantic?.relations.flatMap((r) => r.entries) ?? [];
    expect(allEntries.map((e) => e.entry.entryId)).toEqual(['w:1003']);
  });

  it('returns the labels of every shared hub as `via`, and none for a pairwise link', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/k:壱/links?axis=phonetic' });
    const body = linksResponseSchema.parse(res.json());
    const onReading = body.axes[0]?.relations.find((r) => r.relation === 'shared_on_reading');
    // 弐 shares both on hubs with 壱; 参 only the first.
    expect(onReading?.entries.map((e) => [e.entry.entryId, e.via])).toEqual([
      ['k:弐', ['ダミー', 'ダミー2']],
      ['k:参', ['ダミー']],
    ]);

    const pairwise = await app.inject({ method: 'GET', url: '/api/entries/w:1001/links?axis=structural' });
    const pairwiseBody = linksResponseSchema.parse(pairwise.json());
    const pairwiseEntries = pairwiseBody.axes[0]?.relations.flatMap((r) => r.entries) ?? [];
    expect(pairwiseEntries.every((e) => e.via.length === 0)).toBe(true);
  });

  it('merges a hub-derived sibling with a pairwise link on the same axis, grouped under their own relations', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:2001/links?axis=semantic' });
    const body = linksResponseSchema.parse(res.json());
    const semantic = body.axes[0];
    expect(semantic?.total).toBe(2);

    const synonym = semantic?.relations.find((r) => r.relation === 'synonym');
    const antonym = semantic?.relations.find((r) => r.relation === 'antonym');
    expect(synonym?.entries.map((e) => e.entry.entryId)).toEqual(['w:2002']);
    expect(antonym?.entries.map((e) => e.entry.entryId)).toEqual(['w:2002']);
  });

  it('walks a hub-backed axis via limit=1, ordering by rank ascending with a null rank last, no repeats', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const qs = new URLSearchParams({ axis: 'structural', limit: '1' });
      if (cursor) qs.set('cursor', cursor);
      const res = await app.inject({ method: 'GET', url: `/api/entries/k:日/links?${qs}` });
      const body = linksResponseSchema.parse(res.json());
      const structural = body.axes[0];
      const page = structural?.relations.flatMap((r) => r.entries) ?? [];
      expect(page.length).toBeLessThanOrEqual(1);
      // The entry never appears among its own siblings.
      for (const e of page) expect(e.entry.entryId).not.toBe('k:日');
      for (const e of page) seen.push(e.entry.entryId);
      if (!structural?.nextCursor) break;
      cursor = structural.nextCursor;
    }
    // k:本 (rank 0) and k:語 (rank 1) sort before k:峠 (null rank last).
    expect(seen).toEqual(['k:本', 'k:語', 'k:峠']);
  });

  it.each([1, 2, 3, 4])(
    'walks weight-tied hub siblings in code point order at limit=%i, in full pages with no trailing empty page',
    async (limit) => {
      const pages: string[][] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const qs = new URLSearchParams({ axis: 'structural', limit: String(limit) });
        if (cursor) qs.set('cursor', cursor);
        const res = await app.inject({
          method: 'GET',
          url: `/api/entries/${encodeURIComponent('k:昌')}/links?${qs}`,
        });
        const body = linksResponseSchema.parse(res.json());
        const structural = body.axes[0];
        expect(structural?.total).toBe(4);
        pages.push(
          structural?.relations.flatMap((r) => r.entries.map((e) => e.entry.entryId)) ?? [],
        );
        if (!structural?.nextCursor) break;
        cursor = structural.nextCursor;
      }
      expect(pages.flat()).toEqual(['k:旦', 'k:暑', 'k:\uFA43', 'k:\u{20B9F}']);
      // Exactly ceil(total / limit) requests: every page but the last is full.
      expect(pages).toHaveLength(Math.ceil(4 / limit));
      for (const page of pages.slice(0, -1)) expect(page).toHaveLength(limit);
    },
  );

  it('filters hub siblings by JLPT level, with total counting only matches', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/entries/k:日/links?axis=structural&jlpt=N5,none',
    });
    expect(res.statusCode).toBe(200);
    const structural = linksResponseSchema.parse(res.json()).axes[0];
    expect(structural?.total).toBe(2);
    // k:本 is N5 and k:峠 has no level; k:語 (N4) is filtered out.
    expect(structural?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId)).toEqual([
      'k:本',
      'k:峠',
    ]);
    expect(structural?.nextCursor).toBeNull();

    // The entry endpoint's counts are never filtered.
    const entryRes = await app.inject({ method: 'GET', url: '/api/entries/k:日' });
    expect(entryResponseSchema.parse(entryRes.json()).linkCounts.structural).toBe(3);
  });

  it('filters pairwise links by JLPT level', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/entries/w:1001/links?axis=structural&jlpt=N4',
    });
    const structural = linksResponseSchema.parse(res.json()).axes[0];
    expect(structural?.total).toBe(1);
    expect(structural?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId)).toEqual([
      'k:語',
    ]);
  });

  it('walks a JLPT-filtered axis in full pages, skipping filtered entries without short pages', async () => {
    const pages: string[][] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const qs = new URLSearchParams({ axis: 'structural', limit: '1', jlpt: 'N5,N4' });
      if (cursor) qs.set('cursor', cursor);
      const res = await app.inject({ method: 'GET', url: `/api/entries/k:日/links?${qs}` });
      const structural = linksResponseSchema.parse(res.json()).axes[0];
      expect(structural?.total).toBe(2);
      pages.push(structural?.relations.flatMap((r) => r.entries.map((e) => e.entry.entryId)) ?? []);
      if (!structural?.nextCursor) break;
      cursor = structural.nextCursor;
    }
    expect(pages).toEqual([['k:本'], ['k:語']]);
  });

  it('400s an empty or unknown jlpt filter', async () => {
    for (const jlpt of ['', 'N6']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/entries/k:日/links?axis=structural&jlpt=${jlpt}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('dedupes a same-kind-hub partner and excludes the entry itself, and axis filtering only queries requested relations', async () => {
    const phoneticRes = await app.inject({ method: 'GET', url: '/api/entries/k:壱/links?axis=phonetic' });
    const phoneticBody = linksResponseSchema.parse(phoneticRes.json());
    const phonetic = phoneticBody.axes[0];
    expect(phonetic?.total).toBe(2);
    const entries = phonetic?.relations.flatMap((r) => r.entries) ?? [];
    expect(entries.map((e) => e.entry.entryId)).toEqual(['k:弐', 'k:参']);
    expect(entries.map((e) => e.entry.entryId)).not.toContain('k:壱');

    // k:壱 has no structural hub or pairwise data at all: requesting a
    // different axis must not leak its phonetic siblings in.
    const structuralRes = await app.inject({ method: 'GET', url: '/api/entries/k:壱/links?axis=structural' });
    const structuralBody = linksResponseSchema.parse(structuralRes.json());
    const structural = structuralBody.axes[0];
    expect(structural?.total).toBe(0);
    expect(structural?.relations).toEqual([]);
  });

  it('walks every link on an axis via limit=1 pagination without skipping or repeating', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const qs = new URLSearchParams({ axis: 'structural', limit: '1' });
      if (cursor) qs.set('cursor', cursor);
      const res = await app.inject({ method: 'GET', url: `/api/entries/w:1001/links?${qs}` });
      const body = linksResponseSchema.parse(res.json());
      const structural = body.axes[0];
      const page = structural?.relations.flatMap((r) => r.entries) ?? [];
      expect(page.length).toBeLessThanOrEqual(1);
      for (const e of page) seen.push(e.entry.entryId);
      if (!structural?.nextCursor) break;
      cursor = structural.nextCursor;
    }
    expect(seen).toEqual(['k:日', 'k:本', 'k:語']);
  });

  it('sets no-cache outside production', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:1001/links' });
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('404s on links for an unknown entry', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:9999/links' });
    expect(res.statusCode).toBe(404);
  });

  it('400s a cursor supplied alongside more than one axis', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/entries/w:1001/links?axis=semantic,phonetic&cursor=abc',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('validates the query before the existence check, so a bad query on an unknown entry is a 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/entries/w:9999/links?axis=semantic,phonetic&cursor=abc',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('400s a garbage cursor instead of silently returning page 1', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/entries/w:1001/links?axis=structural&cursor=not-a-real-cursor',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_CURSOR');
  });
});

describe('GET /api/entries/search', () => {
  it('matches kanji by reading and words by prefix, prefix before substring', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=ほん' });
    expect(res.statusCode).toBe(200);
    const body = searchResponseSchema.parse(res.json());
    const ids = body.results.map((r) => r.entryId);

    // k:本 (on-reading ホン folds to ほん) and w:1003 (search_key exactly "ほん",
    // a prefix match) must both be present, before the substring-only matches.
    expect(ids).toContain('k:本');
    expect(ids).toContain('w:1003');
    expect(ids).toContain('w:1002');
    expect(ids).toContain('w:1001');

    const prefixIndex = ids.indexOf('w:1003');
    const substringIndex = ids.indexOf('w:1002');
    expect(prefixIndex).toBeLessThan(substringIndex);
  });

  it('folds a katakana query for kana matching', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=ホン' });
    const body = searchResponseSchema.parse(res.json());
    expect(body.results.map((r) => r.entryId)).toContain('k:本');
  });

  it('matches kanji meanings', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=language' });
    const body = searchResponseSchema.parse(res.json());
    expect(body.results.map((r) => r.entryId)).toContain('k:語');
  });

  it('treats "search" as the search route, not an entry ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=本' });
    expect(res.statusCode).toBe(200);
  });

  it('sets no-cache outside production', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=本' });
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('400s a whitespace-only query instead of dumping unfiltered results', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/entries/search?q=${encodeURIComponent('   ')}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it('finds a word by its kanji surface form, not just its search_key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=日本' });
    const body = searchResponseSchema.parse(res.json());
    expect(body.results.map((r) => r.entryId)).toContain('w:1002');
  });

  it('finds a word by meaning and ranks an exact gloss above a word-boundary match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=Japan' });
    const body = searchResponseSchema.parse(res.json());
    const ids = body.results.map((r) => r.entryId);

    // w:1002's gloss is exactly "Japan"; w:1005's gloss "made in Japan"
    // only contains it at a word boundary. Neither is a bare substring
    // match: w:1001's gloss "Japanese language" must NOT match at all,
    // since "Japan" is not a whole word there.
    expect(ids).toContain('w:1002');
    expect(ids).toContain('w:1005');
    expect(ids).not.toContain('w:1001');
    expect(ids.indexOf('w:1002')).toBeLessThan(ids.indexOf('w:1005'));
  });

  it('matches a word search_key via a katakana query (kana folding)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=ホン' });
    const body = searchResponseSchema.parse(res.json());
    expect(body.results.map((r) => r.entryId)).toContain('w:1003');
  });

  it('excludes a kanji with no loaded meanings even when its reading matches exactly', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=とうげ' });
    const body = searchResponseSchema.parse(res.json());
    expect(body.results.map((r) => r.entryId)).not.toContain('k:峠');
  });

  it('returns both kinds under a small limit even when one kind has many more matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=だみー&limit=4' });
    const body = searchResponseSchema.parse(res.json());
    expect(body.results).toHaveLength(4);
    const kinds = new Set(body.results.map((r) => r.kind));
    expect(kinds.has('kanji')).toBe(true);
    expect(kinds.has('word')).toBe(true);
  });
});

describe('Cache-Control in production', () => {
  let prodApp: FastifyInstance;

  beforeAll(async () => {
    prodApp = await buildApp({ db: appDb.db, production: true });
  });

  afterAll(async () => {
    await prodApp.close();
  });

  it.each([
    '/api/entries/w:1001',
    '/api/entries/w:1001/links',
    `/api/entries/search?q=${encodeURIComponent('本')}`,
  ])('sets a long-lived Cache-Control header on %s', async (url) => {
    const res = await prodApp.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('sets no Cache-Control header on an error response', async () => {
    const res = await prodApp.inject({ method: 'GET', url: '/api/entries/k:%E7%84%A1' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBeUndefined();
  });
});

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('unknown routes', () => {
  it('returns the standard error shape for a 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});

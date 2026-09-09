import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryResponseSchema, linksResponseSchema, searchResponseSchema } from '@japanesesite/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb, runMigrations, type AppDatabase } from '../db/client.js';
import { kanji, links, sentenceEntries, sentences, vocabularyItems } from '../db/schema.js';

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

  await db.insert(links).values([
    // structural: w:1001 (日本語) is made of the three kanji, tied weight -> toEntryId asc
    { fromEntryId: 'w:1001', toEntryId: 'k:日', axis: 'structural', relation: 'contains_kanji', weight: 1, source: 'test' },
    { fromEntryId: 'w:1001', toEntryId: 'k:本', axis: 'structural', relation: 'contains_kanji', weight: 1, source: 'test' },
    { fromEntryId: 'w:1001', toEntryId: 'k:語', axis: 'structural', relation: 'contains_kanji', weight: 1, source: 'test' },
    // semantic: w:1001 relates to w:1002 and w:1003
    { fromEntryId: 'w:1001', toEntryId: 'w:1002', axis: 'semantic', relation: 'synonym', weight: 0.8, source: 'test' },
    { fromEntryId: 'w:1001', toEntryId: 'w:1003', axis: 'semantic', relation: 'see_also', weight: 0.4, source: 'test' },
    // phonetic: w:1001 has one phonetic link with a null weight
    { fromEntryId: 'w:1001', toEntryId: 'w:1003', axis: 'phonetic', relation: 'homophone', weight: null, source: 'test' },
    // k:日 has a single semantic link, used to check linkCounts differ per entry
    { fromEntryId: 'k:日', toEntryId: 'w:1002', axis: 'semantic', relation: 'see_also', weight: 0.5, source: 'test' },
    // k:語 has one real phonetic link and one to a target that was
    // never loaded into vocabulary_items (a dangling reference): both
    // the entry page's linkCounts and the /links endpoint's total must
    // agree that this axis has exactly one (real) link.
    { fromEntryId: 'k:語', toEntryId: 'w:1003', axis: 'phonetic', relation: 'homophone', weight: 0.6, source: 'test' },
    { fromEntryId: 'k:語', toEntryId: 'w:8888', axis: 'phonetic', relation: 'homophone', weight: 0.9, source: 'test' },
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
    expect(body.linkCounts).toEqual({ semantic: 1, phonetic: 0, structural: 0 });
  });

  it('returns a word entry with sentences and link counts across axes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:1001' });
    expect(res.statusCode).toBe(200);
    const body = entryResponseSchema.parse(res.json());
    expect(body.kind).toBe('word');
    if (body.kind !== 'word') throw new Error('unreachable');
    expect(body.word.surface).toBe('日本語');
    expect(body.linkCounts).toEqual({ semantic: 2, phonetic: 1, structural: 3 });

    expect(body.sentences).toHaveLength(1);
    expect(body.sentences[0]?.tatoebaId).toBe(5000);
    expect(body.sentences[0]?.entryIds.sort()).toEqual(['k:語', 'w:1001']);
  });

  it('sets a long-lived Cache-Control header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:1001' });
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('agrees with the /links endpoint total when a link points to an unloaded target', async () => {
    const entryRes = await app.inject({ method: 'GET', url: '/api/entries/k:語' });
    const entryBody = entryResponseSchema.parse(entryRes.json());

    const linksRes = await app.inject({ method: 'GET', url: '/api/entries/k:語/links?axis=phonetic' });
    const linksBody = linksResponseSchema.parse(linksRes.json());
    const phonetic = linksBody.axes[0];

    // Two phonetic rows exist in the fixture, but one targets an entry
    // that was never loaded (w:8888): both endpoints must exclude it
    // and agree on a count of exactly 1.
    expect(entryBody.linkCounts.phonetic).toBe(1);
    expect(phonetic?.total).toBe(1);
    expect(entryBody.linkCounts.phonetic).toBe(phonetic?.total);
    expect(phonetic?.relations.flatMap((r) => r.entries).map((e) => e.entry.entryId)).toEqual([
      'w:1003',
    ]);
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
    expect(allEntries.map((e) => e.entry.entryId)).toEqual(['w:1002', 'w:1003']);
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

  it('sets a long-lived Cache-Control header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/w:1001/links' });
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
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

  it('sets a long-lived Cache-Control header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/entries/search?q=本' });
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
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

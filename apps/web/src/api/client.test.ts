import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, getEntry, getLinks, searchEntries } from './client.js';

function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }): Response {
  const status = init?.status ?? 200;
  return {
    ok: init?.ok ?? (status >= 200 && status < 300),
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const validKanjiEntry = {
  kind: 'kanji',
  entryId: 'k:日',
  kanji: {
    literal: '日',
    onReadings: ['ニチ'],
    kunReadings: ['ひ'],
    meanings: ['day', 'sun'],
    strokeCount: 4,
    radical: '日',
    components: [],
    etymology: null,
    jlptLevel: 'N5',
    frequency: 1,
  },
  sentences: [],
  linkCounts: { semantic: 1, phonetic: 2, structural: 3 },
};

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates a good response against the shared schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(validKanjiEntry)),
    );

    const entry = await getEntry('k:日');
    expect(entry.kind).toBe('kanji');
    if (entry.kind === 'kanji') {
      expect(entry.kanji.literal).toBe('日');
    }
  });

  it('sends the jlpt filter as a comma-separated parameter, and omits it when unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ entryId: 'k:日', axes: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await getLinks('k:日', { axis: ['structural'], jlpt: ['N5', 'none'] });
    await getLinks('k:日', { axis: ['structural'] });

    const [filtered, unfiltered] = fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://x'));
    expect(filtered?.searchParams.get('jlpt')).toBe('N5,none');
    expect(unfiltered?.searchParams.has('jlpt')).toBe(false);
  });

  it('turns a non-ok response into an ApiClientError carrying the body code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { code: 'not_found', message: 'No such entry' } },
          { status: 404, ok: false },
        ),
      ),
    );

    await expect(getEntry('k:x')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'No such entry',
    });
  });

  it('is an instance of ApiClientError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: 'bad_request', message: 'nope' } }, { status: 400, ok: false }),
      ),
    );

    try {
      await searchEntries('日');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
    }
  });
});

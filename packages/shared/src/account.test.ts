import { describe, expect, it } from 'vitest';
import { knownCollectionsSchema, registerRequestSchema } from './account.js';

describe('account schemas', () => {
  it('accepts collections of kanji and word entry IDs', () => {
    const r = knownCollectionsSchema.safeParse({ kanji: ['k:日'], vocab: ['w:1358280'] });
    expect(r.success).toBe(true);
  });

  it('rejects a word ID in the kanji collection and a kanji ID in the vocab collection', () => {
    expect(knownCollectionsSchema.safeParse({ kanji: ['w:1'], vocab: [] }).success).toBe(false);
    expect(knownCollectionsSchema.safeParse({ kanji: [], vocab: ['k:日'] }).success).toBe(false);
  });

  it('rejects a username with characters outside the allowed set', () => {
    const r = registerRequestSchema.safeParse({
      username: 'a b',
      password: 'longenough',
      eraDate: '令和8年11月19日',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    const r = registerRequestSchema.safeParse({
      username: 'aki',
      password: 'short',
      eraDate: '令和8年11月19日',
    });
    expect(r.success).toBe(false);
  });
});

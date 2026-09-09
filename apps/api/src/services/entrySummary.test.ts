import { describe, expect, it } from 'vitest';
import { kanjiRowToSummary, wordRowToSummary } from './entrySummary.js';

describe('kanjiRowToSummary', () => {
  it('prefers the on reading (the conventional citation form) when present', () => {
    const summary = kanjiRowToSummary({
      literal: '本',
      onReadings: ['ホン'],
      kunReadings: ['もと'],
      meanings: ['book', 'origin'],
      jlptLevel: 'N5',
    });
    expect(summary.reading).toBe('ホン');
  });

  it('falls back to the kun reading when there is no on reading', () => {
    const summary = kanjiRowToSummary({
      literal: '峠',
      onReadings: [],
      kunReadings: ['とうげ'],
      meanings: ['mountain pass'],
      jlptLevel: null,
    });
    expect(summary.reading).toBe('とうげ');
  });

  it('falls back to an empty string when there are no readings at all', () => {
    const summary = kanjiRowToSummary({
      literal: '〆',
      onReadings: [],
      kunReadings: [],
      meanings: [],
      jlptLevel: null,
    });
    expect(summary.reading).toBe('');
  });
});

describe('wordRowToSummary', () => {
  it('uses the stored reading as-is', () => {
    const summary = wordRowToSummary({
      entSeq: 1,
      surface: '日本',
      reading: 'にほん',
      meanings: ['Japan'],
      jlptLevel: 'N5',
    });
    expect(summary.reading).toBe('にほん');
    expect(summary.kind).toBe('word');
  });
});

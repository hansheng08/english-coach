import { describe, expect, it } from 'vitest';
import { DiagnosisSchema, SeniorSentenceSchema, UpgradeChunkSchema, WordSpanSchema } from './evening.ts';

const chunk = (n: number): Record<string, unknown> => ({
  chunk: `drive adoption ${String(n)}`.replace(/\d/g, 'x'),
  meaning_zh: '推動採用',
  example_en: 'Rising costs drive adoption of chiplets.',
  senior_index: 0,
});

describe('evening contracts (ARCHITECTURE §4.16.1)', () => {
  it('(AC-T25-17) WordSpanSchema needs end > start', () => {
    expect(WordSpanSchema.safeParse({ start: 0, end: 1 }).success).toBe(true);
    expect(WordSpanSchema.safeParse({ start: 2, end: 2 }).success).toBe(false);
  });

  it('(AC-T25-17) SeniorSentenceSchema: non-empty text, nullable source', () => {
    expect(SeniorSentenceSchema.safeParse({ text: 'Hello there.', source: null }).success).toBe(true);
    expect(SeniorSentenceSchema.safeParse({ text: '', source: null }).success).toBe(false);
  });

  it('(AC-T25-17) UpgradeChunkSchema rejects a chunk with a slash', () => {
    expect(UpgradeChunkSchema.safeParse(chunk(1)).success).toBe(true);
    expect(UpgradeChunkSchema.safeParse({ ...chunk(1), chunk: 'and/or' }).success).toBe(false);
  });

  it('(AC-T25-17) DiagnosisSchema needs 3 to 5 upgrade chunks', () => {
    const base = {
      marks: [],
      senior: [{ text: 'A sentence.', source: null }],
      stats: { pause_count: 0, filler_count: 0, wpm: 100 },
    };
    expect(DiagnosisSchema.safeParse({ ...base, upgrade_chunks: [chunk(1), chunk(2), chunk(3)] }).success).toBe(true);
    expect(DiagnosisSchema.safeParse({ ...base, upgrade_chunks: [chunk(1), chunk(2)] }).success).toBe(false);
  });
});

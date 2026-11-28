import { describe, expect, it } from 'vitest';
import { CardSchema, CardScheduleSchema, ChunkTextSchema, IntervalStepSchema, ReviewRequestSchema } from './card.ts';

describe('ChunkTextSchema', () => {
  it('(AC-T13-1) (TC-1) accepts valid chunk formats', () => {
    for (const v of ['get buy-in from sb', 'take ownership of', "one's call", 'leverage']) {
      expect(ChunkTextSchema.safeParse(v).success).toBe(true);
    }
  });

  it('(AC-T13-1) (TC-2) rejects forbidden characters', () => {
    for (const v of ['take (the) lead', 'and/or', 'wait…', '2 cents', 'one’s call']) {
      expect(ChunkTextSchema.safeParse(v).success).toBe(false);
    }
  });

  it('(AC-T13-1) (TC-3) rejects bad whitespace and empty words', () => {
    for (const v of [' leading space', 'trailing ', 'double  space', 'tab\there', '-', '']) {
      expect(ChunkTextSchema.safeParse(v).success).toBe(false);
    }
  });

  it('(AC-T13-2) (TC-4) accepts chunks that satisfy the C2 format', () => {
    const c2 = /^[A-Za-z]+(?:['-][A-Za-z]+)*(?: [A-Za-z]+(?:['-][A-Za-z]+)*)*$/;
    for (const v of ['get buy-in', "one's call", 'take ownership of the roadmap']) {
      const n = v.split(' ').length;
      expect(c2.test(v) && n >= 2 && n <= 6).toBe(true);
      expect(ChunkTextSchema.safeParse(v).success).toBe(true);
    }
  });
});

const CARD_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('CardScheduleSchema', () => {
  it('(AC-T9-1) (TC-1) accepts valid schedules of all four states', () => {
    const valid = [
      { state: 'collected', correctCount: 0, intervalStep: 0, dueDate: null },
      { state: 'collected', correctCount: 0, intervalStep: 0, dueDate: '2026-11-25' },
      { state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-26' },
      { state: 'reviewing', correctCount: 2, intervalStep: 1, dueDate: '2026-11-28' },
      { state: 'reviewing', correctCount: 5, intervalStep: 4, dueDate: '2026-12-10' },
      { state: 'mastered', correctCount: 4, intervalStep: 3, dueDate: null },
    ];
    for (const v of valid) {
      expect(CardScheduleSchema.safeParse(v).success).toBe(true);
    }
  });

  it('(AC-T9-1) (TC-2) rejects the four invalid combinations', () => {
    const invalid = [
      { state: 'collected', correctCount: 1, intervalStep: 0, dueDate: null },
      { state: 'learning', correctCount: 1, intervalStep: 1, dueDate: '2026-11-26' },
      { state: 'reviewing', correctCount: 2, intervalStep: 1, dueDate: null },
      { state: 'mastered', correctCount: 2, intervalStep: 1, dueDate: '2026-11-26' },
    ];
    for (const v of invalid) {
      expect(CardScheduleSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe('CardSchema', () => {
  const base = {
    id: CARD_ID,
    chunk: 'move the needle',
    meaningZh: null,
    exampleEn: null,
    synonyms: [],
    sourceSentence: null,
    sourceType: 'manual',
    schedule: { state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-28' },
    priorityNew: false,
    ttsPath: null,
    generatedBy: null,
    createdAt: '2026-11-27T00:00:00+08:00',
    masteredAt: null,
  };

  it('(AC-T32-7) (TC-11) accepts a valid card and rejects missing fields, bad schedules and a createdAt without a zone', () => {
    expect(CardSchema.safeParse(base).success).toBe(true);
    expect(CardSchema.safeParse({ ...base, chunk: undefined }).success).toBe(false);
    const mastered = { ...base, schedule: { state: 'mastered', correctCount: 2, intervalStep: 1, dueDate: '2026-11-28' } };
    expect(CardSchema.safeParse(mastered).success).toBe(false);
    expect(CardSchema.safeParse({ ...base, createdAt: '2026-11-27T00:00:00' }).success).toBe(false);
  });
});

describe('ReviewRequestSchema and IntervalStepSchema', () => {
  it('(AC-T9-1) (TC-3) rejects unknown rating, unknown mode and step 5; accepts a valid request', () => {
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, mode: 'A', rating: 'fast' }).success).toBe(true);
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, mode: 'A', rating: 'easy' }).success).toBe(false);
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, mode: 'C', rating: 'fast' }).success).toBe(false);
    expect(IntervalStepSchema.safeParse(5).success).toBe(false);
    expect(IntervalStepSchema.safeParse(4).success).toBe(true);
  });
});

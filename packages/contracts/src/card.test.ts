import { describe, expect, it } from 'vitest';
import { CardScheduleSchema, IntervalStepSchema, ReviewRequestSchema } from './card.ts';

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

describe('ReviewRequestSchema and IntervalStepSchema', () => {
  it('(AC-T9-1) (TC-3) rejects unknown rating, unknown mode and step 5; accepts a valid request', () => {
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, mode: 'A', rating: 'fast' }).success).toBe(true);
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, mode: 'A', rating: 'easy' }).success).toBe(false);
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, mode: 'C', rating: 'fast' }).success).toBe(false);
    expect(IntervalStepSchema.safeParse(5).success).toBe(false);
    expect(IntervalStepSchema.safeParse(4).success).toBe(true);
  });
});

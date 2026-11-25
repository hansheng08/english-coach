// QA probes for T-009 (schema boundaries). Written by QA; not part of the ticket's TC list.
import { describe, expect, it } from 'vitest';
import {
  CARD_SOURCE_TYPES,
  CARD_STATES,
  CardScheduleSchema,
  CardSourceTypeSchema,
  IntervalStepSchema,
  REVIEW_MODES,
  REVIEW_RATINGS,
  ReviewRequestSchema,
} from './card.ts';
import * as contractsIndex from './index.ts';

const CARD_ID = '123e4567-e89b-42d3-a456-426614174000';
const ok = (v: unknown): boolean => CardScheduleSchema.safeParse(v).success;

describe('QA: CardScheduleSchema boundaries', () => {
  it('(QA-1) correctCount minimums per state: learning >= 1, reviewing/mastered >= 2', () => {
    expect(ok({ state: 'learning', correctCount: 0, intervalStep: 0, dueDate: '2026-11-26' })).toBe(false);
    expect(ok({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-26' })).toBe(true);
    expect(ok({ state: 'reviewing', correctCount: 1, intervalStep: 1, dueDate: '2026-11-26' })).toBe(false);
    expect(ok({ state: 'reviewing', correctCount: 2, intervalStep: 1, dueDate: '2026-11-26' })).toBe(true);
    expect(ok({ state: 'mastered', correctCount: 1, intervalStep: 1, dueDate: null })).toBe(false);
    expect(ok({ state: 'mastered', correctCount: 2, intervalStep: 1, dueDate: null })).toBe(true);
  });

  it('(QA-2) correctCount must be an integer', () => {
    expect(ok({ state: 'learning', correctCount: 1.5, intervalStep: 0, dueDate: '2026-11-26' })).toBe(false);
    expect(ok({ state: 'reviewing', correctCount: 2.5, intervalStep: 1, dueDate: '2026-11-26' })).toBe(false);
    expect(ok({ state: 'mastered', correctCount: 3.5, intervalStep: 1, dueDate: null })).toBe(false);
  });

  it('(QA-3) intervalStep per state: collected/learning only 0, reviewing/mastered only 1..4', () => {
    expect(ok({ state: 'collected', correctCount: 0, intervalStep: 1, dueDate: null })).toBe(false);
    expect(ok({ state: 'reviewing', correctCount: 2, intervalStep: 0, dueDate: '2026-11-26' })).toBe(false);
    expect(ok({ state: 'reviewing', correctCount: 2, intervalStep: 5, dueDate: '2026-11-26' })).toBe(false);
    expect(ok({ state: 'mastered', correctCount: 2, intervalStep: 0, dueDate: null })).toBe(false);
    expect(ok({ state: 'mastered', correctCount: 2, intervalStep: 4, dueDate: null })).toBe(true);
    for (const step of [1, 2, 3, 4]) {
      expect(ok({ state: 'reviewing', correctCount: 2, intervalStep: step, dueDate: '2026-11-26' })).toBe(true);
    }
  });

  it('(QA-4) dueDate: learning needs a date; invalid date strings and unknown state are rejected', () => {
    expect(ok({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: null })).toBe(false);
    expect(ok({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: '2026-02-30' })).toBe(false);
    expect(ok({ state: 'reviewing', correctCount: 2, intervalStep: 1, dueDate: '2026/11/26' })).toBe(false);
    expect(ok({ state: 'archived', correctCount: 0, intervalStep: 0, dueDate: null })).toBe(false);
    expect(ok({ state: 'collected', correctCount: 0, intervalStep: 0 })).toBe(false);
  });
});

describe('QA: enums and request', () => {
  it('(QA-5) enum values match ARCHITECTURE §4.3 exactly', () => {
    expect(CARD_STATES).toEqual(['collected', 'learning', 'reviewing', 'mastered']);
    expect(REVIEW_RATINGS).toEqual(['fast', 'hesitant', 'forgot']);
    expect(REVIEW_MODES).toEqual(['A', 'B']);
    expect(CARD_SOURCE_TYPES).toEqual(['news', 'manual', 'evening', 'seed', 'shadowing']);
    expect(CardSourceTypeSchema.safeParse('rss').success).toBe(false);
    expect(IntervalStepSchema.safeParse(0).success).toBe(true);
    expect(IntervalStepSchema.safeParse(-1).success).toBe(false);
    expect(IntervalStepSchema.safeParse('1').success).toBe(false);
  });

  it('(QA-6) ReviewRequestSchema requires a valid cardId and all three fields', () => {
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, mode: 'B', rating: 'forgot' }).success).toBe(true);
    expect(ReviewRequestSchema.safeParse({ cardId: 'not-a-uuid', mode: 'A', rating: 'fast' }).success).toBe(false);
    expect(ReviewRequestSchema.safeParse({ mode: 'A', rating: 'fast' }).success).toBe(false);
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, rating: 'fast' }).success).toBe(false);
    expect(ReviewRequestSchema.safeParse({ cardId: CARD_ID, mode: 'a', rating: 'fast' }).success).toBe(false);
  });
});

describe('QA: package index', () => {
  it('(QA-18) contracts index re-exports every card.ts value', () => {
    for (const name of [
      'CARD_STATES',
      'CardStateSchema',
      'REVIEW_RATINGS',
      'ReviewRatingSchema',
      'REVIEW_MODES',
      'ReviewModeSchema',
      'CARD_SOURCE_TYPES',
      'CardSourceTypeSchema',
      'IntervalStepSchema',
      'CardScheduleSchema',
      'ReviewRequestSchema',
    ]) {
      expect(contractsIndex).toHaveProperty(name);
    }
    expect(contractsIndex.CardScheduleSchema).toBe(CardScheduleSchema);
  });
});

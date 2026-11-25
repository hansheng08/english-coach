import { describe, expect, it } from 'vitest';
import * as contracts from '@english-coach/contracts';
import { CardScheduleSchema, PlanDateSchema, SrsSettingsSchema } from '@english-coach/contracts';
import type { CardSchedule, PlanDate, ReviewRating, SrsSettings } from '@english-coach/contracts';
import * as domain from './index.ts';
import { applyReview, markMastered } from './card-state.ts';
import type { ReviewOutcome } from './card-state.ts';
import { addDays } from './taipei-date.ts';

const TODAY = PlanDateSchema.parse('2026-11-25');
const SRS = SrsSettingsSchema.parse({});
const CUSTOM_SRS = SrsSettingsSchema.parse({ step_days: [2, 5, 11], after_last_days: 20, forgot_days: 2 });

function card(value: unknown): CardSchedule {
  return CardScheduleSchema.parse(value);
}

function due(days: number): PlanDate {
  const r = addDays(TODAY, days);
  if (!r.ok) throw new Error('addDays failed in test');
  return r.value;
}

function run(c: CardSchedule, rating: ReviewRating, srs: SrsSettings = SRS, today: PlanDate = TODAY): ReviewOutcome {
  const r = applyReview(c, rating, today, srs);
  if (!r.ok) throw new Error(`applyReview failed: ${r.error.message}`);
  expect(r.value.before).toBe(c.state);
  expect(r.value.schedule.correctCount).toBeGreaterThanOrEqual(c.correctCount);
  expect(CardScheduleSchema.safeParse(r.value.schedule).success).toBe(true);
  return r.value;
}

const collected = card({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: null });
const learning = card({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-24' });
const reviewingAt = (step: 1 | 2 | 3 | 4): CardSchedule =>
  card({ state: 'reviewing', correctCount: 3, intervalStep: step, dueDate: '2026-11-24' });
const mastered = card({ state: 'mastered', correctCount: 4, intervalStep: 3, dueDate: null });

describe('applyReview transition table', () => {
  it('(AC-T9-2) (TC-4) (TC-12) collected + fast/hesitant -> learning', () => {
    for (const rating of ['fast', 'hesitant'] as const) {
      const o = run(collected, rating);
      expect(o.schedule).toEqual({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: due(SRS.forgot_days) });
      expect(o.intervalDaysApplied).toBe(SRS.forgot_days);
      expect(o.before).toBe('collected');
    }
  });

  it('(AC-T9-2) (TC-5) (TC-12) collected + forgot stays collected with a due date', () => {
    const o = run(collected, 'forgot');
    expect(o.schedule).toEqual({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: due(SRS.forgot_days) });
    expect(o.intervalDaysApplied).toBe(SRS.forgot_days);
  });

  it('(AC-T9-2) (TC-6) (TC-12) learning + fast/hesitant -> reviewing step 1', () => {
    for (const rating of ['fast', 'hesitant'] as const) {
      const o = run(learning, rating);
      expect(o.schedule).toEqual({ state: 'reviewing', correctCount: 2, intervalStep: 1, dueDate: due(SRS.step_days[0]) });
      expect(o.intervalDaysApplied).toBe(SRS.step_days[0]);
      expect(o.before).toBe('learning');
    }
  });

  it('(AC-T9-2) (TC-7) (TC-12) learning + forgot stays learning', () => {
    const o = run(learning, 'forgot');
    expect(o.schedule).toEqual({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: due(SRS.forgot_days) });
    expect(o.intervalDaysApplied).toBe(SRS.forgot_days);
  });

  it('(AC-T9-2) (TC-8) (TC-12) reviewing + fast advances steps 1,2,3,4,4', () => {
    const expected = [
      { from: 1, to: 2, days: SRS.step_days[1] },
      { from: 2, to: 3, days: SRS.step_days[2] },
      { from: 3, to: 4, days: SRS.after_last_days },
      { from: 4, to: 4, days: SRS.after_last_days },
    ] as const;
    // step 1 -> 2 uses step_days[1]; step 2 -> 3 uses step_days[2]; step 3 -> 4 and 4 -> 4 use after_last_days
    for (const e of expected) {
      const o = run(reviewingAt(e.from), 'fast');
      expect(o.schedule).toEqual({ state: 'reviewing', correctCount: 4, intervalStep: e.to, dueDate: due(e.days) });
      expect(o.intervalDaysApplied).toBe(e.days);
      expect(o.before).toBe('reviewing');
    }
  });

  it('(AC-T9-2) (TC-9) (TC-12) reviewing + hesitant stays on the same step', () => {
    const o = run(reviewingAt(2), 'hesitant');
    expect(o.schedule).toEqual({ state: 'reviewing', correctCount: 4, intervalStep: 2, dueDate: due(SRS.step_days[1]) });
    expect(o.intervalDaysApplied).toBe(SRS.step_days[1]);
  });

  it('(AC-T9-2) (TC-10) (TC-12) reviewing + forgot -> learning, then fast -> reviewing step 1', () => {
    const forgot = run(reviewingAt(3), 'forgot');
    expect(forgot.schedule).toEqual({ state: 'learning', correctCount: 3, intervalStep: 0, dueDate: due(SRS.forgot_days) });
    const again = run(forgot.schedule, 'fast');
    expect(again.schedule.state).toBe('reviewing');
    expect(again.schedule.intervalStep).toBe(1);
    expect(again.schedule.correctCount).toBe(4);
  });

  it('(AC-T9-2) (TC-11) mastered returns a validation error with path state for every rating', () => {
    for (const rating of ['fast', 'hesitant', 'forgot'] as const) {
      const r = applyReview(mastered, rating, TODAY, SRS);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('validation');
        expect(r.error.issues.some((i) => i.path === 'state')).toBe(true);
      }
    }
  });
});

describe('applyReview settings and dates', () => {
  it('(AC-T9-3) (TC-13) days and due date follow the given settings', () => {
    const c = reviewingAt(1);
    const a = run(c, 'fast', SRS);
    const b = run(c, 'fast', CUSTOM_SRS);
    expect(a.intervalDaysApplied).toBe(SRS.step_days[1]);
    expect(b.intervalDaysApplied).toBe(5);
    expect(a.schedule.dueDate).toBe(due(SRS.step_days[1]));
    expect(b.schedule.dueDate).toBe(due(5));
    expect(a.schedule.dueDate).not.toBe(b.schedule.dueDate);
    expect(run(collected, 'forgot', CUSTOM_SRS).intervalDaysApplied).toBe(2);
  });

  it('(AC-T9-3) (TC-14) date overflow returns err without throwing', () => {
    const end = PlanDateSchema.parse('9999-12-31');
    const cases: [CardSchedule, ReviewRating][] = [
      [collected, 'fast'],
      [collected, 'forgot'],
      [learning, 'fast'],
      [learning, 'forgot'],
      [reviewingAt(2), 'fast'],
      [reviewingAt(2), 'hesitant'],
      [reviewingAt(2), 'forgot'],
    ];
    for (const [c, rating] of cases) {
      const r = applyReview(c, rating, end, SRS);
      expect(r.ok).toBe(false);
    }
  });
});

describe('markMastered', () => {
  it('(AC-T9-4) (TC-15) (TC-17) reviewing -> mastered keeps step and count, clears due date', () => {
    const c = card({ state: 'reviewing', correctCount: 6, intervalStep: 3, dueDate: '2026-11-30' });
    const r = markMastered(c);
    expect(r.changed).toBe(true);
    expect(r.schedule).toEqual({ state: 'mastered', correctCount: 6, intervalStep: 3, dueDate: null });
    expect(CardScheduleSchema.safeParse(r.schedule).success).toBe(true);
  });

  it('(AC-T9-4) (TC-16) (TC-17) other states are returned unchanged', () => {
    for (const c of [collected, learning, mastered]) {
      const r = markMastered(c);
      expect(r.changed).toBe(false);
      expect(r.schedule).toEqual(c);
      expect(CardScheduleSchema.safeParse(r.schedule).success).toBe(true);
    }
  });
});

describe('package exports', () => {
  it('(AC-T9-5) (TC-17) (TC-18) contracts and domain expose the documented names', () => {
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
      expect(contracts).toHaveProperty(name);
    }
    expect(domain.applyReview).toBe(applyReview);
    expect(domain.markMastered).toBe(markMastered);
    const outcome: domain.ReviewOutcome = run(collected, 'fast');
    expect(outcome.intervalDaysApplied).toBe(SRS.forgot_days);
  });
});

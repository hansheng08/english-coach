// QA probes for T-009 (every row with non-default settings, error pass-through, immutability). Written by QA; not part of the ticket's TC list.
import { describe, expect, it } from 'vitest';
import { CardScheduleSchema, PlanDateSchema, SrsSettingsSchema } from '@english-coach/contracts';
import type { CardSchedule, PlanDate, ReviewRating, SrsSettings } from '@english-coach/contracts';
import { applyReview, markMastered } from './index.ts';
import type { ReviewOutcome } from './index.ts';
import { addDays } from './taipei-date.ts';

const TODAY = PlanDateSchema.parse('2026-12-30');
// Every interval distinct so a wrong column is visible.
const S = SrsSettingsSchema.parse({ step_days: [2, 5, 11], after_last_days: 20, forgot_days: 1 });
const S2 = SrsSettingsSchema.parse({ step_days: [4, 9, 30], after_last_days: 60, forgot_days: 3 });

const card = (v: unknown): CardSchedule => CardScheduleSchema.parse(v);
const due = (today: PlanDate, d: number): PlanDate => {
  const r = addDays(today, d);
  if (!r.ok) throw new Error('addDays failed in test');
  return r.value;
};
const okOf = (c: CardSchedule, rating: ReviewRating, srs: SrsSettings = S, today: PlanDate = TODAY): ReviewOutcome => {
  const r = applyReview(c, rating, today, srs);
  if (!r.ok) throw new Error(`applyReview failed: ${r.error.message}`);
  expect(CardScheduleSchema.safeParse(r.value.schedule).success).toBe(true);
  expect(r.value.before).toBe(c.state);
  expect(r.value.schedule.correctCount).toBeGreaterThanOrEqual(c.correctCount);
  return r.value;
};

const collectedNew = card({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: null });
const collectedSeen = card({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: '2026-12-01' });
const learning = (n: number): CardSchedule => card({ state: 'learning', correctCount: n, intervalStep: 0, dueDate: '2026-12-29' });
const reviewing = (step: 1 | 2 | 3 | 4, n = 7): CardSchedule =>
  card({ state: 'reviewing', correctCount: n, intervalStep: step, dueDate: '2026-12-29' });

describe('QA: transition table with distinct settings (crosses a year boundary)', () => {
  it('(QA-7) collected rows use forgot_days for every rating, from new and seen cards', () => {
    for (const srs of [S, S2]) {
      for (const c of [collectedNew, collectedSeen]) {
        for (const rating of ['fast', 'hesitant'] as const) {
          const o = okOf(c, rating, srs);
          expect(o).toEqual({
            before: 'collected',
            intervalDaysApplied: srs.forgot_days,
            schedule: { state: 'learning', correctCount: 1, intervalStep: 0, dueDate: due(TODAY, srs.forgot_days) },
          });
        }
        expect(okOf(c, 'forgot', srs)).toEqual({
          before: 'collected',
          intervalDaysApplied: srs.forgot_days,
          schedule: { state: 'collected', correctCount: 0, intervalStep: 0, dueDate: due(TODAY, srs.forgot_days) },
        });
      }
    }
  });

  it('(QA-8) learning rows: correct -> reviewing step 1 with step_days[0]; forgot keeps a high count', () => {
    for (const srs of [S, S2]) {
      for (const rating of ['fast', 'hesitant'] as const) {
        expect(okOf(learning(5), rating, srs)).toEqual({
          before: 'learning',
          intervalDaysApplied: srs.step_days[0],
          schedule: { state: 'reviewing', correctCount: 6, intervalStep: 1, dueDate: due(TODAY, srs.step_days[0]) },
        });
      }
      expect(okOf(learning(5), 'forgot', srs)).toEqual({
        before: 'learning',
        intervalDaysApplied: srs.forgot_days,
        schedule: { state: 'learning', correctCount: 5, intervalStep: 0, dueDate: due(TODAY, srs.forgot_days) },
      });
    }
  });

  it('(QA-9) reviewing fast at every step uses the next step interval', () => {
    const cases = [
      { from: 1, to: 2, days: (s: SrsSettings) => s.step_days[1] },
      { from: 2, to: 3, days: (s: SrsSettings) => s.step_days[2] },
      { from: 3, to: 4, days: (s: SrsSettings) => s.after_last_days },
      { from: 4, to: 4, days: (s: SrsSettings) => s.after_last_days },
    ] as const;
    for (const srs of [S, S2]) {
      for (const c of cases) {
        expect(okOf(reviewing(c.from), 'fast', srs)).toEqual({
          before: 'reviewing',
          intervalDaysApplied: c.days(srs),
          schedule: { state: 'reviewing', correctCount: 8, intervalStep: c.to, dueDate: due(TODAY, c.days(srs)) },
        });
      }
    }
  });

  it('(QA-10) reviewing hesitant at every step stays and uses the same step interval', () => {
    const cases = [
      { step: 1, days: (s: SrsSettings) => s.step_days[0] },
      { step: 2, days: (s: SrsSettings) => s.step_days[1] },
      { step: 3, days: (s: SrsSettings) => s.step_days[2] },
      { step: 4, days: (s: SrsSettings) => s.after_last_days },
    ] as const;
    for (const srs of [S, S2]) {
      for (const c of cases) {
        expect(okOf(reviewing(c.step), 'hesitant', srs)).toEqual({
          before: 'reviewing',
          intervalDaysApplied: c.days(srs),
          schedule: { state: 'reviewing', correctCount: 8, intervalStep: c.step, dueDate: due(TODAY, c.days(srs)) },
        });
      }
    }
  });

  it('(QA-11) reviewing forgot at every step -> learning with forgot_days, count unchanged', () => {
    for (const srs of [S, S2]) {
      for (const step of [1, 2, 3, 4] as const) {
        expect(okOf(reviewing(step), 'forgot', srs)).toEqual({
          before: 'reviewing',
          intervalDaysApplied: srs.forgot_days,
          schedule: { state: 'learning', correctCount: 7, intervalStep: 0, dueDate: due(TODAY, srs.forgot_days) },
        });
      }
    }
  });

  it('(QA-12) step 4 forgot then hesitant restarts at step 1 (not the old step) with step_days[0]', () => {
    const forgot = okOf(reviewing(4), 'forgot');
    const again = okOf(forgot.schedule, 'hesitant');
    expect(again).toEqual({
      before: 'learning',
      intervalDaysApplied: S.step_days[0],
      schedule: { state: 'reviewing', correctCount: 8, intervalStep: 1, dueDate: due(TODAY, S.step_days[0]) },
    });
  });
});

describe('QA: errors and purity', () => {
  it('(QA-13) addDays err is returned as-is; last representable day still schedules', () => {
    const end = PlanDateSchema.parse('9999-12-31');
    const expected = addDays(end, S.forgot_days);
    expect(expected.ok).toBe(false);
    expect(applyReview(collectedNew, 'fast', end, S)).toEqual(expected);
    const edge = PlanDateSchema.parse('9999-12-30');
    expect(okOf(collectedNew, 'forgot', S, edge).schedule.dueDate).toBe('9999-12-31');
    expect(() => applyReview(reviewing(4), 'fast', end, S2)).not.toThrow();
  });

  it('(QA-14) mastered err has exactly kind validation and an issue at path state, for every rating and settings', () => {
    const m = card({ state: 'mastered', correctCount: 9, intervalStep: 4, dueDate: null });
    for (const rating of ['fast', 'hesitant', 'forgot'] as const) {
      const r = applyReview(m, rating, TODAY, S2);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('validation');
        expect(r.error.issues.map((i) => i.path)).toContain('state');
        expect(r.error.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('(QA-15) applyReview and markMastered never mutate the input card', () => {
    const inputs = [collectedNew, collectedSeen, learning(3), reviewing(1), reviewing(4)];
    for (const c of inputs) {
      const snapshot = { ...c };
      for (const rating of ['fast', 'hesitant', 'forgot'] as const) applyReview(c, rating, TODAY, S);
      markMastered(c);
      expect(c).toEqual(snapshot);
    }
  });

  it('(QA-16) markMastered at every reviewing step keeps that step; non-reviewing is returned unchanged', () => {
    for (const step of [1, 2, 3, 4] as const) {
      const r = markMastered(reviewing(step, 2));
      expect(r).toEqual({ changed: true, schedule: { state: 'mastered', correctCount: 2, intervalStep: step, dueDate: null } });
    }
    for (const c of [collectedNew, collectedSeen, learning(1), card({ state: 'mastered', correctCount: 2, intervalStep: 1, dueDate: null })]) {
      const r = markMastered(c);
      expect(r.changed).toBe(false);
      expect(r.schedule).toEqual(c);
    }
  });

  it('(QA-17) markMastered result of an applyReview chain is schema-valid and cannot be reviewed again', () => {
    let s: CardSchedule = collectedNew;
    for (const rating of ['fast', 'fast', 'fast', 'fast', 'fast'] as const) s = okOf(s, rating).schedule;
    expect(s).toMatchObject({ state: 'reviewing', intervalStep: 4, correctCount: 5 });
    const m = markMastered(s);
    expect(CardScheduleSchema.safeParse(m.schedule).success).toBe(true);
    expect(applyReview(m.schedule, 'fast', TODAY, S).ok).toBe(false);
  });
});

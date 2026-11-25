import { andThen, err, ok } from '@english-coach/contracts';
import type {
  CardSchedule,
  CardState,
  PlanDate,
  Result,
  ReviewRating,
  SrsSettings,
  ValidationError,
} from '@english-coach/contracts';
import { forgotIntervalDays, nextSrsStep, srsIntervalDays } from './srs.ts';
import { addDays } from './taipei-date.ts';

export type ReviewOutcome = {
  readonly before: CardState;
  readonly schedule: CardSchedule;
  readonly intervalDaysApplied: number;
};

type Reviewing = Extract<CardSchedule, { state: 'reviewing' }>;

/** Computes the due date `days` after `today` and wraps the new schedule. */
function schedule(
  before: CardState,
  today: PlanDate,
  days: number,
  build: (dueDate: PlanDate) => CardSchedule,
): Result<ReviewOutcome, ValidationError> {
  return andThen(addDays(today, days), (dueDate) =>
    ok({ before, schedule: build(dueDate), intervalDaysApplied: days }),
  );
}

function reviewCollected(
  card: Extract<CardSchedule, { state: 'collected' }>,
  rating: ReviewRating,
  today: PlanDate,
  srs: SrsSettings,
): Result<ReviewOutcome, ValidationError> {
  const days = forgotIntervalDays(srs);
  switch (rating) {
    case 'fast':
    case 'hesitant':
      return schedule(card.state, today, days, (dueDate) => ({
        state: 'learning',
        correctCount: 1,
        intervalStep: 0,
        dueDate,
      }));
    case 'forgot':
      return schedule(card.state, today, days, (dueDate) => ({
        state: 'collected',
        correctCount: 0,
        intervalStep: 0,
        dueDate,
      }));
    default: {
      const unreachable: never = rating;
      return unreachable;
    }
  }
}

function reviewLearning(
  card: Extract<CardSchedule, { state: 'learning' }>,
  rating: ReviewRating,
  today: PlanDate,
  srs: SrsSettings,
): Result<ReviewOutcome, ValidationError> {
  switch (rating) {
    case 'fast':
    case 'hesitant':
      return schedule(card.state, today, srsIntervalDays(1, srs), (dueDate) => ({
        state: 'reviewing',
        correctCount: card.correctCount + 1,
        intervalStep: 1,
        dueDate,
      }));
    case 'forgot':
      return schedule(card.state, today, forgotIntervalDays(srs), (dueDate) => ({
        state: 'learning',
        correctCount: card.correctCount,
        intervalStep: 0,
        dueDate,
      }));
    default: {
      const unreachable: never = rating;
      return unreachable;
    }
  }
}

function reviewReviewing(
  card: Reviewing,
  rating: ReviewRating,
  today: PlanDate,
  srs: SrsSettings,
): Result<ReviewOutcome, ValidationError> {
  switch (rating) {
    case 'fast': {
      const step = nextSrsStep(card.intervalStep);
      return schedule(card.state, today, srsIntervalDays(step, srs), (dueDate) => ({
        state: 'reviewing',
        correctCount: card.correctCount + 1,
        intervalStep: step,
        dueDate,
      }));
    }
    case 'hesitant':
      return schedule(card.state, today, srsIntervalDays(card.intervalStep, srs), (dueDate) => ({
        state: 'reviewing',
        correctCount: card.correctCount + 1,
        intervalStep: card.intervalStep,
        dueDate,
      }));
    case 'forgot':
      return schedule(card.state, today, forgotIntervalDays(srs), (dueDate) => ({
        state: 'learning',
        correctCount: card.correctCount,
        intervalStep: 0,
        dueDate,
      }));
    default: {
      const unreachable: never = rating;
      return unreachable;
    }
  }
}

/** Applies one review to a card. `today` is the Taipei date of the answer. Mastered cards are not scheduled. */
export function applyReview(
  card: CardSchedule,
  rating: ReviewRating,
  today: PlanDate,
  srs: SrsSettings,
): Result<ReviewOutcome, ValidationError> {
  switch (card.state) {
    case 'collected':
      return reviewCollected(card, rating, today, srs);
    case 'learning':
      return reviewLearning(card, rating, today, srs);
    case 'reviewing':
      return reviewReviewing(card, rating, today, srs);
    case 'mastered': {
      const message = 'mastered cards are not scheduled';
      return err({ kind: 'validation', issues: [{ path: 'state', message }], message });
    }
    default: {
      const unreachable: never = card;
      return unreachable;
    }
  }
}

/** reviewing -> mastered only; every other state is returned unchanged. */
export function markMastered(card: CardSchedule): { readonly schedule: CardSchedule; readonly changed: boolean } {
  switch (card.state) {
    case 'reviewing':
      return {
        schedule: { state: 'mastered', correctCount: card.correctCount, intervalStep: card.intervalStep, dueDate: null },
        changed: true,
      };
    case 'collected':
    case 'learning':
    case 'mastered':
      return { schedule: card, changed: false };
    default: {
      const unreachable: never = card;
      return unreachable;
    }
  }
}

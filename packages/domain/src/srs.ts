import type { SrsSettings } from '@english-coach/contracts';

/** card.interval_step 1..4 (4 = after the third step). */
export type SrsStep = 1 | 2 | 3 | 4;

// Hesitant answer = stay on the same step = srsIntervalDays(step); instant answer = srsIntervalDays(nextSrsStep(step)).
export function srsIntervalDays(step: SrsStep, srs: SrsSettings): number {
  switch (step) {
    case 1:
      return srs.step_days[0];
    case 2:
      return srs.step_days[1];
    case 3:
      return srs.step_days[2];
    case 4:
      return srs.after_last_days;
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

export function nextSrsStep(step: SrsStep): SrsStep {
  switch (step) {
    case 1:
      return 2;
    case 2:
      return 3;
    case 3:
      return 4;
    case 4:
      return 4;
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

export function forgotIntervalDays(srs: SrsSettings): number {
  return srs.forgot_days;
}

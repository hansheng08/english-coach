import { describe, expect, it } from 'vitest';
import { SrsSettingsSchema } from '@english-coach/contracts';
import type { SrsSettings } from '@english-coach/contracts';
import { mulberry32 } from '../test/prng.ts';
import { forgotIntervalDays, nextSrsStep, srsIntervalDays, type SrsStep } from './srs.ts';

const STEPS: SrsStep[] = [1, 2, 3, 4];
const custom: SrsSettings = SrsSettingsSchema.parse({ step_days: [2, 5, 11], after_last_days: 20, forgot_days: 2 });
const defaults = SrsSettingsSchema.parse({});

describe('srsIntervalDays', () => {
  it('reads every step from the settings passed in', () => {
    expect(STEPS.map((s) => srsIntervalDays(s, custom))).toEqual([2, 5, 11, 20]);
  });

  it('matches the schema defaults', () => {
    expect(STEPS.map((s) => srsIntervalDays(s, defaults))).toEqual([
      ...defaults.step_days,
      defaults.after_last_days,
    ]);
  });
});

describe('nextSrsStep', () => {
  it.each<[SrsStep, SrsStep]>([
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 4],
  ])('%d -> %d', (from, to) => {
    expect(nextSrsStep(from)).toBe(to);
  });
});

describe('forgotIntervalDays', () => {
  it('reads forgot_days', () => {
    expect(forgotIntervalDays(custom)).toBe(2);
    expect(forgotIntervalDays(defaults)).toBe(defaults.forgot_days);
  });
});

describe('mulberry32', () => {
  it('same seed gives the same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('values are in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('property: hesitating is never longer than answering instantly (AC-09)', () => {
  it('holds for 1,000 valid settings', () => {
    const rand = mulberry32(20261123);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let i = 0; i < 1000; i++) {
      const a = int(1, 363);
      const b = int(a + 1, 364);
      const c = int(b + 1, 365);
      const input = { step_days: [a, b, c], after_last_days: int(c, 365), forgot_days: int(1, a) };
      const parsed = SrsSettingsSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;
      const s = parsed.data;
      for (const step of STEPS) {
        expect(srsIntervalDays(step, s)).toBeLessThanOrEqual(srsIntervalDays(nextSrsStep(step), s));
      }
      expect(forgotIntervalDays(s)).toBeLessThanOrEqual(srsIntervalDays(1, s));
    }
  });
});

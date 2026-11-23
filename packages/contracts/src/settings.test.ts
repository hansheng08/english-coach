import { describe, expect, expectTypeOf, it } from 'vitest';
import { SrsSettingsSchema, type SrsSettings } from './settings.ts';

function pathsOf(input: unknown): (string | number)[][] {
  const r = SrsSettingsSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)));
}

describe('SrsSettingsSchema defaults (AC-T8-1)', () => {
  it('parse({}) gives the documented defaults', () => {
    expect(SrsSettingsSchema.parse({})).toEqual({ step_days: [3, 7, 14], after_last_days: 14, forgot_days: 1 });
  });

  it('fills the other fields when only forgot_days is given', () => {
    const r = SrsSettingsSchema.safeParse({ forgot_days: 2 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ step_days: [3, 7, 14], after_last_days: 14, forgot_days: 2 });
    }
  });

  it('step_days is a 3-element tuple type', () => {
    expectTypeOf<SrsSettings['step_days']>().toEqualTypeOf<[number, number, number]>();
  });
});

describe('SrsSettingsSchema rejects (AC-T8-2)', () => {
  const rejects: [string, unknown][] = [
    ['step day 0', { step_days: [0, 7, 14] }],
    ['step day 366', { step_days: [3, 7, 366], after_last_days: 365 }],
    ['after_last_days 0', { after_last_days: 0 }],
    ['after_last_days 366', { after_last_days: 366 }],
    ['forgot_days 0', { forgot_days: 0 }],
    ['forgot_days 366', { forgot_days: 366 }],
    ['non-integer step', { step_days: [3.5, 7, 14] }],
    ['non-integer after_last_days', { after_last_days: 14.5 }],
    ['non-integer forgot_days', { forgot_days: 1.5 }],
    ['2 steps', { step_days: [3, 7] }],
    ['4 steps', { step_days: [3, 7, 14, 30] }],
    ['descending', { step_days: [7, 3, 14] }],
  ];
  for (const [name, input] of rejects) {
    it(`rejects ${name}`, () => {
      expect(SrsSettingsSchema.safeParse(input).success).toBe(false);
    });
  }

  it('equal first two steps -> path step_days.1', () => {
    expect(SrsSettingsSchema.safeParse({ step_days: [3, 3, 14] }).success).toBe(false);
    expect(pathsOf({ step_days: [3, 3, 14] })).toContainEqual(['step_days', 1]);
  });

  it('equal last two steps -> path step_days.2', () => {
    expect(SrsSettingsSchema.safeParse({ step_days: [3, 7, 7], after_last_days: 14 }).success).toBe(false);
    expect(pathsOf({ step_days: [3, 7, 7], after_last_days: 14 })).toContainEqual(['step_days', 2]);
  });

  it('after_last_days below step_days[2] -> path after_last_days', () => {
    const input = { step_days: [3, 7, 14], after_last_days: 13 };
    expect(SrsSettingsSchema.safeParse(input).success).toBe(false);
    expect(pathsOf(input)).toContainEqual(['after_last_days']);
  });

  it('forgot_days above step_days[0] -> path forgot_days', () => {
    const input = { step_days: [3, 7, 14], forgot_days: 4 };
    expect(SrsSettingsSchema.safeParse(input).success).toBe(false);
    expect(pathsOf(input)).toContainEqual(['forgot_days']);
  });
});

describe('SrsSettingsSchema accepts boundaries (AC-T8-2)', () => {
  const accepts: [string, unknown][] = [
    ['after_last_days == step_days[2]', { step_days: [3, 7, 14], after_last_days: 14 }],
    ['forgot_days == step_days[0]', { step_days: [3, 7, 14], forgot_days: 3 }],
    ['minimum', { step_days: [1, 2, 3], after_last_days: 3, forgot_days: 1 }],
    ['maximum', { step_days: [363, 364, 365], after_last_days: 365, forgot_days: 363 }],
  ];
  for (const [name, input] of accepts) {
    it(`accepts ${name}`, () => {
      expect(SrsSettingsSchema.safeParse(input).success).toBe(true);
    });
  }
});

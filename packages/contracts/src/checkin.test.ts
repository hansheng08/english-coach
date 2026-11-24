import { describe, expect, it } from 'vitest';
import { CheckinEventSchema, CheckinRecordSchema, SLOT_OPEN_STEP, SLOT_STEPS, SLOTS } from './checkin.ts';

// Must stay in sync with slot_checkin_step_check in supabase/migrations/20261124160000_t006_*.sql (ARCHITECTURE §4.8.3).
const SQL_STEP_FORMAT = /^[a-z][a-z_]{0,31}$/;

describe('SLOT_STEPS (AC-T6-12)', () => {
  it('covers exactly the three slots', () => {
    expect(Object.keys(SLOT_STEPS)).toEqual([...SLOTS]);
  });

  it.each(SLOTS.flatMap((slot) => SLOT_STEPS[slot].map((step) => [slot, step] as const)))(
    '%s step %s matches the SQL step format and is not the reserved open step',
    (_slot, step) => {
      expect(step).toMatch(SQL_STEP_FORMAT);
      expect(step).not.toBe(SLOT_OPEN_STEP);
    },
  );

  it('the reserved open step also matches the SQL step format', () => {
    expect(SLOT_OPEN_STEP).toMatch(SQL_STEP_FORMAT);
  });
});

describe('CheckinEventSchema (AC-T6-12)', () => {
  const base = { planDate: '2026-11-24', slot: 'morning' } as const;

  it('accepts "slot opened" and a listed step completed or skipped', () => {
    expect(CheckinEventSchema.safeParse({ ...base, step: 'slot', status: 'opened' }).success).toBe(true);
    expect(CheckinEventSchema.safeParse({ ...base, step: 'reading', status: 'completed' }).success).toBe(true);
    expect(CheckinEventSchema.safeParse({ ...base, step: 'shadowing', status: 'skipped' }).success).toBe(true);
  });

  it('rejects opened with a real step, the reserved step with completed, and a step from another slot', () => {
    for (const bad of [
      { ...base, step: 'reading', status: 'opened' },
      { ...base, step: 'slot', status: 'completed' },
      { ...base, step: 'cards', status: 'completed' },
    ]) {
      const r = CheckinEventSchema.safeParse(bad);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.path)).toEqual([['step']]);
    }
  });

  it('CheckinRecordSchema needs an offset datetime', () => {
    const row = { ...base, step: 'slot', status: 'opened' };
    expect(CheckinRecordSchema.safeParse({ ...row, recordedAt: '2026-11-24T00:00:00+00:00' }).success).toBe(true);
    expect(CheckinRecordSchema.safeParse({ ...row, recordedAt: '2026-11-24 00:00' }).success).toBe(false);
  });
});

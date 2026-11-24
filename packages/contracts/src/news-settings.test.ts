import { describe, expect, it } from 'vitest';
import { NewsSettingsSchema } from './settings.ts';

const issuePaths = (input: unknown): string[] => {
  const r = NewsSettingsSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.map(String).join('.'));
};

describe('NewsSettingsSchema (ARCHITECTURE §11.2, ADR-011 decision 6)', () => {
  it('(AC-T49-1) parse({}) gives the documented defaults', () => {
    expect(NewsSettingsSchema.parse({})).toEqual({
      rotation_order: ['ai', 'software', 'semiconductor'],
      anchor_date: '2026-11-22',
      lookback_hours: 48,
    });
  });

  it('(AC-T49-1) accepts lookback_hours 1 and 168 and another rotation order', () => {
    expect(NewsSettingsSchema.safeParse({ lookback_hours: 1 }).success).toBe(true);
    expect(NewsSettingsSchema.safeParse({ lookback_hours: 168 }).success).toBe(true);
    expect(NewsSettingsSchema.parse({ rotation_order: ['semiconductor', 'ai', 'software'] }).rotation_order).toEqual([
      'semiconductor',
      'ai',
      'software',
    ]);
  });

  it('(AC-T49-1) rejects a repeated category (path rotation_order) and out-of-range values', () => {
    expect(issuePaths({ rotation_order: ['ai', 'ai', 'software'] })).toEqual(['rotation_order']);
    const rejects: unknown[] = [
      { rotation_order: ['ai', 'software'] },
      { rotation_order: ['ai', 'software', 'finance'] },
      { lookback_hours: 0 },
      { lookback_hours: 169 },
      { lookback_hours: 1.5 },
      { anchor_date: '2026-02-30' },
    ];
    expect(rejects.map((input) => NewsSettingsSchema.safeParse(input).success)).toEqual(rejects.map(() => false));
  });
});

import { describe, expect, it } from 'vitest';
import { PlanDateSchema } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { addDays, daysBetween, toTaipeiPlanDate } from './taipei-date.ts';

const d = (s: string) => PlanDateSchema.parse(s);

describe('toTaipeiPlanDate', () => {
  it.each([
    ['2026-11-22T15:59:59.999Z', '2026-11-22'],
    ['2026-11-22T16:00:00.000Z', '2026-11-23'],
    ['2026-12-31T16:00:00.000Z', '2027-01-01'],
  ])('%s -> %s', (iso, expected) => {
    expect(expectOk(toTaipeiPlanDate(new Date(iso)))).toBe(expected);
  });

  it('invalid date -> validation error', () => {
    const e = expectErr(toTaipeiPlanDate(new Date(NaN)));
    expect(e.kind).toBe('validation');
    expect(e.issues[0]?.path).toBe('now');
  });
});

describe('addDays', () => {
  it.each([
    ['2028-02-28', 1, '2028-02-29'],
    ['2027-02-28', 1, '2027-03-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-11-23', 0, '2026-11-23'],
    ['2026-03-01', -1, '2026-02-28'],
    ['0001-01-02', -1, '0001-01-01'],
  ])('%s + %d = %s', (from, n, expected) => {
    expect(expectOk(addDays(d(from), n))).toBe(expected);
  });

  it('non-integer days -> err at path days', () => {
    const e = expectErr(addDays(d('2026-11-23'), 1.5));
    expect(e.kind).toBe('validation');
    expect(e.issues[0]?.path).toBe('days');
  });

  it('out of range -> err', () => {
    expect(expectErr(addDays(d('9999-12-31'), 1)).kind).toBe('validation');
    expect(expectErr(addDays(d('0001-01-01'), -1)).kind).toBe('validation');
  });
});

describe('daysBetween', () => {
  it.each([
    ['2026-11-20', '2026-11-23', 3],
    ['2026-11-23', '2026-11-20', -3],
    ['2026-11-23', '2026-11-23', 0],
    ['2028-02-28', '2028-03-01', 2],
  ])('%s -> %s = %d', (from, to, expected) => {
    expect(daysBetween(d(from), d(to))).toBe(expected);
  });
});

import { err, ok, PlanDateSchema } from '@english-coach/contracts';
import type { PlanDate, Result, ValidationError } from '@english-coach/contracts';

const TAIPEI_OFFSET_HOURS = 8; // Taiwan has no daylight saving time.
const MS_PER_DAY = 86_400_000;
const DAYS_PER_400_YEARS = 146_097;

function invalid(path: string, message: string): ValidationError {
  return { kind: 'validation', issues: [{ path, message }], message };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Days since 1970-01-01 of a valid PlanDate. Shifts by 400 years so years 0001-0099 are not remapped by Date.UTC. */
function dayNumber(date: PlanDate): number {
  const [y = '', m = '', d = ''] = date.split('-');
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  return Date.UTC(year + 400, month - 1, day) / MS_PER_DAY - DAYS_PER_400_YEARS;
}

const MIN_DAY = dayNumber(PlanDateSchema.parse('0001-01-01'));
const MAX_DAY = dayNumber(PlanDateSchema.parse('9999-12-31'));

function fromDayNumber(n: number, path: string): Result<PlanDate, ValidationError> {
  if (n < MIN_DAY || n > MAX_DAY) return err(invalid(path, 'date out of range 0001-01-01..9999-12-31'));
  const d = new Date(n * MS_PER_DAY);
  const text = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
  const parsed = PlanDateSchema.safeParse(text);
  return parsed.success ? ok(parsed.data) : err(invalid(path, 'not a valid date'));
}

/** Converts an instant to the Asia/Taipei calendar date (fixed UTC+8). */
export function toTaipeiPlanDate(now: Date): Result<PlanDate, ValidationError> {
  const t = now.getTime();
  if (Number.isNaN(t)) return err(invalid('now', 'invalid date'));
  const shifted = Math.floor((t + TAIPEI_OFFSET_HOURS * 3_600_000) / MS_PER_DAY);
  return fromDayNumber(shifted, 'now');
}

/** Adds (or subtracts) whole days to a PlanDate. */
export function addDays(date: PlanDate, days: number): Result<PlanDate, ValidationError> {
  if (!Number.isInteger(days)) return err(invalid('days', 'days must be an integer'));
  return fromDayNumber(dayNumber(date) + days, 'days');
}

/** `to - from` in whole days (negative when `to` is earlier). */
export function daysBetween(from: PlanDate, to: PlanDate): number {
  return dayNumber(to) - dayNumber(from);
}

// QA probes for the daily-prep handler counts (QA-8): only a ready plan counts as ready.
import { ok, PlanDateSchema, UserIdSchema, type PlanDate } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import type { SupabaseSecretEnv } from '../_shared/config/env.ts';
import { createDailyPrepHandler } from './handler.ts';

const KEY = 'k-qa-secret-qa-secret-qa-secret';
const env: SupabaseSecretEnv = { url: 'https://example.invalid', secretKey: KEY };
const U1 = UserIdSchema.parse('a0000000-0000-4000-8000-0000000000a1');
const U2 = UserIdSchema.parse('a0000000-0000-4000-8000-0000000000a2');

describe('daily-prep counts (QA-8)', () => {
  it('(QA-8) a pending plan that was not existing is not counted as ready; an existing pending is existing', async () => {
    const dates: PlanDate[] = [];
    const handler = createDailyPrepHandler({
      env: ok(env),
      open: () => ({
        listUserIds: () => Promise.resolve(ok([U1, U2])),
        prepare: (userId, planDate) => {
          dates.push(planDate);
          return Promise.resolve(ok({ plan: { status: 'pending' as const, planDate }, existing: userId === U2 }));
        },
      }),
      now: () => new Date('2026-11-28T16:30:00.000Z'), // Taipei 2026-11-29 00:30
      log: () => undefined,
    });
    const res = await handler(new Request('http://localhost/daily-prep', { method: 'POST', headers: { apikey: KEY } }));
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ ready: 0, existing: 1 });
    expect(dates).toEqual([PlanDateSchema.parse('2026-11-29'), PlanDateSchema.parse('2026-11-29')]);
  });
});

import {
  ApiErrorBodySchema,
  ArticleIdSchema,
  err,
  ok,
  PlanDateSchema,
  UserIdSchema,
  type AppError,
  type DailyPlan,
  type PlanDate,
  type Result,
  type UserId,
} from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import type { SupabaseSecretEnv } from '../_shared/config/env.ts';
import type { PrepareOutcome } from '../_shared/plan/prepare.ts';
import { createDailyPrepHandler, type DailyPrepSession } from './handler.ts';

const NOW = new Date('2026-11-27T21:00:00.000Z'); // Taipei 2026-11-28 05:00
const env: SupabaseSecretEnv = { url: 'http://fake.local', secretKey: 'k1-secret' };
const U1 = UserIdSchema.parse('a0000000-0000-4000-8000-0000000000e1');
const U2 = UserIdSchema.parse('b0000000-0000-4000-8000-0000000000e2');

const failedPlan = (planDate: PlanDate): DailyPlan => ({
  status: 'failed',
  planDate,
  failure: { step: 'news', error: { kind: 'news_unavailable', message: 'none', retryable: true }, timeout_sec: null, failed_at: NOW.toISOString() },
});
const readyPlan = (planDate: PlanDate): DailyPlan => ({
  status: 'ready',
  planDate,
  plannedCategory: 'ai',
  actualCategory: 'ai',
  categorySkipped: [],
  isFallbackArticle: false,
  article: {
    id: ArticleIdSchema.parse('33333333-3333-4333-8333-333333333333'),
    title: 't',
    sourceName: 's',
    originalUrl: 'https://example.invalid/a',
    rewrittenText: 'x',
    sentences: [],
    chunks: [],
  },
  shadowItems: [],
  noonItems: [],
  cardIds: [],
  tonightQuestion: null,
  seedRemaining: null,
});

function setup(
  prepare: (userId: UserId, planDate: PlanDate) => Result<PrepareOutcome, AppError>,
  opts: { env?: Result<SupabaseSecretEnv, AppError>; ids?: Result<readonly UserId[], AppError> } = {},
) {
  const logs: string[] = [];
  const prepared: { userId: UserId; planDate: PlanDate }[] = [];
  let opened = 0;
  const handler = createDailyPrepHandler({
    env: opts.env ?? ok(env),
    open: (): DailyPrepSession => {
      opened += 1;
      return {
        listUserIds: () => Promise.resolve(opts.ids ?? ok([U1, U2])),
        prepare: (userId, planDate) => {
          prepared.push({ userId, planDate });
          return Promise.resolve(prepare(userId, planDate));
        },
      };
    },
    now: () => NOW,
    log: (line) => logs.push(line),
  });
  return { handler, logs, prepared, opened: () => opened };
}

const request = (apikey: string | undefined): Request =>
  new Request('http://localhost/daily-prep', { method: 'POST', ...(apikey === undefined ? {} : { headers: { apikey } }) });

describe('createDailyPrepHandler (T-025a)', () => {
  it('(AC-T25-14) (TC-22) a bad env is 500 and a bad apikey is 401; nothing is prepared and nothing is logged', async () => {
    const bad = setup(() => err({ kind: 'internal', message: 'unused' }), { env: err({ kind: 'internal', message: 'missing env SUPABASE_URL' }) });
    const r1 = await bad.handler(request('k1-secret'));
    expect(r1.status).toBe(500);
    expect(ApiErrorBodySchema.parse(await r1.json()).error.kind).toBe('internal');

    const wrong = setup(() => err({ kind: 'internal', message: 'unused' }));
    for (const key of [undefined, 'k2']) {
      const r2 = await wrong.handler(request(key));
      expect(r2.status).toBe(401);
      expect(JSON.stringify(ApiErrorBodySchema.parse(await r2.json()))).not.toContain('k1-secret');
    }
    expect(bad.opened() + wrong.opened()).toBe(0);
    expect(bad.prepared.concat(wrong.prepared)).toEqual([]);
    expect(bad.logs.concat(wrong.logs)).toEqual([]);
  });

  it('(AC-T25-14) (TC-22) two users, one ready and one failed: 200 { ready: 1, existing: 0, failed: 1 } for the Taipei date; the log holds only counts and error kinds', async () => {
    const s = setup((userId, planDate) =>
      userId === U1 ? ok({ plan: readyPlan(planDate), existing: false }) : ok({ plan: failedPlan(planDate), existing: false }),
    );
    const res = await s.handler(request('k1-secret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: 1, existing: 0, failed: 1 });
    expect(s.prepared.map((p) => p.planDate)).toEqual(['2026-11-28', '2026-11-28']);
    expect(s.prepared.map((p) => p.userId)).toEqual([U1, U2]);
    const log = s.logs.join('\n');
    expect(log).toBe('daily-prep ready=1 existing=0 failed=1 errors=news_unavailable');
    expect(log).not.toContain(U1);
    expect(log).not.toContain(U2);
    expect(log).not.toContain('k1-secret');
  });

  it('(AC-T25-14) existing plans and errors are counted apart; an error kind is logged, the message is not', async () => {
    const day = PlanDateSchema.parse('2026-11-28');
    const s = setup((userId) =>
      userId === U1 ? ok({ plan: { status: 'pending', planDate: day }, existing: true }) : err({ kind: 'db_failed', message: 'secret row text' }),
    );
    const res = await s.handler(request('k1-secret'));
    expect(await res.json()).toEqual({ ready: 0, existing: 1, failed: 1 });
    expect(s.logs).toEqual(['daily-prep ready=0 existing=1 failed=1 errors=db_failed']);
  });

  it('(AC-T25-14) a failing user list is its error status and prepares nobody', async () => {
    const s = setup(() => err({ kind: 'internal', message: 'unused' }), { ids: err({ kind: 'db_failed', message: 'select profile failed' }) });
    const res = await s.handler(request('k1-secret'));
    expect(res.status).toBe(500);
    expect(s.prepared).toEqual([]);
  });
});

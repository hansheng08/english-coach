import { ApiErrorBodySchema, DailyPlanSchema, err, ok, PlanDateSchema, type LlmProvider } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import type { TokenClaims } from '../_shared/db/auth.ts';
import { defaultFallback, memStore, type MemOptions } from '../_shared/plan/test/mem-store.ts';
import { createRegistry } from '../_shared/providers/registry.ts';
import type { NewsSource } from '../_shared/news/types.ts';
import { createRouter, ROUTES } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';

const GOOD: TokenClaims = { role: 'authenticated', sub: '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c', is_anonymous: false };
const NOW = new Date('2026-11-27T04:00:00Z'); // Taipei 2026-11-27 12:00
const bearer = { Authorization: 'Bearer a.b.c' };

const fakeLlm: LlmProvider = {
  id: 'gemini',
  capability: 'llm',
  tier: 'free',
  displayName: 'Fake',
  generate: () => Promise.resolve(err({ kind: 'unavailable', provider: 'gemini', capability: 'llm', message: 'fake' })),
  stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }) }),
};

const sources: readonly NewsSource[] = (['ai', 'software', 'semiconductor'] as const).map((category) => ({
  id: `src-${category}`,
  name: category,
  feedUrl: `https://news.example.invalid/${category}/feed/`,
  category,
  priority: 1,
  fetchMode: 'rss_full',
  includeUrlPattern: null,
  enabled: true,
}));

function setup(opts: MemOptions = {}) {
  const { store, state } = memStore({ sources, ...opts });
  const fetchCalls: string[] = [];
  const planStoreCalls: string[] = [];
  const handle = createRouter(
    makeTestRouterDeps({
      auth: ok({ verifyToken: () => Promise.resolve(ok(GOOD)) }),
      routeDeps: ok(
        makeTestRouteDeps({
          now: () => NOW,
          planStore: (ctx) => {
            planStoreCalls.push(ctx.userId);
            return store;
          },
          providers: createRegistry({ providers: [fakeLlm], env: () => undefined }),
          fetch: (url) => {
            fetchCalls.push(url);
            return Promise.resolve(new Response('', { status: 404 }));
          },
        }),
      ),
    }),
  );
  return { handle, state, fetchCalls, planStoreCalls };
}

const post = (headers: Record<string, string> = bearer): Request => new Request('http://localhost/api/plan/today', { method: 'POST', headers });

describe('POST /plan/today (ARCHITECTURE §5.1, §11.2 v1.12)', () => {
  it('(AC-T25-12) (TC-20) is a route; a missing token is 401 and the store is never built', async () => {
    expect(Object.keys(ROUTES)).toContain('POST /plan/today');
    const s = setup();
    const res = await s.handle(post({}));
    expect(res.status).toBe(401);
    expect(ApiErrorBodySchema.parse(await res.json()).error.kind).toBe('unauthenticated');
    expect(s.planStoreCalls).toEqual([]);
  });

  it('(AC-T25-12) (TC-20) ready is 200 with a body that passes DailyPlanSchema; the store is built for the signed-in user', async () => {
    const s = setup({ fallback: ok(defaultFallback('semiconductor')) });
    const res = await s.handle(post());
    expect(res.status).toBe(200);
    const body = DailyPlanSchema.parse(await res.json());
    expect(body.status).toBe('ready');
    expect(body.planDate).toBe('2026-11-27');
    expect(s.planStoreCalls).toEqual([GOOD.sub]);
  });

  it('(AC-T25-12) (TC-20) a plan somebody else is preparing is 200 pending', async () => {
    const claimedAt = new Date(NOW.getTime() - 1000).toISOString();
    const s = setup({ row: { plan: { status: 'pending', planDate: PlanDateSchema.parse('2026-11-27') }, claimedAt } });
    const res = await s.handle(post());
    expect(res.status).toBe(200);
    expect(DailyPlanSchema.parse(await res.json()).status).toBe('pending');
  });

  it('(AC-T25-12) (TC-20) three empty categories and no older article is 200 failed with step news / news_unavailable (no 503, no plan_not_ready)', async () => {
    const s = setup({ fallback: ok(null) });
    const res = await s.handle(post());
    expect(res.status).toBe(200);
    const body = DailyPlanSchema.parse(await res.json());
    expect(body.status).toBe('failed');
    if (body.status === 'failed') {
      expect(body.failure.step).toBe('news');
      expect(body.failure.error.kind).toBe('news_unavailable');
    }
    expect(s.state.failed[0]?.failure.error.kind).toBe('news_unavailable');
  });

  it('(AC-T25-12) (TC-20) a second call returns the same plan and fetches no news again', async () => {
    const s = setup({ fallback: ok(defaultFallback('semiconductor')) });
    const first = await (await s.handle(post())).text();
    const callsAfterFirst = s.fetchCalls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const second = await (await s.handle(post())).text();
    expect(second).toBe(first);
    expect(s.fetchCalls.length).toBe(callsAfterFirst);
    expect(s.state.completed).toHaveLength(1);
  });

  it('(AC-T25-12) a store error before any plan row exists is the error status (db_failed 500)', async () => {
    const s = setup({ overrides: { insertPending: () => Promise.resolve(err({ kind: 'db_failed', message: 'insert failed' })) } });
    const res = await s.handle(post());
    expect(res.status).toBe(500);
    expect(ApiErrorBodySchema.parse(await res.json()).error.kind).toBe('db_failed');
  });
});

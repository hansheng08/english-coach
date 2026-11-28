// QA probe for POST /plan/today (QA-7): the LLM calls use the model of DEFAULT_SETTINGS.
import { err, ok, type LlmProvider, type LlmRequest, type ProviderError, type Result } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import type { TokenClaims } from '../_shared/db/auth.ts';
import { FEEDS, FIXTURE_NOW, fakeFetch, recordedWeb } from '../_shared/news/test/fixtures.ts';
import type { NewsSource } from '../_shared/news/types.ts';
import { defaultFallback, memStore } from '../_shared/plan/test/mem-store.ts';
import { createRegistry, DEFAULT_SETTINGS } from '../_shared/providers/registry.ts';
import { createRouter } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';

const GOOD: TokenClaims = { role: 'authenticated', sub: '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9d', is_anonymous: false };

const source = (id: string, category: NewsSource['category'], feedUrl: string): NewsSource => ({
  id,
  name: id,
  feedUrl,
  category,
  priority: 1,
  fetchMode: 'rss_full',
  includeUrlPattern: null,
  enabled: true,
});

describe('POST /plan/today model (QA-7)', () => {
  it('(QA-7) every LLM request carries DEFAULT_SETTINGS.llm.model', async () => {
    const models: string[] = [];
    const llm: LlmProvider = {
      id: 'gemini',
      capability: 'llm',
      tier: 'free',
      displayName: 'Fake',
      generate<T>(req: LlmRequest<T>): Promise<Result<T, ProviderError>> {
        models.push(req.model);
        return Promise.resolve(err({ kind: 'unavailable', provider: 'gemini', capability: 'llm', message: 'fake' }));
      },
      stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }) }),
    };
    const { store } = memStore({
      sources: [source('semieng', 'semiconductor', FEEDS.semiEngineering.url)],
      fallback: ok(defaultFallback('semiconductor')),
    });
    const handle = createRouter(
      makeTestRouterDeps({
        auth: ok({ verifyToken: () => Promise.resolve(ok(GOOD)) }),
        routeDeps: ok(
          makeTestRouteDeps({
            now: () => FIXTURE_NOW,
            planStore: () => store,
            providers: createRegistry({ providers: [llm], env: () => undefined }),
            fetch: fakeFetch(recordedWeb()).fetch,
          }),
        ),
      }),
    );
    const res = await handle(new Request('http://localhost/api/plan/today', { method: 'POST', headers: { Authorization: 'Bearer a.b.c' } }));
    expect(res.status).toBe(200);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) expect(m).toBe(DEFAULT_SETTINGS.llm.model);
  });
});

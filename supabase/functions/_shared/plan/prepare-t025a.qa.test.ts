// QA probes for T-025a preparePlan / runPrepare (QA-3, QA-4, QA-11): failure steps, timeout_sec, fallback category, lookback, card order and refill.
import {
  err,
  NewsSettingsSchema,
  ok,
  UserIdSchema,
  type LlmProvider,
  type LlmRequest,
  type ProviderError,
  type Result,
} from '@english-coach/contracts';
import { expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { FEEDS, FIXTURE_NOW, fakeFetch, recordedWeb, type Route } from '../news/test/fixtures.ts';
import { goodRaw } from '../news/test/rewrite-samples.ts';
import { JUDGE_PROMPT } from '../news/rewrite.ts';
import type { NewsSource } from '../news/types.ts';
import { preparePlan, runPrepare } from './prepare.ts';
import { cardId, date, dbFailed, defaultFallback, dueCard, memStore, newCard, type MemOptions } from './test/mem-store.ts';
import { makeTestPlanDeps } from './test/plan-deps.ts';

const USER = UserIdSchema.parse('00000000-0000-4000-8000-0000000000ab');
const PLAN_DATE = date('2026-11-24'); // planned category: semiconductor
const MODEL = 'gemini-3.5-flash-lite' as const;

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
const SOURCES: readonly NewsSource[] = [
  source('tns-ai', 'ai', FEEDS.tnsAi.url),
  source('sdtimes', 'software', FEEDS.sdTimes.url),
  source('semieng', 'semiconductor', FEEDS.semiEngineering.url),
];

const perr = (kind: 'timeout' | 'unavailable'): ProviderError => ({ kind, provider: 'gemini', capability: 'llm', message: 'fake' });

type Script = { readonly judge?: Result<boolean, ProviderError>; readonly rewrite?: Result<unknown, ProviderError> };

function fakeLlm(script: Script): LlmProvider {
  return {
    id: 'gemini',
    capability: 'llm',
    tier: 'free',
    displayName: 'Fake',
    generate<T>(req: LlmRequest<T>): Promise<Result<T, ProviderError>> {
      const isJudge = req.system === JUDGE_PROMPT;
      const reply = isJudge ? (script.judge ?? ok(true)) : (script.rewrite ?? ok(goodRaw()));
      if (!reply.ok) return Promise.resolve(err(reply.error));
      const parsed = req.schema.safeParse(isJudge ? { category_match: reply.value } : reply.value);
      return Promise.resolve(parsed.success ? ok(parsed.data) : err({ kind: 'invalid_response', provider: 'gemini', capability: 'llm', message: 'fake' }));
    },
    stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }) }),
  };
}

function setup(opts: MemOptions & { readonly web?: Record<string, Route>; readonly script?: Script | 'none' } = {}) {
  const { store, state } = memStore({ sources: SOURCES, ...opts });
  const deps = makeTestPlanDeps({
    store,
    llm:
      opts.script === 'none'
        ? err({ kind: 'not_configured', provider: 'gemini', capability: 'llm', message: 'fake' })
        : ok({ llm: fakeLlm(opts.script ?? {}), model: MODEL }),
    fetch: fakeFetch(opts.web ?? {}).fetch,
    now: () => FIXTURE_NOW,
  });
  return { deps, state };
}

const failureOf = async (s: ReturnType<typeof setup>) => {
  const plan = expectOk(await preparePlan(s.deps, USER, PLAN_DATE));
  expect(plan.status).toBe('failed');
  return s.state.failed[0]?.failure;
};

describe('failure steps and timeout_sec (QA-3)', () => {
  it('(QA-3) a db error while looking for news fails at step news and does not fall back to an older article', async () => {
    const s = setup({
      web: recordedWeb(),
      fallback: ok(defaultFallback('semiconductor')),
      overrides: { isArticleUsed: () => Promise.resolve(err(dbFailed())) },
    });
    const f = await failureOf(s);
    expect(f?.step).toBe('news');
    expect(f?.error.kind).toBe('db_failed');
    expect(f?.timeout_sec).toBeNull();
    expect(s.state.completed).toHaveLength(0);
  });

  it('(QA-3) a judge timeout with no older article is step rewrite with timeout_sec 8', async () => {
    const f = await failureOf(setup({ web: recordedWeb(), script: { judge: err(perr('timeout')) }, fallback: ok(null) }));
    expect(f?.step).toBe('rewrite');
    expect(f?.error.kind).toBe('timeout');
    expect(f?.timeout_sec).toBe(8);
  });

  it('(QA-3) a judge error that is not a timeout keeps timeout_sec null', async () => {
    const f = await failureOf(setup({ web: recordedWeb(), script: { judge: err(perr('unavailable')) }, fallback: ok(null) }));
    expect(f?.step).toBe('rewrite');
    expect(f?.error.kind).toBe('unavailable');
    expect(f?.timeout_sec).toBeNull();
  });

  it('(QA-3) a rewrite error that is not a timeout keeps timeout_sec null', async () => {
    const f = await failureOf(setup({ web: recordedWeb(), script: { rewrite: err(perr('unavailable')) }, fallback: ok(null) }));
    expect(f?.step).toBe('rewrite');
    expect(f?.timeout_sec).toBeNull();
  });

  it('(QA-3) no LLM, an article found and no older article is step rewrite with not_configured', async () => {
    const f = await failureOf(setup({ web: recordedWeb(), script: 'none', fallback: ok(null) }));
    expect(f?.step).toBe('rewrite');
    expect(f?.error.kind).toBe('not_configured');
    expect(f?.timeout_sec).toBeNull();
  });

  it('(QA-3) an insertArticle error fails at step news (no fallback is used)', async () => {
    const s = setup({
      web: recordedWeb(),
      fallback: ok(defaultFallback('semiconductor')),
      overrides: { insertArticle: () => Promise.resolve(err(dbFailed())) },
    });
    const f = await failureOf(s);
    expect(f?.step).toBe('news');
    expect(f?.error.kind).toBe('db_failed');
  });

  it('(QA-3) a readFallbackArticle error fails at step news', async () => {
    const f = await failureOf(setup({ fallback: err(dbFailed()) }));
    expect(f?.step).toBe('news');
    expect(f?.error.kind).toBe('db_failed');
  });

  it('(QA-3) a listQuestionCandidates error fails at step internal', async () => {
    const f = await failureOf(setup({ fallback: ok(defaultFallback('semiconductor')), questions: err(dbFailed()) }));
    expect(f?.step).toBe('internal');
    expect(f?.error.kind).toBe('db_failed');
  });
});

describe('fallback article and lookback (QA-3)', () => {
  it('(QA-3) the older article of another category sets actual_category to that category', async () => {
    const s = setup({ fallback: ok(defaultFallback('ai')) });
    expect(expectOk(await preparePlan(s.deps, USER, PLAN_DATE)).status).toBe('ready');
    const done = s.state.completed[0];
    expect(done?.isFallbackArticle).toBe(true);
    expect(done?.actualCategory).toBe('ai');
  });

  it('(QA-3) lookback_hours from the settings is used (an article 5 h old is outside a 2 h window)', async () => {
    const s = setup({
      web: recordedWeb(),
      fallback: ok(defaultFallback('semiconductor')),
      overrides: { readNewsSettings: () => Promise.resolve(ok(NewsSettingsSchema.parse({ lookback_hours: 2 }))) },
    });
    expectOk(await preparePlan(s.deps, USER, PLAN_DATE));
    expect(s.state.articles).toHaveLength(0);
    expect(s.state.completed[0]?.isFallbackArticle).toBe(true);
  });
});

describe('claim and runPrepare outcomes (QA-3)', () => {
  it('(QA-3) a failed plan whose reclaim is lost is returned as pending, not as the stored failure', async () => {
    const failure = {
      step: 'news' as const,
      error: { kind: 'internal' as const, message: 'm', retryable: false },
      timeout_sec: null,
      failed_at: FIXTURE_NOW.toISOString(),
    };
    const s = setup({
      row: { plan: { status: 'failed', planDate: PLAN_DATE, failure }, claimedAt: FIXTURE_NOW.toISOString() },
      reclaimResult: false,
    });
    const plan = expectOk(await preparePlan(s.deps, USER, PLAN_DATE));
    expect(plan).toEqual({ status: 'pending', planDate: PLAN_DATE });
  });

  it('(QA-3) a complete that lost the lease reports existing true', async () => {
    const s = setup({ fallback: ok(defaultFallback('semiconductor')), completeResult: ok(false) });
    const outcome = expectOk(await runPrepare(s.deps, USER, PLAN_DATE));
    expect(outcome.existing).toBe(true);
  });

  it('(QA-3) a complete that won reports existing false', async () => {
    const s = setup({ fallback: ok(defaultFallback('semiconductor')) });
    const outcome = expectOk(await runPrepare(s.deps, USER, PLAN_DATE));
    expect(outcome.existing).toBe(false);
    expect(outcome.plan.status).toBe('ready');
  });
});

describe('card order and refill (QA-4)', () => {
  const fallback = ok(defaultFallback('semiconductor'));

  it('(QA-4) card_ids list the due old cards before the new cards', async () => {
    const s = setup({ fallback, cards: [newCard(1), dueCard(2, '2026-11-20')] });
    expectOk(await preparePlan(s.deps, USER, PLAN_DATE));
    expect(s.state.completed[0]?.cardIds).toEqual([cardId(2), cardId(1)]);
  });

  it('(QA-4) a refill never takes a card outside the first selection that has no example and no meaning', async () => {
    const cards = [
      newCard(1, { exampleEn: null, meaningZh: null }),
      ...Array.from({ length: 24 }, (_, i) => newCard(i + 2)),
      newCard(26, { exampleEn: null, meaningZh: null }),
    ];
    const s = setup({ fallback, cards });
    expectOk(await preparePlan(s.deps, USER, PLAN_DATE));
    const ids = s.state.completed[0]?.cardIds;
    expect(ids).toHaveLength(24);
    expect(ids).not.toContain(cardId(1));
    expect(ids).not.toContain(cardId(26));
  });

  it('(QA-4) whitespace-only example and meaning count as missing for the refill', async () => {
    const cards = [
      newCard(1, { exampleEn: null, meaningZh: null }),
      ...Array.from({ length: 24 }, (_, i) => newCard(i + 2)),
      newCard(26, { exampleEn: '   ', meaningZh: ' ' }),
    ];
    const s = setup({ fallback, cards });
    expectOk(await preparePlan(s.deps, USER, PLAN_DATE));
    const ids = s.state.completed[0]?.cardIds;
    expect(ids).toHaveLength(24);
    expect(ids).not.toContain(cardId(26));
  });
});

describe('makeTestPlanDeps defaults (QA-11)', () => {
  it('(QA-11) the default fetch rejects with not stubbed', async () => {
    await expect(makeTestPlanDeps().fetch('https://example.invalid/', {})).rejects.toThrow('not stubbed: fetch');
  });
});

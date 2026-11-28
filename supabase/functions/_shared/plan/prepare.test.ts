import {
  err,
  ok,
  toApiErrorBody,
  UserIdSchema,
  type LlmProvider,
  type LlmRequest,
  type NewsCategory,
  type ProviderError,
  type Result,
} from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { FEEDS, FIXTURE_NOW, fakeFetch, recordedWeb, type Route } from '../news/test/fixtures.ts';
import { goodRaw } from '../news/test/rewrite-samples.ts';
import { JUDGE_PROMPT } from '../news/rewrite.ts';
import type { NewsSource } from '../news/types.ts';
import { claimPlan, CLAIM_LEASE_SECONDS, preparePlan, runPrepare } from './prepare.ts';
import {
  cardId,
  date,
  dbFailed,
  defaultFallback,
  dueCard,
  memStore,
  newCard,
  questionId,
  type MemOptions,
} from './test/mem-store.ts';
import { makeTestPlanDeps } from './test/plan-deps.ts';

const USER = UserIdSchema.parse('00000000-0000-4000-8000-0000000000aa');

const PLAN_DATE = date('2026-11-24'); // anchor 2026-11-22 + 2 days → semiconductor
const NOW = FIXTURE_NOW; // 2026-11-24T13:00:00Z (Taipei 21:00)
const MODEL = 'gemini-3.5-flash-lite' as const;

const source = (id: string, category: NewsSource['category'], priority: 1 | 2 | 3, feedUrl: string, fetchMode: NewsSource['fetchMode'] = 'rss_full'): NewsSource => ({
  id,
  name: id,
  feedUrl,
  category,
  priority,
  fetchMode,
  includeUrlPattern: null,
  enabled: true,
});
const SOURCES: readonly NewsSource[] = [
  source('tns-ai', 'ai', 1, FEEDS.tnsAi.url),
  source('sdtimes', 'software', 1, FEEDS.sdTimes.url),
  source('semieng', 'semiconductor', 1, FEEDS.semiEngineering.url),
];

const perr = (kind: ProviderError['kind']): ProviderError =>
  kind === 'rate_limited'
    ? { kind, provider: 'gemini', capability: 'llm', message: 'fake', retryAfterSec: 30 }
    : kind === 'quota_exhausted'
      ? { kind, provider: 'gemini', capability: 'llm', message: 'fake', retryAfterSec: null }
      : kind === 'paid_not_allowed'
        ? { kind, provider: 'gemini', capability: 'llm', message: 'fake', reason: 'no_consent' }
        : { kind, provider: 'gemini', capability: 'llm', message: 'fake' };

type LlmScript = { readonly judge?: Result<boolean, ProviderError>; readonly rewrite?: Result<unknown, ProviderError> };

/** A fake LlmProvider that answers the judge prompt and the rewrite prompt separately (validated by the request's own schema, like an adapter). */
function scriptedLlm(script: LlmScript = {}): { llm: LlmProvider; judged: () => number; rewritten: () => number } {
  let judged = 0;
  let rewritten = 0;
  const llm: LlmProvider = {
    id: 'gemini',
    capability: 'llm',
    tier: 'free',
    displayName: 'Fake',
    generate<T>(req: LlmRequest<T>): Promise<Result<T, ProviderError>> {
      const isJudge = req.system === JUDGE_PROMPT;
      if (isJudge) judged += 1;
      else rewritten += 1;
      const reply = isJudge
        ? (script.judge ?? ok(true))
        : (script.rewrite ?? ok(goodRaw()));
      if (!reply.ok) return Promise.resolve(err(reply.error));
      const raw = isJudge ? { category_match: reply.value } : reply.value;
      const parsed = req.schema.safeParse(raw);
      return Promise.resolve(parsed.success ? ok(parsed.data) : err(perr('invalid_response')));
    },
    stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }) }),
  };
  return { llm, judged: () => judged, rewritten: () => rewritten };
}

function setup(opts: MemOptions & { readonly web?: Record<string, Route>; readonly script?: LlmScript | 'none' } = {}) {
  const { store, state } = memStore({ sources: SOURCES, ...opts });
  const web = fakeFetch(opts.web ?? {});
  const llm = opts.script === 'none' ? null : scriptedLlm(opts.script ?? {});
  const deps = makeTestPlanDeps({
    store,
    llm: llm === null ? err(perr('not_configured')) : ok({ llm: llm.llm, model: MODEL }),
    fetch: web.fetch,
    now: () => NOW,
  });
  return { deps, state, store, web, llm };
}

const run = async (s: ReturnType<typeof setup>) => preparePlan(s.deps, USER, PLAN_DATE);

describe('claimPlan (§4.13.2)', () => {
  const ago = (sec: number): string => new Date(NOW.getTime() - sec * 1000).toISOString();
  const pending = (claimedAt: string) => ({ plan: { status: 'pending' as const, planDate: PLAN_DATE }, claimedAt });

  it('(AC-T25-3) (TC-5) a successful insert is claimed with the claimedAt that was written', async () => {
    const s = setup();
    const r = expectOk(await claimPlan(s.deps, USER, PLAN_DATE));
    expect(r).toEqual({ kind: 'claimed', claimedAt: NOW.toISOString() });
    expect(s.state.inserted[0]?.claimedAt).toBe(NOW.toISOString());
  });

  it('(AC-T25-3) (TC-5) a ready plan is existing and nothing is written', async () => {
    const s = setup({ fallback: ok(defaultFallback('semiconductor')) });
    expect(expectOk(await run(s)).status).toBe('ready'); // the first run completes the plan
    const again = expectOk(await claimPlan(s.deps, USER, PLAN_DATE));
    expect(again.kind).toBe('existing');
    expect(again.kind === 'existing' ? again.plan.status : null).toBe('ready');
    expect(s.state.reclaimed).toHaveLength(0);
    expect(s.state.completed).toHaveLength(1);
  });

  it('(AC-T25-3) (TC-5) failed and an expired pending (181 s) are reclaimed; the lease constant is 180', async () => {
    expect(CLAIM_LEASE_SECONDS).toBe(180);
    const failure = { step: 'news' as const, error: toApiErrorBody({ kind: 'internal', message: 'm' }).error, timeout_sec: null, failed_at: NOW.toISOString() };
    const failed = setup({ row: { plan: { status: 'failed', planDate: PLAN_DATE, failure }, claimedAt: ago(5) } });
    expect(expectOk(await claimPlan(failed.deps, USER, PLAN_DATE)).kind).toBe('claimed');
    const expired = setup({ row: pending(ago(181)) });
    expect(expectOk(await claimPlan(expired.deps, USER, PLAN_DATE)).kind).toBe('claimed');
    expect(expired.state.reclaimed[0]).toEqual({
      planDate: PLAN_DATE,
      claimedAt: NOW.toISOString(),
      staleBefore: ago(180),
    });
  });

  it('(AC-T25-3) (TC-5) an expired pending whose reclaim loses is existing pending; a 179 s pending is existing pending without reclaim', async () => {
    const lost = setup({ row: pending(ago(181)), reclaimResult: false });
    expect(expectOk(await claimPlan(lost.deps, USER, PLAN_DATE))).toEqual({ kind: 'existing', plan: { status: 'pending', planDate: PLAN_DATE } });
    const fresh = setup({ row: pending(ago(179)) });
    expect(expectOk(await claimPlan(fresh.deps, USER, PLAN_DATE))).toEqual({ kind: 'existing', plan: { status: 'pending', planDate: PLAN_DATE } });
    expect(fresh.state.reclaimed).toHaveLength(0);
  });
});

describe('the writes of preparePlan', () => {
  it('(AC-T25-4) (TC-6) when complete returns false the result is thrown away and readPlan is returned; fail false too', async () => {
    const taken = { status: 'pending' as const, planDate: PLAN_DATE };
    const a = setup({ fallback: ok(defaultFallback('semiconductor')), completeResult: ok(false) });
    const afterA = await run(a);
    expect(a.state.completed).toHaveLength(1);
    // readPlan still returns the row the claim wrote (pending), the competing result is not overwritten.
    expect(expectOk(afterA)).toEqual(taken);

    const b = setup({ cards: [], overrides: { listCardCandidates: () => Promise.resolve(err(dbFailed())) }, failResult: ok(false) });
    const afterB = await run(b);
    expect(b.state.failed).toHaveLength(1);
    expect(expectOk(afterB)).toEqual(taken);
  });

  it('(AC-T25-4) (TC-7) a db error becomes failed + failure (step cards, then save); error column equals failure.error.kind', async () => {
    const cards = setup({ fallback: ok(defaultFallback('semiconductor')), overrides: { listCardCandidates: () => Promise.resolve(err(dbFailed())) } });
    const r1 = expectOk(await run(cards));
    expect(r1.status).toBe('failed');
    const f1 = cards.state.failed[0]?.failure;
    expect(f1).toMatchObject({ step: 'cards', timeout_sec: null, failed_at: NOW.toISOString() });
    expect(f1?.error.kind).toBe('db_failed');
    expect(r1.status === 'failed' ? r1.failure : null).toEqual(f1);

    const save = setup({ fallback: ok(defaultFallback('semiconductor')), completeResult: err(dbFailed()) });
    const r2 = expectOk(await run(save));
    expect(r2.status).toBe('failed');
    const f2 = save.state.failed[0]?.failure;
    expect(f2).toMatchObject({ step: 'save', timeout_sec: null, failed_at: NOW.toISOString() });
    expect(f2?.error.kind).toBe('db_failed');
  });
});

describe('news selection (§11.2, §11.3.5)', () => {
  it('(AC-T25-5) (TC-8) news_unavailable moves to the next category and is recorded in category_skipped', async () => {
    const semiconductorFeeds = new Set<string>([FEEDS.semiEngineering.url, FEEDS.eeNews.url, FEEDS.semiDigest.url]);
    const routes = Object.fromEntries(Object.entries(recordedWeb()).filter(([url]) => !semiconductorFeeds.has(url)));
    const s = setup({ web: routes });
    const plan = expectOk(await run(s));
    expect(plan.status).toBe('ready');
    const done = s.state.completed[0];
    expect(done?.actualCategory).toBe('ai');
    expect(done?.categorySkipped).toEqual(['semiconductor']);
    expect(done?.isFallbackArticle).toBe(false);
    expect(s.state.inserted[0]?.plannedCategory).toBe('semiconductor');
  });

  it('(AC-T25-5) (TC-9) planned_category follows rotation_order from the anchor date (day 0, 1, 2)', async () => {
    const seen: NewsCategory[] = [];
    for (const d of ['2026-11-22', '2026-11-23', '2026-11-24']) {
      const s = setup();
      await claimPlan(s.deps, USER, date(d));
      const planned = s.state.inserted[0]?.plannedCategory;
      if (planned !== undefined) seen.push(planned);
    }
    expect(seen).toEqual(['ai', 'software', 'semiconductor']);
  });

  it('(AC-T25-6) (TC-10) a failing judge, a failing rewrite and a missing LLM all use the older article and do not try the next category', async () => {
    const cases: readonly (readonly [string, LlmScript | 'none'])[] = [
      ['judge rate_limited', { judge: err(perr('rate_limited')) }],
      ['rewrite invalid_response', { rewrite: ok({ sentences: [], chunks: [] }) }],
      ['llm not_configured', 'none'],
    ];
    for (const [name, script] of cases) {
      const s = setup({ web: recordedWeb(), script, fallback: ok(defaultFallback('semiconductor')) });
      const plan = expectOk(await run(s));
      expect(plan.status, name).toBe('ready');
      expect(s.state.completed[0]?.isFallbackArticle, name).toBe(true);
      const asked = s.web.calls.map((c) => c.url);
      expect(asked.some((u) => u.includes('thenewstack.io/ai')), name).toBe(false);
      expect(asked.some((u) => u.includes('sdtimes.com')), name).toBe(false);
    }
  });

  it('(AC-T25-6) (TC-11) three empty categories use the unread older article of the planned category; skipped lists all three', async () => {
    const asked: NewsCategory[] = [];
    const s = setup({
      overrides: {
        readFallbackArticle: (planned) => {
          asked.push(planned);
          return Promise.resolve(ok(defaultFallback(planned)));
        },
      },
    });
    expectOk(await run(s));
    expect(asked).toEqual(['semiconductor']);
    const done = s.state.completed[0];
    expect(done?.isFallbackArticle).toBe(true);
    expect(done?.actualCategory).toBe('semiconductor');
    expect(done?.categorySkipped).toEqual(['semiconductor', 'ai', 'software']);
  });

  it('(AC-T25-6) (TC-12) no article at all is failed: step news / news_unavailable, or step rewrite with the LLM error and 30 s', async () => {
    const none = setup({ fallback: ok(null) });
    const r1 = expectOk(await run(none));
    expect(r1.status).toBe('failed');
    const f1 = none.state.failed[0]?.failure;
    expect(f1?.step).toBe('news');
    expect(f1?.error.kind).toBe('news_unavailable');
    expect(f1?.timeout_sec).toBeNull();

    const slow = setup({ web: recordedWeb(), script: { rewrite: err(perr('timeout')) }, fallback: ok(null) });
    const r2 = expectOk(await run(slow));
    expect(r2.status).toBe('failed');
    const f2 = slow.state.failed[0]?.failure;
    expect(f2?.step).toBe('rewrite');
    expect(f2?.error.kind).toBe('timeout');
    expect(f2?.timeout_sec).toBe(30);
    for (const [s, f] of [
      [none, f1],
      [slow, f2],
    ] as const) {
      expect(s.state.failed[0]?.failure.error.kind).toBe(f?.error.kind);
    }
  });

  it('(AC-T25-7) (TC-13) the new article is written with the candidate and rewrite fields', async () => {
    const s = setup({ web: recordedWeb() });
    expectOk(await run(s));
    const a = s.state.articles[0];
    expect(a).toBeDefined();
    expect(a?.sourceId).toBe('semieng');
    expect(a?.category).toBe('semiconductor');
    expect(a?.url).toBe('https://semiengineering.com/sample-chiplet-test/');
    expect(a?.title).toBe('Sample chiplet test story');
    expect(a?.publishedAt).toBe('2026-11-24T08:00:00.000Z');
    expect(a?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.content.sentences).toHaveLength(18);
    expect(a?.content.chunks).toHaveLength(5);
    expect(a?.content.rewritten_text.length).toBeGreaterThan(0);
  });
});

const ARTICLE_CHUNKS = [{ chunk: 'drive adoption', meaning_zh: '推動採用', sentence_index: 0 }];
const article = (sentences: readonly string[]) => ({ ...defaultFallback('semiconductor'), sentences, chunks: ARTICLE_CHUNKS });
const s6 = (tail: string): string => `one two three four five ${tail}`;

describe('shadow items (§4.6)', () => {
  it('(AC-T25-8) (TC-14) 5 of 8 sentences: chunk sentences first, too-short one dropped, tts_path null, all news', async () => {
    const sentences = [
      s6('alpha'),
      s6('beta'),
      'short one only four',
      `Costs drive adoption of ${s6('gamma')}`,
      s6('delta'),
      `They drive adoption of ${s6('epsilon')}`,
      s6('zeta'),
      s6('eta'),
    ];
    const s = setup({ fallback: ok(article(sentences)) });
    expectOk(await run(s));
    const items = s.state.completed[0]?.shadowItems ?? [];
    expect(items).toHaveLength(5);
    expect(items[0]?.text).toContain('drive adoption');
    expect(items[1]?.text).toContain('drive adoption');
    expect(items.map((i) => i.text)).not.toContain('short one only four');
    expect(items.every((i) => i.tts_path === null && i.source === 'news')).toBe(true);
  });

  const senior = (texts: readonly string[]) => texts.map((text) => ({ text, source: null }));
  const upgrade = (chunk: string) => ({ chunk, meaning_zh: '意思', example_en: `We ${chunk} now.`, senior_index: 0 });
  const FIVE = ['a1 a2 a3 a4 a5 a6', 'b1 b2 b3 b4 b5 b6', 'c1 c2 c3 c4 c5 c6', 'd1 d2 d3 d4 d5 d6', 'e1 e2 e3 e4 e5 e6'];
  const SENIOR_TEXTS = ['first plain sentence with six words', 'second line has the keep going chunk', 'third plain sentence with six words'];

  it('(AC-T25-8) (AC-T25-17) (TC-26) a parsable first-answer diagnosis gives 3 news + 2 rewrite sentences, chunk sentence first', async () => {
    const s = setup({
      fallback: ok(article(FIVE.concat(['f1 f2 f3 f4 f5 f6']))),
      rewriteSource: ok({
        diagnosis: { senior: senior(SENIOR_TEXTS) },
        upgradeChunks: [upgrade('keep going'), upgrade('plain one'), upgrade('plain two')],
      }),
    });
    const plan = expectOk(await run(s));
    expect(plan.status).toBe('ready');
    const items = s.state.completed[0]?.shadowItems ?? [];
    expect(items.map((i) => i.source)).toEqual(['news', 'news', 'news', 'rewrite', 'rewrite']);
    expect(items[3]?.text).toBe('second line has the keep going chunk');
    expect(s.state.failed).toHaveLength(0);
  });

  it('(AC-T25-17) (TC-26) no row, a db error, or an unparsable senior / upgrade_chunks falls back to 5 news sentences and the plan stays ready', async () => {
    const cases: readonly NonNullable<MemOptions['rewriteSource']>[] = [
      ok(null),
      err(dbFailed()),
      ok({ diagnosis: { senior: 'nope' }, upgradeChunks: [upgrade('keep going'), upgrade('a b'), upgrade('c d')] }),
      ok({ diagnosis: { senior: senior(SENIOR_TEXTS) }, upgradeChunks: [{ chunk: 'keep going' }] }),
    ];
    for (const rewriteSource of cases) {
      const s = setup({ fallback: ok(article(FIVE.concat(['f1 f2 f3 f4 f5 f6']))), rewriteSource });
      const plan = expectOk(await run(s));
      expect(plan.status).toBe('ready');
      const items = s.state.completed[0]?.shadowItems ?? [];
      expect(items).toHaveLength(5);
      expect(items.every((i) => i.source === 'news')).toBe(true);
      expect(s.state.failed).toHaveLength(0);
    }
  });
});

describe('cards and noon items (§4.14.5)', () => {
  const fallback = ok(article([]));

  it('(AC-T25-9) (TC-15) a postponed old card is dropped and the 16th old card fills in; 25 cards', async () => {
    const cards = [
      dueCard(1, '2026-11-01', { exampleEn: null, meaningZh: null }),
      ...Array.from({ length: 14 }, (_, i) => dueCard(i + 2, `2026-11-${String(i + 2).padStart(2, '0')}`)),
      dueCard(16, '2026-11-20'),
      ...Array.from({ length: 10 }, (_, i) => newCard(i + 21)),
    ];
    const s = setup({ fallback, cards });
    expectOk(await run(s));
    const ids = s.state.completed[0]?.cardIds ?? [];
    expect(ids).not.toContain(cardId(1));
    expect(ids).toContain(cardId(16));
    expect(ids).toHaveLength(25);
  });

  it('(AC-T25-9) (TC-16) a postponed new card is replaced by the next new card; noon_items follow card_ids', async () => {
    const cards = [newCard(1, { exampleEn: null, meaningZh: null }), ...Array.from({ length: 25 }, (_, i) => newCard(i + 2))];
    const s = setup({ fallback, cards });
    expectOk(await run(s));
    const done = s.state.completed[0];
    expect(done?.cardIds).toHaveLength(25);
    expect(done?.cardIds).not.toContain(cardId(1));
    expect(done?.cardIds).toContain(cardId(26));
    expect(done?.noonItems.map((n) => n.card_id)).toEqual(done?.cardIds);
  });

  it('(AC-T25-9) (TC-17) fewer than 25 cards are written as they are; the plan is ready; seed_remaining is null; no card is written', async () => {
    const cards = [newCard(1), newCard(2, { exampleEn: null, meaningZh: null }), newCard(3)];
    const s = setup({ fallback, cards });
    const plan = expectOk(await run(s));
    expect(plan.status).toBe('ready');
    expect(plan.status === 'ready' ? plan.seedRemaining : 'x').toBeNull();
    const done = s.state.completed[0];
    expect(done?.cardIds).toEqual([cardId(1), cardId(3)]);
    expect(done?.seedRemaining).toBeNull();
    const writes = Object.keys(s.store).filter((k) => /card/i.test(k) && !/list/i.test(k));
    expect(writes).toEqual([]);
  });

  it('(AC-T25-9) (TC-17) noon items hold only the rule-made cloze_en; no LLM call is made', async () => {
    const cards = [newCard(1)];
    const s = setup({ fallback, cards });
    expectOk(await run(s));
    const item = s.state.completed[0]?.noonItems[0];
    expect(item).toMatchObject({ card_id: cardId(1), cloze_en: 'Rising costs ____ of chiplets.', plain_en: null, distractors: null });
    expect(s.llm?.judged()).toBe(0);
    expect(s.llm?.rewritten()).toBe(0);
  });
});

describe('tonight question (§4.5)', () => {
  const fallback = ok(article([]));
  const q = (n: number, source: 'resume' | 'bank') => ({
    questionId: questionId(n),
    source,
    category: 'intro' as const,
    retired: false,
    timesAsked: 0,
    lastAskedDate: null,
  });

  it('(AC-T25-10) (TC-18) a resume question wins; otherwise the bank question; none leaves null and the plan ready', async () => {
    const withResume = setup({ fallback, questions: ok([q(1, 'bank'), q(2, 'resume')]) });
    expectOk(await run(withResume));
    expect(withResume.state.completed[0]?.tonightQuestionId).toBe(questionId(2));

    const bankOnly = setup({ fallback, questions: ok([q(1, 'bank')]) });
    expectOk(await run(bankOnly));
    expect(bankOnly.state.completed[0]?.tonightQuestionId).toBe(questionId(1));

    const empty = setup({ fallback, questions: ok([]) });
    const plan = expectOk(await run(empty));
    expect(plan.status).toBe('ready');
    expect(empty.state.completed[0]?.tonightQuestionId).toBeNull();
  });
});

describe('runPrepare', () => {
  it('(AC-T25-14) (TC-5) reports existing when somebody else already holds the plan', async () => {
    const s = setup({ row: { plan: { status: 'pending', planDate: PLAN_DATE }, claimedAt: NOW.toISOString() } });
    const r = expectOk(await runPrepare(s.deps, USER, PLAN_DATE));
    expect(r.existing).toBe(true);
    expect(s.state.completed).toHaveLength(0);
  });

  it('(AC-T25-4) (TC-7) a failing store at the claim step is an error, not a failed plan', async () => {
    const s = setup({ overrides: { insertPending: () => Promise.resolve(err(dbFailed())) } });
    expect(expectErr(await run(s)).kind).toBe('db_failed');
  });
});

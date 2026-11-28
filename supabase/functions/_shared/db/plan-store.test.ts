import { ArticleIdSchema, CardIdSchema, PlanDateSchema, UserIdSchema, type PlanFailure } from '@english-coach/contracts';
import { expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { planDbClientFrom, type DbResponse, type PlanDbClient, type PlanQuery } from './client.ts';
import { listProfileUserIds } from './service-db.ts';
import { planStoreFrom, type PlanStore } from './plan-store.ts';

const USER = UserIdSchema.parse('00000000-0000-4000-8000-0000000000aa');
const PLAN_DATE = PlanDateSchema.parse('2026-11-28');
const CLAIMED_AT = '2026-11-28T05:00:00.000Z';
const STALE_BEFORE = '2026-11-28T04:57:00.000Z';

type Op = { readonly method: string; readonly args: readonly unknown[] };
type Call = { readonly table: string; readonly ops: Op[] };

/** A client that records every chain and answers each with `respond`. */
function recording(respond: (call: Call) => DbResponse<unknown>): { client: PlanDbClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: PlanDbClient = {
    from: (table) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const q: PlanQuery = {
        then: (onfulfilled, onrejected) => Promise.resolve(respond(call)).then(onfulfilled, onrejected),
        select: (...args) => (call.ops.push({ method: 'select', args }), q),
        insert: (...args) => (call.ops.push({ method: 'insert', args }), q),
        upsert: (...args) => (call.ops.push({ method: 'upsert', args }), q),
        update: (...args) => (call.ops.push({ method: 'update', args }), q),
        eq: (...args) => (call.ops.push({ method: 'eq', args }), q),
        is: (...args) => (call.ops.push({ method: 'is', args }), q),
        not: (...args) => (call.ops.push({ method: 'not', args }), q),
        lt: (...args) => (call.ops.push({ method: 'lt', args }), q),
        gte: (...args) => (call.ops.push({ method: 'gte', args }), q),
        lte: (...args) => (call.ops.push({ method: 'lte', args }), q),
        or: (...args) => (call.ops.push({ method: 'or', args }), q),
        order: (...args) => (call.ops.push({ method: 'order', args }), q),
        limit: (...args) => (call.ops.push({ method: 'limit', args }), q),
        maybeSingle: (...args) => (call.ops.push({ method: 'maybeSingle', args }), q),
      };
      return q;
    },
  };
  return { client, calls };
}

const emptyAnswer = (call: Call): DbResponse<unknown> => ({
  data: call.ops.some((o) => o.method === 'maybeSingle') ? null : [],
  error: null,
});

const has = (call: Call, method: string, ...args: readonly unknown[]): boolean =>
  call.ops.some((o) => o.method === method && args.every((a, i) => o.args[i] === a));

const USER_TABLES = ['card', 'card_review', 'daily_plan', 'profile', 'evening_answer', 'question', 'news_article'];
const OR_OWN_OR_SHARED = `user_id.eq.${USER},user_id.is.null`;

/** CLAUDE.md §5 #15 / §4.12.5: every query on a user table carries the user id (questions: own or shared). */
function scopedToUser(call: Call): boolean {
  if (!USER_TABLES.includes(call.table)) return true;
  if (has(call, 'eq', 'user_id', USER)) return true;
  if (call.table === 'question' && has(call, 'or', OR_OWN_OR_SHARED)) return true;
  const row = call.ops.find((o) => o.method === 'upsert' || o.method === 'insert')?.args[0];
  return typeof row === 'object' && row !== null && 'user_id' in row && row.user_id === USER;
}

const FAILURE: PlanFailure = {
  step: 'news',
  error: { kind: 'news_unavailable', message: 'none', retryable: true },
  timeout_sec: null,
  failed_at: CLAIMED_AT,
};

const everyMethod = (store: PlanStore): readonly (() => Promise<unknown>)[] => [
  () => store.insertPending({ planDate: PLAN_DATE, plannedCategory: 'ai', claimedAt: CLAIMED_AT }),
  () => store.readPlan(PLAN_DATE),
  () => store.reclaim({ planDate: PLAN_DATE, claimedAt: CLAIMED_AT, staleBefore: STALE_BEFORE }),
  () =>
    store.complete({
      planDate: PLAN_DATE,
      claimedAt: CLAIMED_AT,
      actualCategory: 'ai',
      categorySkipped: [],
      articleId: ArticleIdSchema.parse('33333333-3333-4333-8333-333333333333'),
      isFallbackArticle: false,
      shadowItems: [],
      noonItems: [],
      cardIds: [CardIdSchema.parse('11111111-1111-4111-8111-111111111111')],
      tonightQuestionId: null,
      seedRemaining: null,
    }),
  () => store.fail({ planDate: PLAN_DATE, claimedAt: CLAIMED_AT, failure: FAILURE }),
  () => store.readNewsSettings(),
  () => store.listNewsSources(),
  () => store.isArticleUsed({ url: 'https://example.invalid/a', sha256: 'a'.repeat(64) }),
  () =>
    store.insertArticle({
      sourceId: 's',
      category: 'ai',
      url: 'https://example.invalid/a',
      sha256: 'a'.repeat(64),
      title: 't',
      publishedAt: CLAIMED_AT,
      content: { rewritten_text: 'x', sentences: ['x'], chunks: [] },
    }),
  () => store.readFallbackArticle('ai'),
  () => store.listCardCandidates(),
  () => store.listQuestionCandidates(),
  () => store.readRewriteSource(PLAN_DATE),
];

describe('PlanStore queries carry user_id (§4.12.5)', () => {
  it('(AC-T25-6) (TC-23) readFallbackArticle: unread only, planned category first, newest first; reclaim and complete keep their conditions', async () => {
    const { client, calls } = recording(emptyAnswer);
    const store = planStoreFrom(client, USER);
    expectOk(await store.readFallbackArticle('software'));
    const [first, second] = calls;
    expect(first?.table).toBe('news_article');
    for (const call of [first, second]) {
      expect(call && has(call, 'eq', 'user_id', USER)).toBe(true);
      expect(call && has(call, 'is', 'read_at', null)).toBe(true);
      expect(call?.ops.some((o) => o.method === 'order' && o.args[0] === 'published_at' && JSON.stringify(o.args[1]) === '{"ascending":false}')).toBe(true);
    }
    expect(first && has(first, 'eq', 'category', 'software')).toBe(true);
    expect(second && has(second, 'eq', 'category')).toBe(false);

    const more = recording(() => ({ data: [{ plan_date: '2026-11-28' }], error: null }));
    const s2 = planStoreFrom(more.client, USER);
    expect(expectOk(await s2.reclaim({ planDate: PLAN_DATE, claimedAt: CLAIMED_AT, staleBefore: STALE_BEFORE }))).toBe(true);
    const reclaim = more.calls[0];
    expect(reclaim && has(reclaim, 'eq', 'user_id', USER) && has(reclaim, 'eq', 'plan_date', PLAN_DATE)).toBe(true);
    expect(reclaim && has(reclaim, 'or', `status.eq.failed,and(status.eq.pending,claimed_at.lt.${STALE_BEFORE})`)).toBe(true);
    expect(reclaim?.ops.find((o) => o.method === 'update')?.args[0]).toEqual({ status: 'pending', error: null, failure: null, claimed_at: CLAIMED_AT });

    const done = recording(() => ({ data: [], error: null }));
    const s3 = planStoreFrom(done.client, USER);
    expect(expectOk(await s3.complete(everyArgsComplete()))).toBe(false);
    const complete = done.calls[0];
    expect(complete && has(complete, 'eq', 'status', 'pending') && has(complete, 'eq', 'claimed_at', CLAIMED_AT)).toBe(true);
    expect(complete && has(complete, 'eq', 'user_id', USER)).toBe(true);
  });

  it('(AC-T25-17) (AC-T25-18) (TC-27) every query of every function on a user table has eq user_id (questions: the or filter)', async () => {
    const { client, calls } = recording(emptyAnswer);
    const store = planStoreFrom(client, USER);
    for (const run of everyMethod(store)) await run();
    expect(calls.length).toBeGreaterThan(12);
    for (const call of calls) expect(scopedToUser(call), `${call.table} ${JSON.stringify(call.ops)}`).toBe(true);
    const tables = new Set(calls.map((c) => c.table));
    for (const t of ['daily_plan', 'profile', 'news_article', 'card', 'question', 'evening_answer']) expect(tables.has(t), t).toBe(true);
  });

  it('(AC-T25-18) (TC-27) a ready plan reads its article and question with user_id too', async () => {
    const respond = (call: Call): DbResponse<unknown> => {
      if (call.table === 'daily_plan') {
        return {
          data: {
            plan_date: '2026-11-28',
            planned_category: 'ai',
            actual_category: 'ai',
            category_skipped: [],
            article_id: '33333333-3333-4333-8333-333333333333',
            is_fallback_article: false,
            shadow_items: [],
            noon_items: [],
            card_ids: [],
            tonight_question_id: '44444444-4444-4444-8444-444444444444',
            status: 'ready',
            failure: null,
            claimed_at: CLAIMED_AT,
            seed_remaining: null,
          },
          error: null,
        };
      }
      if (call.table === 'news_article') {
        return {
          data: { id: '33333333-3333-4333-8333-333333333333', source_id: 'src', title: 'T', original_url: 'https://example.invalid/a', rewritten_text: 'x', sentences: ['x'], chunks: [] },
          error: null,
        };
      }
      if (call.table === 'news_source') return { data: { id: 'src', name: 'Source' }, error: null };
      return { data: { id: '44444444-4444-4444-8444-444444444444', text: 'Tell me.', category: 'intro' }, error: null };
    };
    const { client, calls } = recording(respond);
    const stored = expectOk(await planStoreFrom(client, USER).readPlan(PLAN_DATE));
    expect(stored?.plan.status).toBe('ready');
    expect(stored?.plan.status === 'ready' ? stored.plan.article.sourceName : null).toBe('Source');
    expect(calls.map((c) => c.table)).toEqual(['daily_plan', 'news_article', 'news_source', 'question']);
    for (const call of calls) expect(scopedToUser(call), call.table).toBe(true);
  });

  it('(AC-T25-17) (TC-27) readRewriteSource: Taipei previous day, kind first, diagnosis not null, newest one row', async () => {
    const { client, calls } = recording(() => ({ data: { diagnosis: { senior: [] }, upgrade_chunks: [] }, error: null }));
    const r = expectOk(await planStoreFrom(client, USER).readRewriteSource(PLAN_DATE));
    expect(r).toEqual({ diagnosis: { senior: [] }, upgradeChunks: [] });
    const call = calls[0];
    expect(call?.table).toBe('evening_answer');
    expect(call?.ops.find((o) => o.method === 'select')?.args[0]).toBe('diagnosis, upgrade_chunks');
    expect(call && has(call, 'eq', 'user_id', USER) && has(call, 'eq', 'kind', 'first')).toBe(true);
    expect(call && has(call, 'not', 'diagnosis', 'is', null)).toBe(true);
    expect(call && has(call, 'gte', 'created_at', '2026-11-27T00:00:00+08:00')).toBe(true);
    expect(call && has(call, 'lt', 'created_at', '2026-11-28T00:00:00+08:00')).toBe(true);
    expect(call?.ops.some((o) => o.method === 'order' && o.args[0] === 'created_at' && JSON.stringify(o.args[1]) === '{"ascending":false}')).toBe(true);
    expect(call && has(call, 'limit', 1)).toBe(true);
  });

  it('(AC-T25-18) (TC-27) listProfileUserIds selects only user_id', async () => {
    const { client, calls } = recording(() => ({ data: [{ user_id: USER }], error: null }));
    expect(expectOk(await listProfileUserIds(client))).toEqual([USER]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe('profile');
    expect(calls[0]?.ops).toEqual([{ method: 'select', args: ['user_id'] }]);
  });

  it('(AC-T25-18) (TC-27) errors are db_failed with no row data in the message', async () => {
    const { client } = recording(() => ({ data: null, error: { code: '42501', message: 'secret row text' } }));
    const r = await planStoreFrom(client, USER).readNewsSettings();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('secret row text');
  });

  it('(AC-T25-18) planDbClientFrom hands the supabase builder through and never throws on an odd one', async () => {
    const marker = { tag: 'builder' };
    expect(planDbClientFrom({ from: () => marker }).from('x')).toBe(marker);
    const broken = planDbClientFrom({ from: () => 1 }).from('x');
    const res = await broken.select('a').eq('b', 'c').order('d').limit(1).maybeSingle();
    expect(res.error?.message).toBe('unexpected query builder');
  });
});

function everyArgsComplete(): Parameters<PlanStore['complete']>[0] {
  return {
    planDate: PLAN_DATE,
    claimedAt: CLAIMED_AT,
    actualCategory: 'ai',
    categorySkipped: [],
    articleId: ArticleIdSchema.parse('33333333-3333-4333-8333-333333333333'),
    isFallbackArticle: false,
    shadowItems: [],
    noonItems: [],
    cardIds: [],
    tonightQuestionId: null,
    seedRemaining: null,
  };
}

// QA probes for the T-025a PlanStore (QA-5) and listProfileUserIds (QA-6): exact write payloads, filters and row mapping.
import { ArticleIdSchema, CardIdSchema, PlanDateSchema, QuestionIdSchema, UserIdSchema, type PlanFailure } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import type { DbResponse, PlanDbClient, PlanQuery } from './client.ts';
import { planStoreFrom, type CompleteInput } from './plan-store.ts';
import { listProfileUserIds } from './service-db.ts';

const USER = UserIdSchema.parse('00000000-0000-4000-8000-0000000000ab');
const PLAN_DATE = PlanDateSchema.parse('2026-11-28');
const CLAIMED_AT = '2026-11-28T05:00:00.000Z';
const QUESTION = '44444444-4444-4444-8444-444444444444';

type Op = { readonly method: string; readonly args: readonly unknown[] };
type Call = { readonly table: string; readonly ops: Op[] };

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

const has = (call: Call | undefined, method: string, ...args: readonly unknown[]): boolean =>
  call !== undefined && call.ops.some((o) => o.method === method && args.every((a, i) => o.args[i] === a));
const argsOf = (call: Call | undefined, method: string): readonly unknown[] | undefined => call?.ops.find((o) => o.method === method)?.args;

const FAILURE: PlanFailure = {
  step: 'rewrite',
  error: { kind: 'timeout', message: 'slow', retryable: true },
  timeout_sec: 30,
  failed_at: CLAIMED_AT,
};

const COMPLETE: CompleteInput = {
  planDate: PLAN_DATE,
  claimedAt: CLAIMED_AT,
  actualCategory: 'software',
  categorySkipped: ['ai'],
  articleId: ArticleIdSchema.parse('33333333-3333-4333-8333-333333333333'),
  isFallbackArticle: false,
  shadowItems: [{ source: 'news', text: 'One sentence.', tts_path: null }],
  noonItems: [
    {
      card_id: CardIdSchema.parse('11111111-1111-4111-8111-111111111111'),
      plain_en: null,
      cloze_en: 'A ____.',
      distractors: null,
      context_zh: null,
      blocks: null,
      shuffled_order: null,
    },
  ],
  cardIds: [CardIdSchema.parse('11111111-1111-4111-8111-111111111111')],
  tonightQuestionId: QuestionIdSchema.parse(QUESTION),
  seedRemaining: 7,
};

const oneRow = (): DbResponse<unknown> => ({ data: [{ plan_date: '2026-11-28' }], error: null });

describe('PlanStore writes (QA-5)', () => {
  it('(QA-5) insertPending upserts with ignoreDuplicates true', async () => {
    const { client, calls } = recording(oneRow);
    expect(expectOk(await planStoreFrom(client, USER).insertPending({ planDate: PLAN_DATE, plannedCategory: 'ai', claimedAt: CLAIMED_AT }))).toBe(true);
    expect(argsOf(calls[0], 'upsert')?.[1]).toEqual({ onConflict: 'user_id,plan_date', ignoreDuplicates: true });
  });

  it('(QA-5) complete writes every column, clears failure and error', async () => {
    const { client, calls } = recording(oneRow);
    expect(expectOk(await planStoreFrom(client, USER).complete(COMPLETE))).toBe(true);
    expect(argsOf(calls[0], 'update')?.[0]).toEqual({
      status: 'ready',
      actual_category: 'software',
      category_skipped: ['ai'],
      article_id: COMPLETE.articleId,
      is_fallback_article: false,
      shadow_items: COMPLETE.shadowItems,
      noon_items: COMPLETE.noonItems,
      card_ids: COMPLETE.cardIds,
      tonight_question_id: QUESTION,
      seed_remaining: 7,
      error: null,
      failure: null,
    });
  });

  it('(QA-5) fail writes error = failure.error.kind and keeps the pending + claimed_at conditions', async () => {
    const { client, calls } = recording(oneRow);
    expect(expectOk(await planStoreFrom(client, USER).fail({ planDate: PLAN_DATE, claimedAt: CLAIMED_AT, failure: FAILURE }))).toBe(true);
    const call = calls[0];
    expect(argsOf(call, 'update')?.[0]).toEqual({ status: 'failed', error: 'timeout', failure: FAILURE });
    expect(has(call, 'eq', 'user_id', USER) && has(call, 'eq', 'plan_date', PLAN_DATE)).toBe(true);
    expect(has(call, 'eq', 'status', 'pending')).toBe(true);
    expect(has(call, 'eq', 'claimed_at', CLAIMED_AT)).toBe(true);
  });
});

describe('PlanStore reads (QA-5)', () => {
  it('(QA-5) news settings: a profile without settings.news uses the defaults; an invalid one is internal', async () => {
    const none = recording(() => ({ data: { settings: {} }, error: null }));
    const defaults = expectOk(await planStoreFrom(none.client, USER).readNewsSettings());
    expect(defaults.rotation_order).toEqual(['ai', 'software', 'semiconductor']);
    const bad = recording(() => ({ data: { settings: { news: { lookback_hours: 'many' } } }, error: null }));
    expect(expectErr(await planStoreFrom(bad.client, USER).readNewsSettings()).kind).toBe('internal');
  });

  it('(QA-5) card candidates exclude mastered (the state filter is exact)', async () => {
    const { client, calls } = recording(() => ({ data: [], error: null }));
    expectOk(await planStoreFrom(client, USER).listCardCandidates());
    expect(argsOf(calls[0], 'or')).toEqual(['state.eq.collected,state.eq.learning,state.eq.reviewing']);
  });

  it('(QA-5) question candidates: retired excluded, only first answers counted, count and latest Taipei date per question', async () => {
    const respond = (call: Call): DbResponse<unknown> =>
      call.table === 'question'
        ? { data: [{ id: QUESTION, source: 'bank', category: 'intro', retired: false }], error: null }
        : {
            data: [
              { question_id: QUESTION, created_at: '2026-11-26T12:00:00Z' },
              { question_id: QUESTION, created_at: '2026-11-20T12:00:00Z' },
            ],
            error: null,
          };
    const { client, calls } = recording(respond);
    const out = expectOk(await planStoreFrom(client, USER).listQuestionCandidates());
    expect(out).toEqual([
      { questionId: QUESTION, source: 'bank', category: 'intro', retired: false, timesAsked: 2, lastAskedDate: '2026-11-26' },
    ]);
    const q = calls.find((c) => c.table === 'question');
    const a = calls.find((c) => c.table === 'evening_answer');
    expect(has(q, 'eq', 'retired', false)).toBe(true);
    expect(has(a, 'eq', 'kind', 'first')).toBe(true);
  });

  it('(QA-5) a pending row keeps its claimed_at', async () => {
    const { client } = recording(() => ({ data: { status: 'pending', claimed_at: CLAIMED_AT, plan_date: '2026-11-28' }, error: null }));
    expect(expectOk(await planStoreFrom(client, USER).readPlan(PLAN_DATE))).toEqual({
      plan: { status: 'pending', planDate: PLAN_DATE },
      claimedAt: CLAIMED_AT,
    });
  });

  it('(QA-5) a ready row maps seed_remaining', async () => {
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
            tonight_question_id: null,
            status: 'ready',
            failure: null,
            claimed_at: CLAIMED_AT,
            seed_remaining: 3,
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
      return { data: { id: 'src', name: 'Source' }, error: null };
    };
    const { client } = recording(respond);
    const stored = expectOk(await planStoreFrom(client, USER).readPlan(PLAN_DATE));
    expect(stored?.plan.status === 'ready' ? stored.plan.seedRemaining : 'x').toBe(3);
  });
});

describe('listProfileUserIds (QA-6)', () => {
  it('(QA-6) one bad row makes the whole read db_failed (no row is skipped)', async () => {
    const { client } = recording(() => ({ data: [{ user_id: USER }, { user_id: 'not-a-uuid' }], error: null }));
    expect(expectErr(await listProfileUserIds(client)).kind).toBe('db_failed');
  });
});

import { describe, expect, it } from 'vitest';
import { APP_ERROR_KINDS } from './errors.ts';
import {
  AnswerFailureSchema,
  DailyPlanSchema,
  NoonItemSchema,
  NoonItemsSchema,
  PLAN_FAILURE_STEPS,
  PlanFailureSchema,
  ShadowItemsSchema,
} from './plan.ts';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

const failure = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  step: 'news',
  error: { kind: 'news_unavailable', message: 'none', retryable: true },
  timeout_sec: null,
  failed_at: '2026-11-28T05:00:00+08:00',
  ...over,
});

const noonItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  card_id: UUID_A,
  plain_en: null,
  cloze_en: null,
  distractors: null,
  context_zh: null,
  blocks: null,
  shuffled_order: null,
  ...over,
});

const ready = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  status: 'ready',
  planDate: '2026-11-28',
  plannedCategory: 'ai',
  actualCategory: 'software',
  categorySkipped: ['ai'],
  isFallbackArticle: false,
  article: {
    id: UUID_B,
    title: 'T',
    sourceName: 'S',
    originalUrl: 'https://example.com/a',
    rewrittenText: 'text',
    sentences: ['one'],
    chunks: [{ chunk: 'drive adoption', meaning_zh: '推動採用', sentence_index: 0 }],
  },
  shadowItems: [{ source: 'news', text: 'A sentence.', tts_path: null }],
  noonItems: [noonItem()],
  cardIds: [UUID_A],
  tonightQuestion: { id: UUID_C, text: 'Tell me about yourself.', category: 'intro' },
  seedRemaining: null,
  ...over,
});

describe('daily_plan.error check list', () => {
  it('(AC-T25-15) (TC-24) APP_ERROR_KINDS is the list the migration check and tooling/t025a-static.test.ts spell out', () => {
    expect([...APP_ERROR_KINDS]).toEqual([
      'quota_exhausted',
      'rate_limited',
      'unavailable',
      'timeout',
      'auth',
      'region_blocked',
      'invalid_response',
      'not_configured',
      'paid_not_allowed',
      'validation',
      'unauthenticated',
      'not_found',
      'conflict',
      'storage_failed',
      'db_failed',
      'news_unavailable',
      'plan_not_ready',
      'internal',
    ]);
  });
});

describe('plan contracts', () => {
  it('(AC-T25-1) (TC-1) DailyPlanSchema accepts pending, ready and failed (with failure)', () => {
    expect(DailyPlanSchema.safeParse({ status: 'pending', planDate: '2026-11-28' }).success).toBe(true);
    expect(DailyPlanSchema.safeParse(ready()).success).toBe(true);
    expect(DailyPlanSchema.safeParse({ status: 'failed', planDate: '2026-11-28', failure: failure() }).success).toBe(true);
  });

  it('(AC-T25-1) (TC-1) failed needs failure; errorKind alone is rejected', () => {
    expect(DailyPlanSchema.safeParse({ status: 'failed', planDate: '2026-11-28', errorKind: 'internal' }).success).toBe(false);
  });

  it('(AC-T25-1) (TC-1) PlanFailureSchema: steps, timeout_sec positive, failed_at with offset', () => {
    expect(PLAN_FAILURE_STEPS).toContain('news');
    expect(PlanFailureSchema.safeParse(failure({ step: 'rss' })).success).toBe(false);
    expect(PlanFailureSchema.safeParse(failure({ timeout_sec: 0 })).success).toBe(false);
    expect(PlanFailureSchema.safeParse(failure({ timeout_sec: 30 })).success).toBe(true);
    expect(PlanFailureSchema.safeParse(failure({ failed_at: '2026-11-28 05:00' })).success).toBe(false);
  });

  it('(AC-T25-1) (TC-1) shadowItems max 5, noonItems max 25', () => {
    const shadow = { source: 'news', text: 'x', tts_path: null };
    expect(ShadowItemsSchema.safeParse(Array.from({ length: 5 }, () => shadow)).success).toBe(true);
    expect(ShadowItemsSchema.safeParse(Array.from({ length: 6 }, () => shadow)).success).toBe(false);
    expect(NoonItemsSchema.safeParse(Array.from({ length: 25 }, () => noonItem())).success).toBe(true);
    expect(NoonItemsSchema.safeParse(Array.from({ length: 26 }, () => noonItem())).success).toBe(false);
  });

  it('(AC-T25-1) (TC-1) distractors must be exactly 3, blocks 3 to 6', () => {
    expect(NoonItemSchema.safeParse(noonItem({ distractors: ['a', 'b', 'c'] })).success).toBe(true);
    expect(NoonItemSchema.safeParse(noonItem({ distractors: ['a', 'b'] })).success).toBe(false);
    expect(NoonItemSchema.safeParse(noonItem({ blocks: ['a', 'b', 'c'] })).success).toBe(true);
    expect(NoonItemSchema.safeParse(noonItem({ blocks: ['a', 'b'] })).success).toBe(false);
  });

  it('(AC-T25-1) (TC-1) NoonItemSchema has no temp_example_en or temp_meaning_zh', () => {
    expect(Object.keys(NoonItemSchema.shape)).not.toContain('temp_example_en');
    expect(Object.keys(NoonItemSchema.shape)).not.toContain('temp_meaning_zh');
  });

  it('(AC-T25-1) (TC-1) ready seedRemaining: null and 3 pass, -1 fails', () => {
    expect(DailyPlanSchema.safeParse(ready({ seedRemaining: null })).success).toBe(true);
    expect(DailyPlanSchema.safeParse(ready({ seedRemaining: 3 })).success).toBe(true);
    expect(DailyPlanSchema.safeParse(ready({ seedRemaining: -1 })).success).toBe(false);
  });

  it('(AC-T25-1) (TC-1) AnswerFailureSchema accepts a valid failure and rejects attempt 0', () => {
    const base = { step: 'stt', error: { kind: 'timeout', message: 'm', retryable: true }, failed_at: '2026-11-28T05:00:00Z', attempt: 1 };
    expect(AnswerFailureSchema.safeParse(base).success).toBe(true);
    expect(AnswerFailureSchema.safeParse({ ...base, attempt: 0 }).success).toBe(false);
  });
});

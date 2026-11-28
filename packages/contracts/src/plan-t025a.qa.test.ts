// QA probes for the T-025a plan shapes (QA-1): exact bounds of NoonItem, ShadowItem, PlanFailure and DailyPlan.
import { describe, expect, it } from 'vitest';
import { DailyPlanSchema, NoonItemSchema, PLAN_FAILURE_STEPS, PlanFailureSchema, ShadowItemSchema } from './plan.ts';

const CARD = '11111111-1111-4111-8111-111111111111';
const cardN = (n: number): string => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

const noon = (over: Record<string, unknown> = {}) => ({
  card_id: CARD,
  plain_en: null,
  cloze_en: null,
  distractors: null,
  context_zh: null,
  blocks: null,
  shuffled_order: null,
  ...over,
});

const ready = (cardIds: readonly string[]) => ({
  status: 'ready',
  planDate: '2026-11-28',
  plannedCategory: 'ai',
  actualCategory: 'ai',
  categorySkipped: [],
  isFallbackArticle: false,
  article: {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'T',
    sourceName: 'S',
    originalUrl: 'https://example.invalid/a',
    rewrittenText: 'x',
    sentences: ['x'],
    chunks: [],
  },
  shadowItems: [],
  noonItems: [],
  cardIds,
  tonightQuestion: null,
  seedRemaining: null,
});

describe('T-025a plan schemas (QA-1)', () => {
  it('(QA-1) blocks accept 3 and 6 elements and reject 2 and 7', () => {
    const blocks = (n: number) => Array.from({ length: n }, (_, i) => `b${String(i)}`);
    expect(NoonItemSchema.safeParse(noon({ blocks: blocks(3) })).success).toBe(true);
    expect(NoonItemSchema.safeParse(noon({ blocks: blocks(6) })).success).toBe(true);
    expect(NoonItemSchema.safeParse(noon({ blocks: blocks(2) })).success).toBe(false);
    expect(NoonItemSchema.safeParse(noon({ blocks: blocks(7) })).success).toBe(false);
  });

  it('(QA-1) shuffled_order holds non-negative integers only', () => {
    expect(NoonItemSchema.safeParse(noon({ shuffled_order: [0, 2, 1] })).success).toBe(true);
    expect(NoonItemSchema.safeParse(noon({ shuffled_order: [0.5, 1, 2] })).success).toBe(false);
    expect(NoonItemSchema.safeParse(noon({ shuffled_order: [-1, 0, 1] })).success).toBe(false);
  });

  it('(QA-1) a shadow item needs a non-empty text', () => {
    expect(ShadowItemSchema.safeParse({ source: 'news', text: 'x', tts_path: null }).success).toBe(true);
    expect(ShadowItemSchema.safeParse({ source: 'news', text: '', tts_path: null }).success).toBe(false);
  });

  it('(QA-1) the failure steps are exactly the seven of §5.9.2 and internal is accepted', () => {
    expect([...PLAN_FAILURE_STEPS]).toEqual(['news', 'rewrite', 'cards', 'noon', 'tts', 'save', 'internal']);
    const failure = {
      step: 'internal',
      error: { kind: 'internal', message: 'm', retryable: false },
      timeout_sec: null,
      failed_at: '2026-11-28T05:00:00.000Z',
    };
    expect(PlanFailureSchema.safeParse(failure).success).toBe(true);
    expect(PlanFailureSchema.safeParse({ ...failure, step: 'stt' }).success).toBe(false);
  });

  it('(QA-1) a ready plan holds at most 25 card ids', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => cardN(i + 1));
    expect(DailyPlanSchema.safeParse(ready(ids(25))).success).toBe(true);
    expect(DailyPlanSchema.safeParse(ready(ids(26))).success).toBe(false);
  });
});

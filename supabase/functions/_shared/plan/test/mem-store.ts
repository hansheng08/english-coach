// In-memory PlanStore for the prepare tests: records every write and lets a test replace any method (T-025a).
import {
  ArticleIdSchema,
  CardIdSchema,
  DailyPlanSchema,
  NewsSettingsSchema,
  ok,
  PlanDateSchema,
  QuestionIdSchema,
  type AppError,
  type CardId,
  type CardSchedule,
  type DailyPlan,
  type NewsCategory,
  type PlanDate,
  type PlanFailure,
  type QuestionId,
  type Result,
} from '@english-coach/contracts';
import type { CompleteInput, FallbackArticle, PlanCard, PlanStore, StoredPlan } from '../../db/plan-store.ts';
import { makeTestPlanStore } from '../../db/test/fakes.ts';
import type { NewsSource } from '../../news/types.ts';

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const cardId = (n: number): CardId => CardIdSchema.parse(uuid(n));
export const date = (s: string): PlanDate => PlanDateSchema.parse(s);

export type MemState = {
  row: StoredPlan | null;
  inserted: { planDate: PlanDate; plannedCategory: NewsCategory; claimedAt: string }[];
  reclaimed: { planDate: PlanDate; claimedAt: string; staleBefore: string }[];
  completed: CompleteInput[];
  failed: { planDate: PlanDate; claimedAt: string; failure: PlanFailure }[];
  articles: Parameters<PlanStore['insertArticle']>[0][];
  fallbackAsked: NewsCategory[];
};

export type MemOptions = {
  readonly sources?: readonly NewsSource[];
  readonly cards?: readonly PlanCard[];
  readonly questions?: Awaited<ReturnType<PlanStore['listQuestionCandidates']>>;
  readonly fallback?: Awaited<ReturnType<PlanStore['readFallbackArticle']>>;
  readonly rewriteSource?: Awaited<ReturnType<PlanStore['readRewriteSource']>>;
  readonly completeResult?: Result<boolean, AppError>;
  readonly failResult?: Result<boolean, AppError>;
  readonly row?: StoredPlan | null;
  readonly reclaimResult?: boolean;
  readonly overrides?: Partial<PlanStore>;
};

const ARTICLE_ID = '33333333-3333-4333-8333-333333333333';

/** The ready plan a `complete` call produces (what readPlan returns afterwards). */
export function readyPlanFrom(input: CompleteInput): DailyPlan {
  return DailyPlanSchema.parse({
    status: 'ready',
    planDate: input.planDate,
    plannedCategory: input.actualCategory,
    actualCategory: input.actualCategory,
    categorySkipped: input.categorySkipped,
    isFallbackArticle: input.isFallbackArticle,
    article: {
      id: input.articleId,
      title: 'Title',
      sourceName: 'Source',
      originalUrl: 'https://example.invalid/a',
      rewrittenText: 'text',
      sentences: ['one'],
      chunks: [],
    },
    shadowItems: input.shadowItems,
    noonItems: input.noonItems,
    cardIds: input.cardIds,
    tonightQuestion: null,
    seedRemaining: input.seedRemaining,
  });
}

export const defaultFallback = (category: NewsCategory = 'ai'): FallbackArticle => ({
  id: ArticleIdSchema.parse(ARTICLE_ID),
  category,
  sentences: [],
  chunks: [],
});

export function memStore(opts: MemOptions = {}): { store: PlanStore; state: MemState } {
  const state: MemState = {
    row: opts.row ?? null,
    inserted: [],
    reclaimed: [],
    completed: [],
    failed: [],
    articles: [],
    fallbackAsked: [],
  };
  const store = makeTestPlanStore({
    readNewsSettings: () => Promise.resolve(ok(NewsSettingsSchema.parse({}))),
    insertPending: (input) => {
      state.inserted.push(input);
      if (state.row !== null) return Promise.resolve(ok(false));
      state.row = { plan: { status: 'pending', planDate: input.planDate }, claimedAt: input.claimedAt };
      return Promise.resolve(ok(true));
    },
    readPlan: () => Promise.resolve(ok(state.row)),
    reclaim: (input) => {
      state.reclaimed.push(input);
      return Promise.resolve(ok(opts.reclaimResult ?? true));
    },
    complete: (input) => {
      state.completed.push(input);
      const result = opts.completeResult ?? ok(true);
      if (result.ok && result.value) state.row = { plan: readyPlanFrom(input), claimedAt: input.claimedAt };
      return Promise.resolve(result);
    },
    fail: (input) => {
      state.failed.push(input);
      return Promise.resolve(opts.failResult ?? ok(true));
    },
    listNewsSources: () => Promise.resolve(ok(opts.sources ?? [])),
    isArticleUsed: () => Promise.resolve(ok(false)),
    insertArticle: (input) => {
      state.articles.push(input);
      return Promise.resolve(ok(defaultFallback().id));
    },
    readFallbackArticle: (planned) => {
      state.fallbackAsked.push(planned);
      return Promise.resolve(opts.fallback ?? ok(null));
    },
    listCardCandidates: () => Promise.resolve(ok(opts.cards ?? [])),
    listQuestionCandidates: () => Promise.resolve(opts.questions ?? ok([])),
    readRewriteSource: () => Promise.resolve(opts.rewriteSource ?? ok(null)),
    ...opts.overrides,
  });
  return { store, state };
}

export const dbFailed = (): AppError => ({ kind: 'db_failed', message: 'select failed' });

export function planCard(
  n: number,
  schedule: CardSchedule,
  over: { exampleEn?: string | null; meaningZh?: string | null; createdAtMs?: number; priorityNew?: boolean; chunk?: string } = {},
): PlanCard {
  return {
    candidate: { cardId: cardId(n), schedule, priorityNew: over.priorityNew ?? false, createdAtMs: over.createdAtMs ?? n * 1000 },
    chunk: over.chunk ?? 'drive adoption',
    exampleEn: over.exampleEn === undefined ? 'Rising costs drive adoption of chiplets.' : over.exampleEn,
    meaningZh: over.meaningZh === undefined ? '推動採用' : over.meaningZh,
  };
}

export const newCard = (n: number, over: Parameters<typeof planCard>[2] = {}): PlanCard =>
  planCard(n, { state: 'collected', correctCount: 0, intervalStep: 0, dueDate: null }, over);

export const dueCard = (n: number, dueDate: string, over: Parameters<typeof planCard>[2] = {}): PlanCard =>
  planCard(n, { state: 'learning', correctCount: 1, intervalStep: 0, dueDate: date(dueDate) }, over);

export const questionId = (n: number): QuestionId => QuestionIdSchema.parse(uuid(n));

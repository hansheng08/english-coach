// PlanStore：備料（daily-prep、POST /plan/today）要讀寫的資料（ARCHITECTURE §4.13.2、§4.12.5、§4.6）。
// 使用者 client 與 secret client 共用同一個實作；碰到使用者資料表的每一次查詢都帶 `eq('user_id', userId)`（CLAUDE.md §5 第 15 條）。
// 錯誤訊息只有操作名稱與 Postgres 錯誤碼，不含資料。
import {
  ArticleIdSchema,
  CardIdSchema,
  CardScheduleSchema,
  DailyPlanSchema,
  err,
  NewsCategorySchema,
  NewsChunkSchema,
  NewsSettingsSchema,
  ok,
  PlanDateSchema,
  PlanFailureSchema,
  QuestionIdSchema,
  type AppError,
  type ArticleId,
  type DailyPlan,
  type NewsArticleContent,
  type NewsCategory,
  type NewsChunk,
  type NewsSettings,
  type NoonItem,
  type PlanDate,
  type PlanFailure,
  type QuestionId,
  type Result,
  type ShadowItem,
  type UserId,
} from '@english-coach/contracts';
import { addDays, toTaipeiPlanDate, type CardCandidate, type QuestionCandidate } from '@english-coach/domain';
import { z } from 'zod';
import type { SupabaseEnv } from '../config/env.ts';
import type { NewsSource } from '../news/types.ts';
import type { AuthContext } from './auth.ts';
import { createUserClient, runDb, type PlanDbClient } from './client.ts';

export type StoredPlan = { readonly plan: DailyPlan; readonly claimedAt: string };

export type ArticleInsert = {
  readonly sourceId: string;
  readonly category: NewsCategory;
  readonly url: string;
  readonly sha256: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly content: NewsArticleContent;
};

export type CompleteInput = {
  readonly planDate: PlanDate;
  readonly claimedAt: string;
  readonly actualCategory: NewsCategory;
  readonly categorySkipped: readonly NewsCategory[];
  readonly articleId: ArticleId;
  readonly isFallbackArticle: boolean;
  readonly shadowItems: readonly ShadowItem[];
  readonly noonItems: readonly NoonItem[];
  readonly cardIds: readonly string[];
  readonly tonightQuestionId: QuestionId | null;
  /** T-025a 一律 null；T-025b 才計算（§4.13.1）。 */
  readonly seedRemaining: number | null;
};

/** 沒有新文章時退回的舊文章：跟讀句與語塊要從它來。 */
export type FallbackArticle = {
  readonly id: ArticleId;
  readonly category: NewsCategory;
  readonly sentences: readonly string[];
  readonly chunks: readonly NewsChunk[];
};

/** 選卡用：排程欄位＋中午素材要的欄位（不含 card 的其他欄）。 */
export type PlanCard = {
  readonly candidate: CardCandidate;
  readonly chunk: string;
  readonly exampleEn: string | null;
  readonly meaningZh: string | null;
};

/** 前一晚首答的診斷；形狀由呼叫端用 contracts 的 evening schema 解析（§4.6）。 */
export type RewriteSource = { readonly diagnosis: unknown; readonly upgradeChunks: unknown };

type Res<T> = Promise<Result<T, AppError>>;

export type PlanStore = {
  /** 搶認領：`insert … on conflict do nothing`；true＝這次插入成功（搶到）。 */
  readonly insertPending: (input: { readonly planDate: PlanDate; readonly plannedCategory: NewsCategory; readonly claimedAt: string }) => Res<boolean>;
  readonly readPlan: (planDate: PlanDate) => Res<StoredPlan | null>;
  /** `failed`，或 `pending` 而且 `claimed_at < staleBefore` → 改回 pending 並寫 claimedAt；true＝搶到。 */
  readonly reclaim: (input: { readonly planDate: PlanDate; readonly claimedAt: string; readonly staleBefore: string }) => Res<boolean>;
  /** 條件 `status = 'pending' and claimed_at = claimedAt`；false＝被別人接手。 */
  readonly complete: (input: CompleteInput) => Res<boolean>;
  readonly fail: (input: { readonly planDate: PlanDate; readonly claimedAt: string; readonly failure: PlanFailure }) => Res<boolean>;
  readonly readNewsSettings: () => Res<NewsSettings>;
  readonly listNewsSources: () => Res<readonly NewsSource[]>;
  readonly isArticleUsed: (key: { readonly url: string; readonly sha256: string }) => Res<boolean>;
  readonly insertArticle: (input: ArticleInsert) => Res<ArticleId>;
  readonly readFallbackArticle: (planned: NewsCategory) => Res<FallbackArticle | null>;
  readonly listCardCandidates: () => Res<readonly PlanCard[]>;
  readonly listQuestionCandidates: () => Res<readonly QuestionCandidate[]>;
  readonly readRewriteSource: (planDate: PlanDate) => Res<RewriteSource | null>;
};

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);

const shapeError = (op: string): AppError => ({ kind: 'db_failed', message: `${op} returned an unexpected shape` });

async function selectRows(op: string, query: PromiseLike<{ data: unknown; error: { code?: string | undefined; message: string } | null }>): Res<readonly Readonly<Record<string, unknown>>[]> {
  const res = await runDb(op, () => query);
  if (!res.ok) return err(res.error);
  if (!Array.isArray(res.value)) return err(shapeError(op));
  const rows: readonly unknown[] = res.value;
  const out: Readonly<Record<string, unknown>>[] = [];
  for (const row of rows) {
    if (!isRecord(row)) return err(shapeError(op));
    out.push(row);
  }
  return ok(out);
}

async function selectOne(op: string, query: PromiseLike<{ data: unknown; error: { code?: string | undefined; message: string } | null }>): Res<Readonly<Record<string, unknown>> | null> {
  const res = await runDb(op, () => query);
  if (!res.ok) return err(res.error);
  if (res.value === null) return ok(null);
  return isRecord(res.value) ? ok(res.value) : err(shapeError(op));
}

const NewsSourceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  feed_url: z.string(),
  category: NewsCategorySchema,
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  fetch_mode: z.enum(['rss_full', 'rss_then_page']),
  include_url_pattern: z.string().nullable(),
  enabled: z.boolean(),
});

const CardRowSchema = z.object({
  id: CardIdSchema,
  chunk: z.string(),
  example_en: z.string().nullable(),
  meaning_zh: z.string().nullable(),
  state: z.string(),
  correct_count: z.number(),
  interval_step: z.number(),
  due_date: z.string().nullable(),
  priority_new: z.boolean(),
  created_at: z.string(),
});

const QuestionRowSchema = z.object({
  id: QuestionIdSchema,
  source: z.enum(['resume', 'bank']),
  category: z.enum(['intro', 'behavioral', 'technical']),
  retired: z.boolean(),
});

const AnswerRowSchema = z.object({ question_id: z.string(), created_at: z.string() });

const PLAN_COLUMNS =
  'plan_date, planned_category, actual_category, category_skipped, article_id, is_fallback_article, shadow_items, noon_items, card_ids, tonight_question_id, status, failure, claimed_at, seed_remaining';

const ARTICLE_COLUMNS = 'id, source_id, title, original_url, rewritten_text, sentences, chunks';

const TAIPEI_MIDNIGHT = 'T00:00:00+08:00';

/** `createUserDb(ctx)` 的同類：使用者 client（受 RLS 限制），user_id 取自 AuthContext。 */
export function createPlanStore(ctx: AuthContext, env: SupabaseEnv): PlanStore {
  return planStoreFrom(createUserClient(ctx, env).plan, ctx.userId);
}

export function planStoreFrom(client: PlanDbClient, userId: UserId): PlanStore {
  const mine = (table: string) => client.from(table);
  const orOwnOrShared = `user_id.eq.${userId},user_id.is.null`;

  const readReadyParts = async (row: Readonly<Record<string, unknown>>): Res<DailyPlan> => {
    const articleId = row['article_id'];
    if (typeof articleId !== 'string') return err(shapeError('select daily_plan'));
    const article = await selectOne(
      'select news_article',
      mine('news_article').select(ARTICLE_COLUMNS).eq('id', articleId).eq('user_id', userId).maybeSingle(),
    );
    if (!article.ok) return err(article.error);
    if (article.value === null) return err(shapeError('select news_article'));
    const sourceId = article.value['source_id'];
    const source =
      typeof sourceId === 'string' ? await selectOne('select news_source', mine('news_source').select('id, name').eq('id', sourceId).maybeSingle()) : ok(null);
    if (!source.ok) return err(source.error);
    const questionId = row['tonight_question_id'];
    const question =
      typeof questionId === 'string'
        ? await selectOne(
            'select question',
            mine('question').select('id, text, category').eq('id', questionId).or(orOwnOrShared).maybeSingle(),
          )
        : ok(null);
    if (!question.ok) return err(question.error);
    const parsed = DailyPlanSchema.safeParse({
      status: 'ready',
      planDate: row['plan_date'],
      plannedCategory: row['planned_category'],
      actualCategory: row['actual_category'],
      categorySkipped: row['category_skipped'],
      isFallbackArticle: row['is_fallback_article'],
      article: {
        id: article.value['id'],
        title: article.value['title'],
        sourceName: source.value?.['name'] ?? '',
        originalUrl: article.value['original_url'],
        rewrittenText: article.value['rewritten_text'],
        sentences: article.value['sentences'],
        chunks: article.value['chunks'],
      },
      shadowItems: row['shadow_items'],
      noonItems: row['noon_items'],
      cardIds: row['card_ids'],
      tonightQuestion:
        question.value === null
          ? null
          : { id: question.value['id'], text: question.value['text'], category: question.value['category'] },
      seedRemaining: row['seed_remaining'] ?? null,
    });
    return parsed.success ? ok(parsed.data) : err(shapeError('select daily_plan'));
  };

  const readPlan: PlanStore['readPlan'] = async (planDate) => {
    const row = await selectOne(
      'select daily_plan',
      mine('daily_plan').select(PLAN_COLUMNS).eq('user_id', userId).eq('plan_date', planDate).maybeSingle(),
    );
    if (!row.ok) return err(row.error);
    if (row.value === null) return ok(null);
    const claimedAt = row.value['claimed_at'];
    if (typeof claimedAt !== 'string') return err(shapeError('select daily_plan'));
    const status = row.value['status'];
    if (status === 'pending') return ok({ plan: { status: 'pending', planDate }, claimedAt });
    if (status === 'failed') {
      const failure = PlanFailureSchema.safeParse(row.value['failure']);
      if (!failure.success) return err(shapeError('select daily_plan'));
      return ok({ plan: { status: 'failed', planDate, failure: failure.data }, claimedAt });
    }
    if (status !== 'ready') return err(shapeError('select daily_plan'));
    const plan = await readReadyParts(row.value);
    if (!plan.ok) return err(plan.error);
    return ok({ plan: plan.value, claimedAt });
  };

  return {
    insertPending: async ({ planDate, plannedCategory, claimedAt }) => {
      const rows = await selectRows(
        'insert daily_plan',
        mine('daily_plan')
          .upsert(
            { user_id: userId, plan_date: planDate, planned_category: plannedCategory, status: 'pending', claimed_at: claimedAt },
            { onConflict: 'user_id,plan_date', ignoreDuplicates: true },
          )
          .select('plan_date'),
      );
      return rows.ok ? ok(rows.value.length > 0) : err(rows.error);
    },

    readPlan,

    reclaim: async ({ planDate, claimedAt, staleBefore }) => {
      const rows = await selectRows(
        'update daily_plan',
        mine('daily_plan')
          .update({ status: 'pending', error: null, failure: null, claimed_at: claimedAt })
          .eq('user_id', userId)
          .eq('plan_date', planDate)
          .or(`status.eq.failed,and(status.eq.pending,claimed_at.lt.${staleBefore})`)
          .select('plan_date'),
      );
      return rows.ok ? ok(rows.value.length > 0) : err(rows.error);
    },

    complete: async (input) => {
      const rows = await selectRows(
        'update daily_plan',
        mine('daily_plan')
          .update({
            status: 'ready',
            actual_category: input.actualCategory,
            category_skipped: [...input.categorySkipped],
            article_id: input.articleId,
            is_fallback_article: input.isFallbackArticle,
            shadow_items: [...input.shadowItems],
            noon_items: [...input.noonItems],
            card_ids: [...input.cardIds],
            tonight_question_id: input.tonightQuestionId,
            seed_remaining: input.seedRemaining,
            error: null,
            failure: null,
          })
          .eq('user_id', userId)
          .eq('plan_date', input.planDate)
          .eq('status', 'pending')
          .eq('claimed_at', input.claimedAt)
          .select('plan_date'),
      );
      return rows.ok ? ok(rows.value.length > 0) : err(rows.error);
    },

    fail: async ({ planDate, claimedAt, failure }) => {
      const rows = await selectRows(
        'update daily_plan',
        mine('daily_plan')
          .update({ status: 'failed', error: failure.error.kind, failure })
          .eq('user_id', userId)
          .eq('plan_date', planDate)
          .eq('status', 'pending')
          .eq('claimed_at', claimedAt)
          .select('plan_date'),
      );
      return rows.ok ? ok(rows.value.length > 0) : err(rows.error);
    },

    readNewsSettings: async () => {
      const row = await selectOne('select profile', mine('profile').select('settings').eq('user_id', userId).maybeSingle());
      if (!row.ok) return err(row.error);
      const settings = row.value?.['settings'];
      const news = isRecord(settings) ? settings['news'] : undefined;
      const parsed = NewsSettingsSchema.safeParse(news ?? {});
      return parsed.success ? ok(parsed.data) : err({ kind: 'internal', message: 'profile.settings.news is invalid' });
    },

    listNewsSources: async () => {
      const rows = await selectRows(
        'select news_source',
        mine('news_source').select('id, name, feed_url, category, priority, fetch_mode, include_url_pattern, enabled'),
      );
      if (!rows.ok) return err(rows.error);
      const sources: NewsSource[] = [];
      for (const row of rows.value) {
        const parsed = NewsSourceRowSchema.safeParse(row);
        if (!parsed.success) return err(shapeError('select news_source'));
        const r = parsed.data;
        sources.push({
          id: r.id,
          name: r.name,
          feedUrl: r.feed_url,
          category: r.category,
          priority: r.priority,
          fetchMode: r.fetch_mode,
          includeUrlPattern: r.include_url_pattern,
          enabled: r.enabled,
        });
      }
      return ok(sources);
    },

    isArticleUsed: async ({ url, sha256 }) => {
      const byUrl = await selectRows(
        'select news_article',
        mine('news_article').select('id').eq('user_id', userId).eq('original_url', url).limit(1),
      );
      if (!byUrl.ok) return err(byUrl.error);
      if (byUrl.value.length > 0) return ok(true);
      const byHash = await selectRows(
        'select news_article',
        mine('news_article').select('id').eq('user_id', userId).eq('original_sha256', sha256).limit(1),
      );
      return byHash.ok ? ok(byHash.value.length > 0) : err(byHash.error);
    },

    insertArticle: async (input) => {
      const row = await selectOne(
        'insert news_article',
        mine('news_article')
          .insert({
            user_id: userId,
            source_id: input.sourceId,
            category: input.category,
            original_url: input.url,
            original_sha256: input.sha256,
            title: input.title,
            published_at: input.publishedAt,
            rewritten_text: input.content.rewritten_text,
            sentences: input.content.sentences,
            chunks: input.content.chunks,
          })
          .select('id')
          .maybeSingle(),
      );
      if (!row.ok) return err(row.error);
      const id = ArticleIdSchema.safeParse(row.value?.['id']);
      return id.success ? ok(id.data) : err(shapeError('insert news_article'));
    },

    readFallbackArticle: async (planned) => {
      const columns = 'id, category, sentences, chunks';
      const preferred = await selectRows(
        'select news_article',
        mine('news_article')
          .select(columns)
          .eq('user_id', userId)
          .is('read_at', null)
          .eq('category', planned)
          .order('published_at', { ascending: false })
          .limit(1),
      );
      if (!preferred.ok) return err(preferred.error);
      const chosen =
        preferred.value.length > 0
          ? preferred
          : await selectRows(
              'select news_article',
              mine('news_article').select(columns).eq('user_id', userId).is('read_at', null).order('published_at', { ascending: false }).limit(1),
            );
      if (!chosen.ok) return err(chosen.error);
      const row = chosen.value[0];
      if (row === undefined) return ok(null);
      const id = ArticleIdSchema.safeParse(row['id']);
      const category = NewsCategorySchema.safeParse(row['category']);
      const sentences = z.array(z.string()).safeParse(row['sentences']);
      const chunks = z.array(NewsChunkSchema).safeParse(row['chunks']);
      return id.success && category.success && sentences.success && chunks.success
        ? ok({ id: id.data, category: category.data, sentences: sentences.data, chunks: chunks.data })
        : err(shapeError('select news_article'));
    },

    listCardCandidates: async () => {
      const rows = await selectRows(
        'select card',
        mine('card')
          .select('id, chunk, example_en, meaning_zh, state, correct_count, interval_step, due_date, priority_new, created_at')
          .eq('user_id', userId)
          .or('state.eq.collected,state.eq.learning,state.eq.reviewing'),
      );
      if (!rows.ok) return err(rows.error);
      const cards: PlanCard[] = [];
      for (const row of rows.value) {
        const parsed = CardRowSchema.safeParse(row);
        if (!parsed.success) return err(shapeError('select card'));
        const r = parsed.data;
        const schedule = CardScheduleSchema.safeParse({
          state: r.state,
          correctCount: r.correct_count,
          intervalStep: r.interval_step,
          dueDate: r.due_date,
        });
        const createdAtMs = Date.parse(r.created_at);
        if (!schedule.success || Number.isNaN(createdAtMs)) return err(shapeError('select card'));
        cards.push({
          candidate: { cardId: r.id, schedule: schedule.data, priorityNew: r.priority_new, createdAtMs },
          chunk: r.chunk,
          exampleEn: r.example_en,
          meaningZh: r.meaning_zh,
        });
      }
      return ok(cards);
    },

    listQuestionCandidates: async () => {
      const questions = await selectRows(
        'select question',
        mine('question').select('id, source, category, retired').or(orOwnOrShared).eq('retired', false),
      );
      if (!questions.ok) return err(questions.error);
      const answers = await selectRows(
        'select evening_answer',
        mine('evening_answer').select('question_id, created_at').eq('user_id', userId).eq('kind', 'first'),
      );
      if (!answers.ok) return err(answers.error);
      const asked = new Map<string, { count: number; last: PlanDate | null }>();
      for (const row of answers.value) {
        const a = AnswerRowSchema.safeParse(row);
        if (!a.success) return err(shapeError('select evening_answer'));
        const date = toTaipeiPlanDate(new Date(a.data.created_at));
        if (!date.ok) return err(shapeError('select evening_answer'));
        const prev = asked.get(a.data.question_id);
        const last = prev?.last === null || prev?.last === undefined || date.value > prev.last ? date.value : prev.last;
        asked.set(a.data.question_id, { count: (prev?.count ?? 0) + 1, last });
      }
      const out: QuestionCandidate[] = [];
      for (const row of questions.value) {
        const q = QuestionRowSchema.safeParse(row);
        if (!q.success) return err(shapeError('select question'));
        const stat = asked.get(q.data.id);
        out.push({
          questionId: q.data.id,
          source: q.data.source,
          category: q.data.category,
          retired: q.data.retired,
          timesAsked: stat?.count ?? 0,
          lastAskedDate: stat?.last ?? null,
        });
      }
      return ok(out);
    },

    readRewriteSource: async (planDate) => {
      const day = PlanDateSchema.safeParse(planDate);
      const previous = day.success ? addDays(day.data, -1) : null;
      if (previous === null || !previous.ok) return err({ kind: 'internal', message: 'cannot compute the previous day' });
      const row = await selectOne(
        'select evening_answer',
        mine('evening_answer')
          .select('diagnosis, upgrade_chunks')
          .eq('user_id', userId)
          .eq('kind', 'first')
          .not('diagnosis', 'is', null)
          .gte('created_at', `${previous.value}${TAIPEI_MIDNIGHT}`)
          .lt('created_at', `${planDate}${TAIPEI_MIDNIGHT}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      if (!row.ok) return err(row.error);
      if (row.value === null) return ok(null);
      return ok({ diagnosis: row.value['diagnosis'], upgradeChunks: row.value['upgrade_chunks'] });
    },
  };
}

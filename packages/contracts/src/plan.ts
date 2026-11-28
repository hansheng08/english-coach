// daily_plan 的跨網路與 jsonb 形狀（ARCHITECTURE §4.13.1、§4.14.1、§5.9.2；T-025a）。
import { z } from 'zod';
import { ApiErrorBodySchema } from './errors.ts';
import { ArticleIdSchema, CardIdSchema, NewsCategorySchema, PlanDateSchema, QuestionIdSchema, StoragePathSchema } from './ids.ts';
import { NewsChunkSchema } from './news.ts';

/** daily_plan.shadow_items 的一個元素（jsonb 的鍵用 snake_case）；陣列位置就是 item_index（0～4）。 */
export const ShadowItemSchema = z.object({
  source: z.enum(['news', 'rewrite']),
  text: z.string().min(1),
  tts_path: StoragePathSchema.nullable(),
});
export type ShadowItem = z.infer<typeof ShadowItemSchema>;
export const ShadowItemsSchema = z.array(ShadowItemSchema).max(5);

/** daily_plan.noon_items 的一個元素（jsonb，snake_case）。欄位是 null＝那部分素材缺少。 */
export const NoonItemSchema = z.object({
  card_id: CardIdSchema,
  plain_en: z.string().nullable(),
  cloze_en: z.string().nullable(),
  distractors: z.array(z.string()).length(3).nullable(),
  context_zh: z.string().nullable(),
  blocks: z.array(z.string()).min(3).max(6).nullable(),
  shuffled_order: z.array(z.number().int().min(0)).nullable(),
});
export type NoonItem = z.infer<typeof NoonItemSchema>;
export const NoonItemsSchema = z.array(NoonItemSchema).max(25);

export const PLAN_FAILURE_STEPS = ['news', 'rewrite', 'cards', 'noon', 'tts', 'save', 'internal'] as const;
export const PlanFailureSchema = z.object({
  step: z.enum(PLAN_FAILURE_STEPS),
  error: ApiErrorBodySchema.shape.error,
  timeout_sec: z.number().int().positive().nullable(),
  failed_at: z.iso.datetime({ offset: true }),
});
export type PlanFailure = z.infer<typeof PlanFailureSchema>;

export const DAILY_PLAN_STATUSES = ['pending', 'ready', 'failed'] as const;

/** POST /plan/today 的回應（跨網路）。最外層 camelCase；裡面重用既有的 jsonb 形狀。 */
export const DailyPlanSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), planDate: PlanDateSchema }),
  z.object({ status: z.literal('failed'), planDate: PlanDateSchema, failure: PlanFailureSchema }),
  z.object({
    status: z.literal('ready'),
    planDate: PlanDateSchema,
    plannedCategory: NewsCategorySchema,
    actualCategory: NewsCategorySchema,
    categorySkipped: z.array(NewsCategorySchema),
    isFallbackArticle: z.boolean(),
    article: z.object({
      id: ArticleIdSchema,
      title: z.string(),
      sourceName: z.string(),
      originalUrl: z.string(),
      rewrittenText: z.string(),
      sentences: z.array(z.string()),
      chunks: z.array(NewsChunkSchema),
    }),
    shadowItems: ShadowItemsSchema,
    noonItems: NoonItemsSchema,
    cardIds: z.array(CardIdSchema).max(25),
    tonightQuestion: z
      .object({ id: QuestionIdSchema, text: z.string(), category: z.enum(['intro', 'behavioral', 'technical']) })
      .nullable(),
    seedRemaining: z.number().int().min(0).nullable(),
  }),
]);
export type DailyPlan = z.infer<typeof DailyPlanSchema>;

/** evening_answer.failure（jsonb）。status = 'failed' 若且唯若有值（既有 check）。 */
export const ANSWER_FAILURE_STEPS = ['upload', 'stt', 'diagnose', 'chunks'] as const;
export const AnswerFailureSchema = z.object({
  step: z.enum(ANSWER_FAILURE_STEPS),
  error: ApiErrorBodySchema.shape.error,
  failed_at: z.iso.datetime({ offset: true }),
  attempt: z.number().int().min(1),
});
export type AnswerFailure = z.infer<typeof AnswerFailureSchema>;

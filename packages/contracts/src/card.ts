import { z } from 'zod';
import { CardIdSchema, PlanDateSchema } from './ids.ts';

export const CARD_STATES = ['collected', 'learning', 'reviewing', 'mastered'] as const;
export const CardStateSchema = z.enum(CARD_STATES);
export type CardState = z.infer<typeof CardStateSchema>;

export const REVIEW_RATINGS = ['fast', 'hesitant', 'forgot'] as const; // 秒答／猶豫／忘記（值同 card_review.rating）
export const ReviewRatingSchema = z.enum(REVIEW_RATINGS);
export type ReviewRating = z.infer<typeof ReviewRatingSchema>;

export const REVIEW_MODES = ['A', 'B'] as const; // AC-08 的模式 A／B
export const ReviewModeSchema = z.enum(REVIEW_MODES);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

export const CARD_SOURCE_TYPES = ['news', 'manual', 'evening', 'seed', 'shadowing'] as const;
export const CardSourceTypeSchema = z.enum(CARD_SOURCE_TYPES);
export type CardSourceType = z.infer<typeof CardSourceTypeSchema>;

/** 0＝未進間隔；1／2／3＝Reviewing 第幾階；4＝第 3 階之後（同 card.interval_step）。domain 的 SrsStep（T-008）＝Exclude<IntervalStep, 0>。 */
const ReviewingStepSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const IntervalStepSchema = z.union([z.literal(0), ReviewingStepSchema]);
export type IntervalStep = z.infer<typeof IntervalStepSchema>;

/** 排程相關欄位；用 state 區分，讓不合法的組合（例如 mastered 卻有到期日）通不過 schema。 */
export const CardScheduleSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('collected'),
    correctCount: z.literal(0),
    intervalStep: z.literal(0),
    dueDate: PlanDateSchema.nullable(),
  }),
  z.object({
    state: z.literal('learning'),
    correctCount: z.number().int().min(1),
    intervalStep: z.literal(0),
    dueDate: PlanDateSchema,
  }),
  z.object({
    state: z.literal('reviewing'),
    correctCount: z.number().int().min(2),
    intervalStep: ReviewingStepSchema,
    dueDate: PlanDateSchema,
  }),
  z.object({
    state: z.literal('mastered'),
    correctCount: z.number().int().min(2),
    intervalStep: ReviewingStepSchema,
    dueDate: z.null(),
  }),
]);
export type CardSchedule = z.infer<typeof CardScheduleSchema>;

/** POST /reviews 的請求（T-032 使用）。 */
export const ReviewRequestSchema = z.object({ cardId: CardIdSchema, mode: ReviewModeSchema, rating: ReviewRatingSchema });
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

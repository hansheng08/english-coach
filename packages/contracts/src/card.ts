import { z } from 'zod';
import { CardIdSchema, PlanDateSchema, StoragePathSchema } from './ids.ts';
import { newsWords } from './news.ts';

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

const CHUNK_WORD = /^[A-Za-z'-]+$/;
const HAS_LETTER = /[A-Za-z]/;

/** ARCHITECTURE §4.7 chunk 文字格式：單一空白分隔的 1 個以上的字；每字只含英文字母、`'`、`-`，且至少 1 個字母。 */
export const ChunkTextSchema: z.ZodType<string> = z
  .string()
  .refine((s) => s.split(' ').every((w) => CHUNK_WORD.test(w) && HAS_LETTER.test(w)), { message: 'chunk text format' });

/** 種子庫的主題標籤（ARCHITECTURE §4.10，ADR-016 決定 2；順序固定）。 */
export const SEED_TAGS = ['meeting', 'presentation', 'negotiation', 'interview', 'email', 'project', 'technical', 'small-talk'] as const;
export const SeedTagSchema = z.enum(SEED_TAGS);

/** 每批剛好 100 筆（Q-10：6 批 × 100）。 */
export const SEED_BATCH_SIZE = 100;

const SEED_MEANING_MAX = 30;
const SEED_EXAMPLE_MIN_WORDS = 5;
const SEED_EXAMPLE_MAX_WORDS = 25;
const HAN = /\p{Script=Han}/u;

function hasControlChar(s: string): boolean {
  return Array.from(s).some((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n <= 0x1f || n === 0x7f;
  });
}

/** R2：trim 後等於原值、沒有控制字元、1～30 字元（code point）、至少 1 個漢字。 */
function isSeedMeaning(s: string): boolean {
  const length = Array.from(s).length;
  return s.trim() === s && !hasControlChar(s) && length >= 1 && length <= SEED_MEANING_MAX && HAN.test(s);
}

/** R3：trim 後等於原值、5～25 個字（newsWords）、沒有 `/` 與換行。 */
function isSeedExample(s: string): boolean {
  const words = newsWords(s).length;
  return s.trim() === s && words >= SEED_EXAMPLE_MIN_WORDS && words <= SEED_EXAMPLE_MAX_WORDS && !s.includes('/') && !/[\r\n]/.test(s);
}

/** 種子庫的一筆 chunk（ARCHITECTURE §4.10 R1、R2、R3、R5）。 */
export const SeedChunkSchema = z.object({
  chunk: ChunkTextSchema.refine((s) => s.split(' ').length >= 2 && s.split(' ').length <= 6, { message: 'chunk must have 2 to 6 words' }),
  meaning_zh: z.string().refine(isSeedMeaning, { message: 'meaning_zh format' }),
  example_en: z.string().refine(isSeedExample, { message: 'example_en format' }),
  tags: z
    .array(SeedTagSchema)
    .max(3)
    .refine((tags) => new Set(tags).size === tags.length, { message: 'tags must be unique' }),
});
export type SeedChunk = z.infer<typeof SeedChunkSchema>;

/** 種子庫的一批（R7：剛好 SEED_BATCH_SIZE 筆；R8：batch 1～6）。 */
export const SeedBatchSchema = z.object({
  batch: z.number().int().min(1).max(6),
  items: z.array(SeedChunkSchema).length(SEED_BATCH_SIZE),
});
export type SeedBatch = z.infer<typeof SeedBatchSchema>;

/** API 回傳的卡片（camelCase；對應 card 表，不含 user_id、seed_chunk_id；T-032 定義，ARCHITECTURE §4.11）。 */
export const CardSchema = z.object({
  id: CardIdSchema,
  chunk: z.string(),
  meaningZh: z.string().nullable(),
  exampleEn: z.string().nullable(),
  synonyms: z.array(z.string()),
  sourceSentence: z.string().nullable(),
  sourceType: CardSourceTypeSchema,
  schedule: CardScheduleSchema,
  priorityNew: z.boolean(),
  ttsPath: StoragePathSchema.nullable(),
  generatedBy: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  masteredAt: z.iso.datetime({ offset: true }).nullable(),
});
export type Card = z.infer<typeof CardSchema>;

/** POST /reviews 的請求（T-032 使用）。 */
export const ReviewRequestSchema = z.object({ cardId: CardIdSchema, mode: ReviewModeSchema, rating: ReviewRatingSchema });
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

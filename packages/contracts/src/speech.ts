import { z } from 'zod';
import { ProviderIdSchema, SttModelIdSchema } from './ids.ts';

export const WordTimingSchema = z
  .object({
    word: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1).nullable(), // 供應商沒給就是 null
  })
  .refine((w) => w.endMs >= w.startMs);
export type WordTiming = z.infer<typeof WordTimingSchema>;

const TranscriptBase = z.object({
  text: z.string(),
  language: z.literal('en'),
  durationMs: z.number().int().nonnegative(),
  provider: ProviderIdSchema,
  model: SttModelIdSchema,
});
/** 有沒有逐字時間戳記用 timing 區分（AC-15 的停頓與語速需要 'words'）。 */
export const TranscriptSchema = z.discriminatedUnion('timing', [
  TranscriptBase.extend({ timing: z.literal('words'), words: z.array(WordTimingSchema) }),
  TranscriptBase.extend({ timing: z.literal('none') }),
]);
export type Transcript = z.infer<typeof TranscriptSchema>;

export const PronunciationResultSchema = z.object({
  score0to100: z.number().min(0).max(100),
  recognizedText: z.string(),
  words: z.array(WordTimingSchema),
  provider: ProviderIdSchema,
});
export type PronunciationResult = z.infer<typeof PronunciationResultSchema>;

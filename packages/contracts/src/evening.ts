// 晚上作答的診斷形狀（ARCHITECTURE §4.16.1）。存 evening_answer.diagnosis／upgrade_chunks；只檢查形狀，內容檢查在 _shared/ai/diagnose.ts。
import { z } from 'zod';
import { ChunkTextSchema } from './card.ts';

/** 標記的位置用「逐字稿的字序號」：[start, end)。 */
export const WordSpanSchema = z.object({ start: z.number().int().min(0), end: z.number().int().min(1) }).refine((s) => s.end > s.start);
export type WordSpan = z.infer<typeof WordSpanSchema>;

export const DIAGNOSIS_MARK_TYPES = ['grammar', 'filler', 'plain'] as const;
export const DiagnosisMarkSchema = z.object({
  type: z.enum(DIAGNOSIS_MARK_TYPES),
  span: WordSpanSchema,
  suggestion: z.string().nullable(),
});
export type DiagnosisMark = z.infer<typeof DiagnosisMarkSchema>;

export const SeniorSentenceSchema = z.object({
  text: z.string().min(1),
  source: WordSpanSchema.nullable(),
});
export type SeniorSentence = z.infer<typeof SeniorSentenceSchema>;

export const UpgradeChunkSchema = z.object({
  chunk: ChunkTextSchema,
  meaning_zh: z.string(),
  example_en: z.string(),
  senior_index: z.number().int().min(0),
});
export type UpgradeChunk = z.infer<typeof UpgradeChunkSchema>;

export const DiagnosisSchema = z.object({
  marks: z.array(DiagnosisMarkSchema).max(60),
  senior: z.array(SeniorSentenceSchema).min(1).max(40),
  upgrade_chunks: z.array(UpgradeChunkSchema).min(3).max(5),
  stats: z.object({
    pause_count: z.number().int().min(0),
    filler_count: z.number().int().min(0),
    wpm: z.number().min(0),
  }),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

// T-006: evening speech stats and the weekly_metric row (ARCHITECTURE v1.5 §4.8.2, §4.8.4; AC-22, M2-M4).
import { z } from 'zod';
import { PlanDateSchema } from './ids.ts';

export const EveningSpeechStatsSchema = z.object({
  pauseCount: z.number().int().min(0),
  fillerCount: z.number().int().min(0),
  wpm: z.number().min(0),
  speechDurationMs: z.number().int().min(0),
});
export type EveningSpeechStats = z.infer<typeof EveningSpeechStatsSchema>;

/** `weekly_metric` view 的一列（camelCase；`apps/web/src/api` 轉換後解析）。 */
export const WeeklyMetricSchema = z.object({
  weekStart: PlanDateSchema, // 台北週一
  masteredNew: z.number().int().min(0),
  masteredCumulative: z.number().int().min(0),
  firstAnswerCount: z.number().int().min(0),
  pauseFillerPerMinute: z.number().min(0).nullable(),
  pauseFillerCountAvg: z.number().min(0).nullable(),
  wpmAvg: z.number().min(0).nullable(),
  noScriptChunkTargets: z.number().int().min(0),
  noScriptChunkSpoken: z.number().int().min(0),
  noScriptChunkSpokenRate: z.number().min(0).max(1).nullable(),
});
export type WeeklyMetric = z.infer<typeof WeeklyMetricSchema>;

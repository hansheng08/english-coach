export { DOMAIN_PACKAGE_NAME } from './package-info.ts';
export { addDays, daysBetween, toTaipeiPlanDate } from './taipei-date.ts';
export { forgotIntervalDays, nextSrsStep, srsIntervalDays } from './srs.ts';
export type { SrsStep } from './srs.ts';
export { PAUSE_THRESHOLD_MS, computeSpeechMetrics } from './speech-metrics.ts';
export type { SpeechMetrics } from './speech-metrics.ts';
export { applyReview, markMastered } from './card-state.ts';
export type { ReviewOutcome } from './card-state.ts';
export { categoryTryOrder, decideNewsCategory, plannedCategory } from './news-rotation.ts';
export type { NewsCategoryDecision, RotationOrder } from './news-rotation.ts';
export { normalizeWords } from './words.ts';
export { detectChunkHits, scoreChunkHits } from './chunk-hit.ts';
export type { ChunkHit, ChunkHitLevel } from './chunk-hit.ts';
export { SHADOW_MIN_ACCURACY, SHADOW_MIN_SPEED_RATIO, canUnlock, maskWords, scoreShadowAttempt } from './shadowing.ts';
export type { ShadowScore } from './shadowing.ts';
export { selectDailyCards, selectEveningHintChunks, selectShadowSentences, selectTonightQuestion } from './plan.ts';
export type {
  CardCandidate,
  DailyCardSelection,
  QuestionCandidate,
  ReviewedTodayCard,
  ReviewingFallbackCard,
  SeedCandidate,
  ShadowSentence,
  ShadowSentenceCandidate,
} from './plan.ts';

import { newsWords } from '@english-coach/contracts';
import type { CardId, CardSchedule, CardState, IntervalStep, PlanDate, QuestionId } from '@english-coach/contracts';

// ARCHITECTURE §4.4～§4.6 (T-010). Pure selection: callers pass candidates, this file only filters, sorts and counts.
// Every sort ends on an id, compared with < and > (never localeCompare), so the result does not depend on input order.

const DAILY_TOTAL = 25;
const MAX_OLD = 15;
const EVENING_HINT_COUNT = 3;
const SHADOW_COUNT = 5;
const SHADOW_REWRITE_COUNT = 2;
const SHADOW_MIN_WORDS = 6;
const SHADOW_MAX_WORDS = 25;

function cmp<T extends string | number>(a: T, b: T): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sorted<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...items].sort(compare);
}

export type CardCandidate = {
  readonly cardId: CardId;
  readonly schedule: CardSchedule;
  readonly priorityNew: boolean;
  readonly createdAtMs: number;
};
export type SeedCandidate = { readonly seedChunkId: string; readonly batch: number };
export type DailyCardSelection = {
  readonly oldCardIds: readonly CardId[];
  readonly newCardIds: readonly CardId[];
  readonly seedChunkIds: readonly string[];
  readonly extraOldCardIds: readonly CardId[];
  readonly total: number;
};

function isDueOld(c: CardCandidate, today: PlanDate): boolean {
  const s = c.schedule;
  if (s.state === 'mastered') return false;
  return s.dueDate !== null && s.dueDate <= today;
}

function dueKey(c: CardCandidate): string {
  // Only called on due cards, so dueDate is never null; '' keeps the type total without an assertion.
  return c.schedule.dueDate ?? '';
}

function isNewCard(c: CardCandidate): boolean {
  return c.schedule.state === 'collected' && c.schedule.dueDate === null;
}

export function selectDailyCards(
  input: {
    readonly cards: readonly CardCandidate[];
    readonly seeds: readonly SeedCandidate[];
    readonly usedSeedChunkIds: ReadonlySet<string>;
  },
  today: PlanDate,
): DailyCardSelection {
  const due = sorted(
    input.cards.filter((c) => isDueOld(c, today)),
    (a, b) =>
      cmp(dueKey(a), dueKey(b)) ||
      cmp(a.schedule.intervalStep, b.schedule.intervalStep) ||
      cmp(a.createdAtMs, b.createdAtMs) ||
      cmp(a.cardId, b.cardId),
  );
  const oldCards = due.slice(0, MAX_OLD);
  const target = DAILY_TOTAL - oldCards.length;

  const newCards = sorted(
    input.cards.filter(isNewCard),
    (a, b) =>
      cmp(a.priorityNew ? 0 : 1, b.priorityNew ? 0 : 1) || cmp(a.createdAtMs, b.createdAtMs) || cmp(a.cardId, b.cardId),
  ).slice(0, target);

  const seedRoom = target - newCards.length;
  const seeds =
    seedRoom > 0
      ? sorted(
          input.seeds.filter((s) => !input.usedSeedChunkIds.has(s.seedChunkId)),
          (a, b) => cmp(a.batch, b.batch) || cmp(a.seedChunkId, b.seedChunkId),
        ).slice(0, seedRoom)
      : [];

  const extraRoom = seedRoom - seeds.length;
  const extra = extraRoom > 0 ? due.slice(MAX_OLD, MAX_OLD + extraRoom) : [];

  const oldCardIds = oldCards.map((c) => c.cardId);
  const newCardIds = newCards.map((c) => c.cardId);
  const seedChunkIds = seeds.map((s) => s.seedChunkId);
  const extraOldCardIds = extra.map((c) => c.cardId);
  return {
    oldCardIds,
    newCardIds,
    seedChunkIds,
    extraOldCardIds,
    total: oldCardIds.length + newCardIds.length + seedChunkIds.length + extraOldCardIds.length,
  };
}

export type QuestionCandidate = {
  readonly questionId: QuestionId;
  readonly source: 'resume' | 'bank';
  readonly category: 'intro' | 'behavioral' | 'technical';
  readonly retired: boolean;
  readonly timesAsked: number;
  readonly lastAskedDate: PlanDate | null;
};

function categoryRank(category: QuestionCandidate['category']): number {
  switch (category) {
    case 'intro':
      return 0;
    case 'behavioral':
      return 1;
    case 'technical':
      return 2;
    default: {
      const unreachable: never = category;
      return unreachable;
    }
  }
}

/** Unlike the §4.5 signature there is no `today` parameter: sorting never needs it (T-010 TechLead decision 1). */
export function selectTonightQuestion(candidates: readonly QuestionCandidate[]): QuestionId | null {
  const active = candidates.filter((q) => !q.retired);
  const resume = active.filter((q) => q.source === 'resume');
  const pool = resume.length > 0 ? resume : active.filter((q) => q.source === 'bank');
  const first = sorted(
    pool,
    (a, b) =>
      cmp(a.timesAsked, b.timesAsked) ||
      cmp(a.lastAskedDate ?? '', b.lastAskedDate ?? '') ||
      cmp(categoryRank(a.category), categoryRank(b.category)) ||
      cmp(a.questionId, b.questionId),
  )[0];
  return first === undefined ? null : first.questionId;
}

export type ReviewedTodayCard = {
  readonly cardId: CardId;
  readonly chunk: string;
  readonly state: CardState;
  readonly intervalStep: IntervalStep;
  readonly reviewedAtMs: number;
};
export type ReviewingFallbackCard = {
  readonly cardId: CardId;
  readonly chunk: string;
  readonly intervalStep: IntervalStep;
  readonly lastReviewedDate: PlanDate;
};

export function selectEveningHintChunks(
  reviewedToday: readonly ReviewedTodayCard[],
  reviewingFallback: readonly ReviewingFallbackCard[],
): readonly { readonly cardId: CardId; readonly chunk: string }[] {
  const todayPicks = sorted(
    reviewedToday,
    (a, b) =>
      cmp(a.state === 'reviewing' ? 0 : 1, b.state === 'reviewing' ? 0 : 1) ||
      cmp(b.intervalStep, a.intervalStep) ||
      cmp(a.reviewedAtMs, b.reviewedAtMs) ||
      cmp(a.cardId, b.cardId),
  )
    .slice(0, EVENING_HINT_COUNT)
    .map((c) => ({ cardId: c.cardId, chunk: c.chunk }));

  const room = EVENING_HINT_COUNT - todayPicks.length;
  if (room <= 0) return todayPicks;
  const chosen = new Set<CardId>(todayPicks.map((c) => c.cardId));
  // T-010 TechLead decision 2: latest lastReviewedDate, then larger intervalStep, then cardId; skip cards already chosen.
  const fallbackPicks = sorted(
    reviewingFallback.filter((c) => !chosen.has(c.cardId)),
    (a, b) => cmp(b.lastReviewedDate, a.lastReviewedDate) || cmp(b.intervalStep, a.intervalStep) || cmp(a.cardId, b.cardId),
  )
    .slice(0, room)
    .map((c) => ({ cardId: c.cardId, chunk: c.chunk }));
  return [...todayPicks, ...fallbackPicks];
}

export type ShadowSentenceCandidate = { readonly text: string; readonly containsTargetChunk: boolean };
export type ShadowSentence = { readonly source: 'news' | 'rewrite'; readonly text: string };

/** Word count follows ADR-013 (`newsWords`: "/" is not a word, a lone dash counts as one). */
function eligibleSentences(sentences: readonly ShadowSentenceCandidate[]): readonly string[] {
  const ok = sentences.filter((s) => {
    const n = newsWords(s.text).length;
    return n >= SHADOW_MIN_WORDS && n <= SHADOW_MAX_WORDS;
  });
  // Partition keeps the original order inside each group.
  return [...ok.filter((s) => s.containsTargetChunk), ...ok.filter((s) => !s.containsTargetChunk)].map((s) => s.text);
}

export function selectShadowSentences(
  newsSentences: readonly ShadowSentenceCandidate[],
  rewriteSentences: readonly ShadowSentenceCandidate[] | null,
): readonly ShadowSentence[] {
  const news = eligibleSentences(newsSentences);
  const rewrite = rewriteSentences === null ? [] : eligibleSentences(rewriteSentences);
  const rewriteFirst = Math.min(rewrite.length, SHADOW_REWRITE_COUNT);
  const newsCount = Math.min(news.length, SHADOW_COUNT - rewriteFirst);
  const rewriteCount = Math.min(rewrite.length, SHADOW_COUNT - newsCount);
  return [
    ...news.slice(0, newsCount).map((text): ShadowSentence => ({ source: 'news', text })),
    ...rewrite.slice(0, rewriteCount).map((text): ShadowSentence => ({ source: 'rewrite', text })),
  ];
}

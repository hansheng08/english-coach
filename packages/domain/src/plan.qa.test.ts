import { describe, expect, it } from 'vitest';
import { CardIdSchema, CardScheduleSchema, PlanDateSchema, QuestionIdSchema, newsWords } from '@english-coach/contracts';
import type { CardId, CardSchedule, IntervalStep, PlanDate, QuestionId } from '@english-coach/contracts';
import * as domain from '@english-coach/domain';
import type {
  CardCandidate,
  DailyCardSelection,
  QuestionCandidate,
  ReviewedTodayCard,
  ReviewingFallbackCard,
  SeedCandidate,
  ShadowSentence,
  ShadowSentenceCandidate,
} from '@english-coach/domain';
import { normalizeWords } from './words.ts';
import { selectDailyCards, selectEveningHintChunks, selectShadowSentences, selectTonightQuestion } from './plan.ts';

const TODAY = PlanDateSchema.parse('2026-11-25');
const date = (s: string): PlanDate => PlanDateSchema.parse(s);
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const cid = (n: number): CardId => CardIdSchema.parse(uuid(n));
const qid = (n: number): QuestionId => QuestionIdSchema.parse(uuid(n));
const sched = (value: unknown): CardSchedule => CardScheduleSchema.parse(value);
const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);
const noSeeds = { seeds: [] as SeedCandidate[], usedSeedChunkIds: new Set<string>() };

function reviewing(n: number, dueDate: string, step: IntervalStep = 1, createdAtMs = n): CardCandidate {
  return { cardId: cid(n), schedule: sched({ state: 'reviewing', correctCount: 2, intervalStep: step, dueDate }), priorityNew: false, createdAtMs };
}
function fresh(n: number, createdAtMs = n, priorityNew = false): CardCandidate {
  return { cardId: cid(n), schedule: sched({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: null }), priorityNew, createdAtMs };
}
const dueOld = (from: number, count: number): CardCandidate[] => range(from, count).map((n) => reviewing(n, '2026-11-20'));

describe('QA T-010 selectDailyCards', () => {
  it('(QA-3) (AC-T10-2) (AC-T10-4) state/dueDate filters for old and new cards', () => {
    const cards: CardCandidate[] = [
      { cardId: cid(1), schedule: sched({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: '2026-11-24' }), priorityNew: true, createdAtMs: 1 },
      { cardId: cid(2), schedule: sched({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: '2026-11-26' }), priorityNew: true, createdAtMs: 2 },
      { cardId: cid(3), schedule: sched({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-25' }), priorityNew: false, createdAtMs: 3 },
      { cardId: cid(4), schedule: sched({ state: 'mastered', correctCount: 3, intervalStep: 4, dueDate: null }), priorityNew: true, createdAtMs: 4 },
      { cardId: cid(5), schedule: sched({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-26' }), priorityNew: false, createdAtMs: 5 },
      reviewing(6, '2025-12-31', 4),
      reviewing(7, '2026-11-26', 1),
      fresh(8),
    ];
    const r = selectDailyCards({ cards, ...noSeeds }, TODAY);
    expect(r.oldCardIds).toEqual([cid(6), cid(1), cid(3)]);
    expect(r.newCardIds).toEqual([cid(8)]);
    expect(r.extraOldCardIds).toEqual([]);
    expect(r.total).toBe(4);
  });

  it('(QA-4) (AC-T10-2) sort keys have the right direction and precedence', () => {
    const cards = [
      reviewing(1, '2026-11-24', 1, 1),
      reviewing(2, '2026-11-23', 4, 9),
      reviewing(3, '2026-11-24', 2, 0),
      reviewing(4, '2026-11-24', 1, 0),
      reviewing(9, '2026-11-24', 1, 5),
      reviewing(8, '2026-11-24', 1, 5),
      reviewing(10, '2026-10-31', 3, 3),
    ];
    const r = selectDailyCards({ cards, ...noSeeds }, TODAY);
    expect(r.oldCardIds).toEqual([cid(10), cid(2), cid(4), cid(1), cid(8), cid(9), cid(3)]);
  });

  it('(QA-5) (AC-T10-3) (AC-T10-6) old card cap and top-up boundaries', () => {
    const exactly15 = selectDailyCards({ cards: dueOld(1, 15), ...noSeeds }, TODAY);
    expect(exactly15.oldCardIds).toHaveLength(15);
    expect(exactly15.extraOldCardIds).toEqual([]);
    expect(exactly15.total).toBe(15);
    const sixteen = selectDailyCards({ cards: dueOld(1, 16), ...noSeeds }, TODAY);
    expect(sixteen.oldCardIds).toEqual(range(1, 15).map(cid));
    expect(sixteen.extraOldCardIds).toEqual([cid(16)]);
    expect(sixteen.total).toBe(16);
    const many = selectDailyCards({ cards: dueOld(1, 40), ...noSeeds }, TODAY);
    expect(many.oldCardIds).toEqual(range(1, 15).map(cid));
    expect(many.extraOldCardIds).toEqual(range(16, 10).map(cid));
    expect(many.total).toBe(25);
    const seeds = range(0, 3).map((n) => ({ seedChunkId: `s${String(n)}`, batch: 1 }));
    const mixed = selectDailyCards({ cards: dueOld(1, 30), seeds, usedSeedChunkIds: new Set() }, TODAY);
    expect(mixed.seedChunkIds).toEqual(['s0', 's1', 's2']);
    expect(mixed.extraOldCardIds).toEqual(range(16, 7).map(cid));
    expect(mixed.total).toBe(25);
  });

  it('(QA-6) (AC-T10-4) new cards are capped at 25 - old and seeds take only the remaining room', () => {
    const onlyNew = selectDailyCards({ cards: range(100, 30).map((n) => fresh(n, 1000 - n)), ...noSeeds }, TODAY);
    expect(onlyNew.oldCardIds).toEqual([]);
    expect(onlyNew.newCardIds).toEqual(range(105, 25).reverse().map(cid));
    expect(onlyNew.total).toBe(25);
    const seeds = range(0, 20).map((n) => ({ seedChunkId: `seed-${String(n).padStart(2, '0')}`, batch: 0 }));
    const r = selectDailyCards({ cards: [...dueOld(1, 10), ...range(100, 5).map((n) => fresh(n))], seeds, usedSeedChunkIds: new Set() }, TODAY);
    expect(r.newCardIds).toHaveLength(5);
    expect(r.seedChunkIds).toEqual(range(0, 10).map((n) => `seed-${String(n).padStart(2, '0')}`));
    expect(r.total).toBe(25);
    const prio = selectDailyCards({ cards: [fresh(1, 1), fresh(2, 50, true), fresh(3, 40, true), fresh(4, 0)], ...noSeeds }, TODAY);
    expect(prio.newCardIds).toEqual([cid(3), cid(2), cid(4), cid(1)]);
  });

  it('(QA-7) (AC-T10-5) seed batch compares as a number, id as a string, used ids are skipped', () => {
    const seeds = [
      { seedChunkId: 'b', batch: 10 },
      { seedChunkId: 'a', batch: 2 },
      { seedChunkId: 'seed-2', batch: 1 },
      { seedChunkId: 'seed-10', batch: 1 },
      { seedChunkId: 'used', batch: 0 },
    ];
    const r = selectDailyCards({ cards: [], seeds, usedSeedChunkIds: new Set(['used', 'not-a-seed']) }, TODAY);
    expect(r.seedChunkIds).toEqual(['seed-10', 'seed-2', 'a', 'b']);
    expect(r.total).toBe(4);
  });
});

function q(n: number, o: Partial<Omit<QuestionCandidate, 'questionId'>> = {}): QuestionCandidate {
  return { questionId: qid(n), source: 'bank', category: 'intro', retired: false, timesAsked: 0, lastAskedDate: null, ...o };
}

describe('QA T-010 selectTonightQuestion', () => {
  it('(QA-8) (AC-T10-8) resume-only rule ignores retired resume questions', () => {
    expect(selectTonightQuestion([q(1, { source: 'resume', retired: true }), q(2, { timesAsked: 9 })])).toBe(qid(2));
    expect(selectTonightQuestion([q(1, { source: 'resume', timesAsked: 9, lastAskedDate: date('2026-11-24') }), q(2), q(3)])).toBe(qid(1));
    expect(selectTonightQuestion([q(1, { source: 'resume', retired: true })])).toBeNull();
  });

  it('(QA-9) (AC-T10-8) key precedence and direction', () => {
    expect(selectTonightQuestion([q(1, { timesAsked: 2 }), q(2, { timesAsked: 1, lastAskedDate: date('2026-11-24') })])).toBe(qid(2));
    expect(selectTonightQuestion([q(1, { timesAsked: 1, lastAskedDate: date('2026-11-24') }), q(2, { timesAsked: 1, lastAskedDate: date('2026-10-01') })])).toBe(qid(2));
    expect(selectTonightQuestion([q(1, { lastAskedDate: date('2026-11-01'), category: 'intro' }), q(2, { category: 'technical' })])).toBe(qid(2));
    expect(selectTonightQuestion([q(1, { category: 'technical' }), q(2, { category: 'behavioral' }), q(3, { category: 'technical' })])).toBe(qid(2));
    expect(selectTonightQuestion([q(5, { category: 'behavioral' }), q(4, { category: 'technical' })])).toBe(qid(5));
    expect(selectTonightQuestion([q(5, { category: 'intro' }), q(4, { category: 'behavioral' })])).toBe(qid(5));
    expect(selectTonightQuestion([q(9, { category: 'technical' }), q(7, { category: 'technical' }), q(8, { category: 'technical' })])).toBe(qid(7));
  });
});

function rt(n: number, o: Partial<Omit<ReviewedTodayCard, 'cardId'>> = {}): ReviewedTodayCard {
  return { cardId: cid(n), chunk: `chunk ${String(n)}`, state: 'reviewing', intervalStep: 1, reviewedAtMs: 0, ...o };
}
function fb(n: number, o: Partial<Omit<ReviewingFallbackCard, 'cardId'>> = {}): ReviewingFallbackCard {
  return { cardId: cid(n), chunk: `fallback ${String(n)}`, intervalStep: 1, lastReviewedDate: date('2026-11-20'), ...o };
}

describe('QA T-010 selectEveningHintChunks', () => {
  it('(QA-10) (AC-T10-9) reviewing first regardless of step; mastered/learning/collected are not reviewing', () => {
    const r = selectEveningHintChunks(
      [
        rt(1, { state: 'mastered', intervalStep: 4 }),
        rt(2, { state: 'learning', intervalStep: 0, reviewedAtMs: 0 }),
        rt(3, { state: 'reviewing', intervalStep: 1, reviewedAtMs: 9 }),
        rt(4, { state: 'collected', intervalStep: 0 }),
        rt(5, { state: 'reviewing', intervalStep: 2, reviewedAtMs: 99 }),
      ],
      [fb(6)],
    );
    expect(r).toEqual([
      { cardId: cid(5), chunk: 'chunk 5' },
      { cardId: cid(3), chunk: 'chunk 3' },
      { cardId: cid(1), chunk: 'chunk 1' },
    ]);
  });

  it('(QA-11) (AC-T10-9) ties go to earlier reviewedAtMs then cardId', () => {
    const r = selectEveningHintChunks([rt(4, { reviewedAtMs: 5 }), rt(3, { reviewedAtMs: 5 }), rt(2, { reviewedAtMs: 7 }), rt(1, { reviewedAtMs: 9 })], []);
    expect(r.map((c) => c.cardId)).toEqual([cid(3), cid(4), cid(2)]);
  });

  it('(QA-12) (AC-T10-9) fallback order: later lastReviewedDate, then larger step, then cardId; only fills the room', () => {
    const fallback = [
      fb(10, { lastReviewedDate: date('2026-11-24'), intervalStep: 1 }),
      fb(11, { lastReviewedDate: date('2026-11-24'), intervalStep: 3 }),
      fb(13, { lastReviewedDate: date('2026-11-23'), intervalStep: 4 }),
      fb(12, { lastReviewedDate: date('2026-11-24'), intervalStep: 1 }),
      fb(1, { lastReviewedDate: date('2026-11-25'), intervalStep: 4 }),
    ];
    expect(selectEveningHintChunks([], fallback).map((c) => c.cardId)).toEqual([cid(1), cid(11), cid(10)]);
    const r = selectEveningHintChunks([rt(1), rt(2, { state: 'learning' })], fallback);
    expect(r).toEqual([
      { cardId: cid(1), chunk: 'chunk 1' },
      { cardId: cid(2), chunk: 'chunk 2' },
      { cardId: cid(11), chunk: 'fallback 11' },
    ]);
    expect(selectEveningHintChunks([rt(1), rt(2), rt(3)], fallback).map((c) => c.cardId)).toEqual([cid(1), cid(2), cid(3)]);
    expect(selectEveningHintChunks([], [])).toEqual([]);
  });
});

const words = (n: number, w = 'w'): string => range(1, n).map((i) => `${w}${String(i)}`).join(' ');
const cand = (text: string, containsTargetChunk = false): ShadowSentenceCandidate => ({ text, containsTargetChunk });
const withSlashes = (n: number): string => range(1, n).map((i) => (i % 3 === 0 ? `x${String(i)} /` : `x${String(i)}`)).join(' ');

describe('QA T-010 selectShadowSentences', () => {
  it('(QA-13) (AC-T10-11) (TC-22) 5/6/25/26 newsWords boundaries on both sides, "/" never counted', () => {
    expect(newsWords(withSlashes(25))).toHaveLength(25);
    expect(withSlashes(25).split(' ').length).toBeGreaterThan(25);
    const lone5 = 'a b c d — e';
    expect(newsWords(lone5)).toHaveLength(6);
    expect(normalizeWords(lone5)).toHaveLength(5);
    const news = [cand(words(5, 'n')), cand(words(26, 'n')), cand(withSlashes(26)), cand(withSlashes(25)), cand(words(6, 'n')), cand(lone5), cand(words(25, 'n'))];
    const rewrite = [cand(words(5, 'r')), cand(`${words(5, 'r')} /`), cand(words(26, 'r')), cand(words(6, 'r')), cand(words(25, 'r'))];
    expect(selectShadowSentences(news, null).map((s) => s.text)).toEqual([withSlashes(25), words(6, 'n'), lone5, words(25, 'n')]);
    expect(selectShadowSentences(news, rewrite)).toEqual([
      { source: 'news', text: withSlashes(25) },
      { source: 'news', text: words(6, 'n') },
      { source: 'news', text: lone5 },
      { source: 'rewrite', text: words(6, 'r') },
      { source: 'rewrite', text: words(25, 'r') },
    ]);
    expect(selectShadowSentences([cand(withSlashes(6)), cand(`${words(5, 'n')} /`)], null).map((s) => s.text)).toEqual([withSlashes(6)]);
  });

  it('(QA-14) (AC-T10-10) ratio and fill-in combinations', () => {
    const news = (n: number): ShadowSentenceCandidate[] => range(1, n).map((i) => cand(words(6, `n${String(i)}-`)));
    const rew = (n: number): ShadowSentenceCandidate[] => range(1, n).map((i) => cand(words(6, `r${String(i)}-`)));
    const count = (r: readonly ShadowSentence[]): string =>
      `${String(r.filter((s) => s.source === 'news').length)}+${String(r.filter((s) => s.source === 'rewrite').length)}`;
    expect(count(selectShadowSentences(news(6), rew(1)))).toBe('4+1');
    expect(count(selectShadowSentences(news(0), rew(6)))).toBe('0+5');
    expect(count(selectShadowSentences(news(6), []))).toBe('5+0');
    expect(count(selectShadowSentences(news(2), rew(2)))).toBe('2+2');
    expect(count(selectShadowSentences(news(3), rew(2)))).toBe('3+2');
    expect(count(selectShadowSentences(news(4), rew(6)))).toBe('3+2');
    expect(count(selectShadowSentences(news(0), null))).toBe('0+0');
    expect(count(selectShadowSentences(news(3), null))).toBe('3+0');
    const r = selectShadowSentences(news(1), rew(6));
    expect(r.map((s) => s.source)).toEqual(['news', 'rewrite', 'rewrite', 'rewrite', 'rewrite']);
    expect(r.map((s) => s.text)).toEqual([words(6, 'n1-'), words(6, 'r1-'), words(6, 'r2-'), words(6, 'r3-'), words(6, 'r4-')]);
  });

  it('(QA-15) (AC-T10-11) target-chunk priority applies inside the rewrite side and only to eligible sentences', () => {
    const rewrite = [cand(words(6, 'a')), cand(words(5, 'short'), true), cand(words(6, 'b')), cand(words(6, 'c'), true)];
    const news = [cand(words(6, 'x')), cand(words(6, 'y'), true), cand(words(6, 'z'))];
    expect(selectShadowSentences(news, rewrite).map((s) => s.text)).toEqual([words(6, 'y'), words(6, 'x'), words(6, 'z'), words(6, 'c'), words(6, 'a')]);
  });
});

describe('QA T-010 purity and exports', () => {
  it('(QA-16) (AC-T10-7) inputs are not mutated and repeated calls agree', () => {
    const cards = [...dueOld(1, 20).reverse(), fresh(100), fresh(99, 0, true)];
    const seeds = [{ seedChunkId: 'z', batch: 2 }, { seedChunkId: 'a', batch: 1 }];
    const snapshot = JSON.stringify({ cards, seeds });
    const a: DailyCardSelection = selectDailyCards({ cards, seeds, usedSeedChunkIds: new Set() }, TODAY);
    expect(selectDailyCards({ cards, seeds, usedSeedChunkIds: new Set() }, TODAY)).toEqual(a);
    expect(JSON.stringify({ cards, seeds })).toBe(snapshot);
    const qs = [q(3, { timesAsked: 1 }), q(2), q(1, { timesAsked: 2 })];
    const qsSnap = JSON.stringify(qs);
    selectTonightQuestion(qs);
    expect(JSON.stringify(qs)).toBe(qsSnap);
    const reviewed = [rt(3), rt(2, { intervalStep: 4 }), rt(1)];
    const fallback = [fb(5), fb(4, { intervalStep: 3 })];
    const rSnap = JSON.stringify({ reviewed, fallback });
    selectEveningHintChunks(reviewed, fallback);
    expect(JSON.stringify({ reviewed, fallback })).toBe(rSnap);
  });

  it('(QA-17) (AC-T10-12) package entry exposes the same functions as the source files', () => {
    expect(domain.selectDailyCards).toBe(selectDailyCards);
    expect(domain.selectTonightQuestion).toBe(selectTonightQuestion);
    expect(domain.selectEveningHintChunks).toBe(selectEveningHintChunks);
    expect(domain.selectShadowSentences).toBe(selectShadowSentences);
    expect(domain.normalizeWords).toBe(normalizeWords);
  });
});

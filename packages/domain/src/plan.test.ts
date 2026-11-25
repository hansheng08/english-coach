import { describe, expect, it } from 'vitest';
import { CardIdSchema, CardScheduleSchema, PlanDateSchema, QuestionIdSchema } from '@english-coach/contracts';
import type { CardId, CardSchedule, IntervalStep, PlanDate, QuestionId } from '@english-coach/contracts';
import * as domain from '@english-coach/domain';
import { mulberry32 } from '../test/prng.ts';
import { selectDailyCards, selectEveningHintChunks, selectShadowSentences, selectTonightQuestion } from './plan.ts';
import type { CardCandidate, QuestionCandidate, ReviewedTodayCard, ReviewingFallbackCard, SeedCandidate } from './plan.ts';

const TODAY = PlanDateSchema.parse('2026-11-25');
const date = (s: string): PlanDate => PlanDateSchema.parse(s);
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const cid = (n: number): CardId => CardIdSchema.parse(uuid(n));
const qid = (n: number): QuestionId => QuestionIdSchema.parse(uuid(n));
const sched = (value: unknown): CardSchedule => CardScheduleSchema.parse(value);

function oldCard(n: number, opts: { dueDate?: string; step?: IntervalStep; createdAtMs?: number } = {}): CardCandidate {
  const step = opts.step ?? 1;
  const schedule =
    step === 0
      ? sched({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: opts.dueDate ?? '2026-11-20' })
      : sched({ state: 'reviewing', correctCount: 2, intervalStep: step, dueDate: opts.dueDate ?? '2026-11-20' });
  return { cardId: cid(n), schedule, priorityNew: false, createdAtMs: opts.createdAtMs ?? n };
}

function newCard(n: number, opts: { priorityNew?: boolean; createdAtMs?: number } = {}): CardCandidate {
  return {
    cardId: cid(n),
    schedule: sched({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: null }),
    priorityNew: opts.priorityNew ?? false,
    createdAtMs: opts.createdAtMs ?? n,
  };
}

const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);
const noSeeds = { seeds: [] as SeedCandidate[], usedSeedChunkIds: new Set<string>() };

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const x = a[i];
    const y = a[j];
    if (x === undefined || y === undefined) throw new Error('shuffle index');
    a[i] = y;
    a[j] = x;
  }
  return a;
}

describe('selectDailyCards', () => {
  it('(AC-T10-2) (TC-2) selects only due collected/learning/reviewing cards', () => {
    const dueCollected: CardCandidate = {
      cardId: cid(1),
      schedule: sched({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: '2026-11-24' }),
      priorityNew: false,
      createdAtMs: 1,
    };
    const learning = oldCard(2, { step: 0 });
    const reviewing = oldCard(3);
    const dueToday = oldCard(4, { dueDate: '2026-11-25' });
    const mastered: CardCandidate = {
      cardId: cid(5),
      schedule: sched({ state: 'mastered', correctCount: 3, intervalStep: 4, dueDate: null }),
      priorityNew: false,
      createdAtMs: 5,
    };
    const tomorrow = oldCard(6, { dueDate: '2026-11-26' });
    const r = selectDailyCards({ cards: [dueCollected, learning, reviewing, dueToday, mastered, tomorrow], ...noSeeds }, TODAY);
    expect(r.oldCardIds).toEqual([cid(2), cid(3), cid(1), cid(4)]); // ordered by dueDate: 11-20, 11-20, 11-24, 11-25
  });

  it('(AC-T10-2) (TC-3) sorts due cards by dueDate, intervalStep, createdAtMs, cardId', () => {
    const run = (cards: CardCandidate[]): CardId[] => [...selectDailyCards({ cards, ...noSeeds }, TODAY).oldCardIds];
    expect(run([oldCard(1, { dueDate: '2026-11-22' }), oldCard(2, { dueDate: '2026-11-21' })])).toEqual([cid(2), cid(1)]);
    expect(run([oldCard(1, { step: 3 }), oldCard(2, { step: 1 })])).toEqual([cid(2), cid(1)]);
    expect(run([oldCard(1, { createdAtMs: 9 }), oldCard(2, { createdAtMs: 3 })])).toEqual([cid(2), cid(1)]);
    expect(run([oldCard(2, { createdAtMs: 1 }), oldCard(1, { createdAtMs: 1 })])).toEqual([cid(1), cid(2)]);
  });

  it('(AC-T10-3) (TC-4) caps old cards at 15 and fills the rest with new cards', () => {
    const news = range(1000, 30).map((n) => newCard(n));
    const expected: [number, number][] = [
      [0, 25],
      [10, 15],
      [15, 10],
      [30, 10],
    ];
    for (const [dueCount, newCount] of expected) {
      const olds = range(1, dueCount).map((n) => oldCard(n));
      const r = selectDailyCards({ cards: [...olds, ...news], ...noSeeds }, TODAY);
      expect(r.oldCardIds.length).toBe(Math.min(15, dueCount));
      expect(r.newCardIds.length).toBe(newCount);
      expect(r.extraOldCardIds).toEqual([]);
      expect(r.total).toBe(25);
    }
  });

  it('(AC-T10-4) (TC-5) only collected cards without a dueDate are new', () => {
    const dated: CardCandidate = {
      cardId: cid(2),
      schedule: sched({ state: 'collected', correctCount: 0, intervalStep: 0, dueDate: '2026-12-01' }),
      priorityNew: false,
      createdAtMs: 2,
    };
    const r = selectDailyCards({ cards: [newCard(1), dated, oldCard(3, { step: 0, dueDate: '2026-12-01' })], ...noSeeds }, TODAY);
    expect(r.newCardIds).toEqual([cid(1)]);
  });

  it('(AC-T10-4) (TC-6) priorityNew first, then createdAtMs, then cardId', () => {
    const run = (cards: CardCandidate[]): CardId[] => [...selectDailyCards({ cards, ...noSeeds }, TODAY).newCardIds];
    expect(run([newCard(1, { createdAtMs: 1 }), newCard(2, { createdAtMs: 99, priorityNew: true })])).toEqual([cid(2), cid(1)]);
    expect(run([newCard(1, { createdAtMs: 5 }), newCard(2, { createdAtMs: 2 })])).toEqual([cid(2), cid(1)]);
    expect(run([newCard(2, { createdAtMs: 1 }), newCard(1, { createdAtMs: 1 })])).toEqual([cid(1), cid(2)]);
  });

  it('(AC-T10-5) (TC-7) seeds fill in after new cards, skipping used ones, ordered by batch then id', () => {
    const olds = range(1, 15).map((n) => oldCard(n));
    const news = range(100, 3).map((n) => newCard(n));
    const seeds: SeedCandidate[] = [
      { seedChunkId: 's-b', batch: 2 },
      { seedChunkId: 's-z', batch: 1 },
      { seedChunkId: 's-a', batch: 1 },
      { seedChunkId: 's-1', batch: 3 },
      { seedChunkId: 's-2', batch: 3 },
      { seedChunkId: 's-3', batch: 4 },
      { seedChunkId: 's-4', batch: 5 },
      { seedChunkId: 's-5', batch: 6 },
    ];
    const used = new Set(['s-a']);
    const r = selectDailyCards({ cards: [...olds, ...news], seeds: [...seeds, { seedChunkId: 's-used', batch: 0 }], usedSeedChunkIds: new Set([...used, 's-used']) }, TODAY);
    expect(r.newCardIds.length).toBe(3);
    expect(r.seedChunkIds).toEqual(['s-z', 's-b', 's-1', 's-2', 's-3', 's-4', 's-5']);
  });

  it('(AC-T10-5) (TC-8) no seeds when new cards suffice', () => {
    const cards = [...range(1, 15).map((n) => oldCard(n)), ...range(100, 10).map((n) => newCard(n))];
    const r = selectDailyCards({ cards, seeds: [{ seedChunkId: 's', batch: 1 }], usedSeedChunkIds: new Set() }, TODAY);
    expect(r.seedChunkIds).toEqual([]);
    expect(r.total).toBe(25);
  });

  it('(AC-T10-6) (TC-9) tops up from the 16th due card onward', () => {
    const olds = range(1, 20).map((n) => oldCard(n));
    const cards = [...olds, ...range(100, 2).map((n) => newCard(n))];
    const r = selectDailyCards({ cards, seeds: [{ seedChunkId: 's', batch: 1 }], usedSeedChunkIds: new Set() }, TODAY);
    expect(r.oldCardIds).toEqual(range(1, 15).map(cid));
    expect(r.newCardIds.length).toBe(2);
    expect(r.seedChunkIds).toEqual(['s']);
    expect(r.extraOldCardIds).toEqual(range(16, 5).map(cid));
    expect(r.total).toBe(23);
  });

  it('(AC-T10-6) (TC-10) fewer than 25 when candidates run out; total equals the array lengths', () => {
    const cards = [...range(1, 3).map((n) => oldCard(n)), ...range(100, 2).map((n) => newCard(n))];
    const r = selectDailyCards({ cards, ...noSeeds }, TODAY);
    expect(r.total).toBe(5);
    expect(r.total).toBe(r.oldCardIds.length + r.newCardIds.length + r.seedChunkIds.length + r.extraOldCardIds.length);
  });
});

function questions(): QuestionCandidate[] {
  return [
    { questionId: qid(1), source: 'resume', category: 'technical', retired: false, timesAsked: 2, lastAskedDate: date('2026-11-20') },
    { questionId: qid(2), source: 'resume', category: 'intro', retired: false, timesAsked: 1, lastAskedDate: date('2026-11-10') },
    { questionId: qid(3), source: 'bank', category: 'intro', retired: false, timesAsked: 0, lastAskedDate: null },
    { questionId: qid(4), source: 'resume', category: 'behavioral', retired: true, timesAsked: 0, lastAskedDate: null },
  ];
}

function q(n: number, extra: Partial<QuestionCandidate> = {}): QuestionCandidate {
  return { questionId: qid(n), source: 'resume', category: 'intro', retired: false, timesAsked: 0, lastAskedDate: null, ...extra };
}

describe('selectTonightQuestion', () => {
  it('(AC-T10-8) (TC-12) resume questions win over bank questions', () => {
    expect(selectTonightQuestion([q(1, { timesAsked: 9 }), q(2, { source: 'bank' })])).toBe(qid(1));
  });

  it('(AC-T10-8) (TC-13) falls back to bank; retired are skipped', () => {
    expect(selectTonightQuestion([q(1, { source: 'bank', timesAsked: 3 }), q(2, { source: 'bank' })])).toBe(qid(2));
    expect(selectTonightQuestion([q(1, { retired: true }), q(2, { source: 'bank' })])).toBe(qid(2));
    expect(selectTonightQuestion(questions())).toBe(qid(2));
  });

  it('(AC-T10-8) (TC-14) orders by timesAsked, lastAskedDate (null first), category, questionId', () => {
    expect(selectTonightQuestion([q(1, { timesAsked: 2 }), q(2, { timesAsked: 1 })])).toBe(qid(2));
    expect(selectTonightQuestion([q(1, { lastAskedDate: date('2026-11-01') }), q(2, { lastAskedDate: date('2026-10-01') })])).toBe(qid(2));
    expect(selectTonightQuestion([q(1, { lastAskedDate: date('2026-11-01') }), q(2, { lastAskedDate: null })])).toBe(qid(2));
    expect(selectTonightQuestion([q(1, { category: 'technical' }), q(2, { category: 'behavioral' }), q(3, { category: 'intro' })])).toBe(qid(3));
    expect(selectTonightQuestion([q(1, { category: 'technical' }), q(2, { category: 'behavioral' })])).toBe(qid(2));
    expect(selectTonightQuestion([q(2), q(1)])).toBe(qid(1));
  });

  it('(AC-T10-8) (TC-15) returns null without candidates', () => {
    expect(selectTonightQuestion([])).toBeNull();
    expect(selectTonightQuestion([q(1, { retired: true }), q(2, { source: 'bank', retired: true })])).toBeNull();
  });
});

function rt(n: number, extra: Partial<ReviewedTodayCard> = {}): ReviewedTodayCard {
  return { cardId: cid(n), chunk: `chunk ${String(n)}`, state: 'reviewing', intervalStep: 1, reviewedAtMs: n, ...extra };
}

function fb(n: number, extra: Partial<ReviewingFallbackCard> = {}): ReviewingFallbackCard {
  return { cardId: cid(n), chunk: `chunk ${String(n)}`, intervalStep: 1, lastReviewedDate: date('2026-11-20'), ...extra };
}

describe('selectEveningHintChunks', () => {
  it('(AC-T10-9) (TC-16) reviewing first, then larger intervalStep, then earlier reviewedAtMs; top 3', () => {
    const r = selectEveningHintChunks(
      [
        rt(1, { state: 'learning', intervalStep: 0 }),
        rt(2, { intervalStep: 1 }),
        rt(3, { intervalStep: 3, reviewedAtMs: 50 }),
        rt(4, { intervalStep: 3, reviewedAtMs: 40 }),
      ],
      [],
    );
    expect(r.map((c) => c.cardId)).toEqual([cid(4), cid(3), cid(2)]);
    expect(r[0]?.chunk).toBe('chunk 4');
  });

  it('(AC-T10-9) (TC-17) fills from fallback without duplicates, latest lastReviewedDate first', () => {
    const r = selectEveningHintChunks(
      [rt(1)],
      [fb(1, { lastReviewedDate: date('2026-11-24') }), fb(2, { lastReviewedDate: date('2026-11-10') }), fb(3, { lastReviewedDate: date('2026-11-18') })],
    );
    expect(r.map((c) => c.cardId)).toEqual([cid(1), cid(3), cid(2)]);
  });

  it('(AC-T10-9) (TC-18) returns the actual count when still short', () => {
    expect(selectEveningHintChunks([], [fb(1)]).map((c) => c.cardId)).toEqual([cid(1)]);
  });
});

const words = (n: number, prefix = 'w'): string => Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`).join(' ');
const sentence = (tag: string, containsTargetChunk = false): { text: string; containsTargetChunk: boolean } => ({ text: `${tag} ${words(6)}`, containsTargetChunk });
const sentences = (tag: string, n: number): { text: string; containsTargetChunk: boolean }[] => range(0, n).map((i) => sentence(`${tag}${String(i)}`));

describe('selectShadowSentences', () => {
  it('(AC-T10-10) (TC-19) 3 news + 2 rewrite; 5 news when there is no rewrite', () => {
    const r = selectShadowSentences(sentences('n', 6), sentences('r', 6));
    expect(r.map((s) => s.source)).toEqual(['news', 'news', 'news', 'rewrite', 'rewrite']);
    expect(selectShadowSentences(sentences('n', 6), null).map((s) => s.source)).toEqual(['news', 'news', 'news', 'news', 'news']);
  });

  it('(AC-T10-10) (TC-20) the other side fills in when one side is short', () => {
    const a = selectShadowSentences(sentences('n', 1), sentences('r', 6));
    expect(a.map((s) => s.source)).toEqual(['news', 'rewrite', 'rewrite', 'rewrite', 'rewrite']);
    const shortRewrite = [{ text: 'too short', containsTargetChunk: true }];
    const b = selectShadowSentences(sentences('n', 6), shortRewrite);
    expect(b.map((s) => s.source)).toEqual(['news', 'news', 'news', 'news', 'news']);
  });

  it('(AC-T10-10) (TC-21) returns the actual count, news before rewrite, with correct source', () => {
    const r = selectShadowSentences(sentences('n', 2), sentences('r', 1));
    expect(r.length).toBe(3);
    expect(r.map((s) => s.source)).toEqual(['news', 'news', 'rewrite']);
    expect(r[2]?.text).toBe('r0 w0 w1 w2 w3 w4 w5');
  });

  it('(AC-T10-11) (TC-22) keeps 6..25 newsWords; "/" is not a word, a lone dash is one', () => {
    const cand = (text: string) => ({ text, containsTargetChunk: false });
    const r = selectShadowSentences(
      [
        cand(words(5)),
        cand(words(6)),
        cand(words(25)),
        cand(words(26)),
        cand('a b c / d / e / f'),
        cand('a b c d e — '),
        cand('a b c d / e'),
      ],
      null,
    );
    expect(r.map((s) => s.text)).toEqual([words(6), words(25), 'a b c / d / e / f', 'a b c d e — ']);
  });

  it('(AC-T10-11) (TC-23) sentences containing a target chunk come first, rest in original order', () => {
    const news = range(1, 6).map((i) => sentence(`s${String(i)}`, i === 4 || i === 6));
    const r = selectShadowSentences(news, null);
    expect(r.map((s) => s.text.split(' ')[0])).toEqual(['s4', 's6', 's1', 's2', 's3']);
  });
});

describe('determinism and exports', () => {
  it('(AC-T10-7) (TC-11) shuffled inputs give identical results', () => {
    const cards = [
      ...range(1, 20).map((n) => oldCard(n, { dueDate: n % 3 === 0 ? '2026-11-19' : '2026-11-20', step: n % 2 === 0 ? 1 : 2, createdAtMs: n % 4 })),
      ...range(100, 6).map((n) => newCard(n, { priorityNew: n === 104, createdAtMs: n % 2 })),
    ];
    const seeds: SeedCandidate[] = range(0, 6).map((n) => ({ seedChunkId: `seed-${String(n)}`, batch: n % 2 }));
    const base = selectDailyCards({ cards, seeds, usedSeedChunkIds: new Set() }, TODAY);
    const qs = [...questions(), q(7), q(8, { category: 'technical' }), q(9)];
    const baseQ = selectTonightQuestion(qs);
    const reviewed = [rt(1), rt(2, { intervalStep: 3 }), rt(3, { reviewedAtMs: 1 }), rt(4, { reviewedAtMs: 1 }), rt(5, { state: 'learning' })];
    const fallback = [fb(10), fb(11), fb(12, { intervalStep: 2 })];
    const baseH = selectEveningHintChunks(reviewed, fallback);
    for (let i = 0; i < 20; i++) {
      expect(selectDailyCards({ cards: shuffle(cards, i + 1), seeds: shuffle(seeds, i + 101), usedSeedChunkIds: new Set() }, TODAY)).toEqual(base);
      expect(selectTonightQuestion(shuffle(qs, i + 201))).toBe(baseQ);
      expect(selectEveningHintChunks(shuffle(reviewed, i + 301), shuffle(fallback, i + 401))).toEqual(baseH);
    }
  });

  it('(AC-T10-12) (TC-24) package exports the functions', () => {
    expect(typeof domain.normalizeWords).toBe('function');
    expect(typeof domain.selectDailyCards).toBe('function');
    expect(typeof domain.selectTonightQuestion).toBe('function');
    expect(typeof domain.selectEveningHintChunks).toBe('function');
    expect(typeof domain.selectShadowSentences).toBe('function');
    expect(domain.normalizeWords('A b')).toEqual(['a', 'b']);
  });
});

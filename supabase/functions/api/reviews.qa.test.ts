import { ApiErrorBodySchema, CardSchema, err, ok, SrsSettingsSchema, type AppError, type Card, type Result, type SrsSettings } from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { TokenClaims } from '../_shared/db/auth.ts';
import type { RecordReviewInput, ReviewDb } from '../_shared/db/reviews.ts';
import { makeTestUserDb } from '../_shared/db/test/fakes.ts';
import { createRouter } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';

// QA probes for T-032 (POST /reviews). Fake values only.
const CARD_ID = '123e4567-e89b-42d3-a456-426614174000';
const USER = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';
const GOOD: TokenClaims = { role: 'authenticated', sub: USER, is_anonymous: false };
const headers = { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json' };
const SECRET = 'qa-secret-chunk-text';

const card = (schedule: unknown): Card =>
  CardSchema.parse({
    id: CARD_ID,
    chunk: SECRET,
    meaningZh: 'qa-meaning',
    exampleEn: 'qa example',
    synonyms: ['qa-a'],
    sourceSentence: 'qa sentence',
    sourceType: 'news',
    schedule,
    priorityNew: true,
    ttsPath: '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c/a.mp3',
    generatedBy: 'qa-model',
    createdAt: '2026-11-20T01:02:03+00:00',
    masteredAt: null,
  });
const learning = (): Card => card({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-27' });

type Opts = {
  readonly card?: Result<Card | null, AppError>;
  readonly srs?: Result<SrsSettings, AppError>;
  readonly record?: Result<unknown, AppError>;
  readonly now?: Date;
};

function setup(opts: Opts = {}) {
  const readCard = vi.fn<ReviewDb['readCardForReview']>(() => Promise.resolve(opts.card ?? ok(learning())));
  const readSrs = vi.fn<ReviewDb['readSrsSettings']>(() => Promise.resolve(opts.srs ?? ok(SrsSettingsSchema.parse({}))));
  const record = vi.fn<ReviewDb['recordCardReview']>((input: RecordReviewInput) =>
    Promise.resolve(opts.record !== undefined && !opts.record.ok ? opts.record : ok({ id: input.cardId, schedule: input.outcome.schedule })),
  );
  const reviewDb: ReviewDb = { readCardForReview: readCard, readSrsSettings: readSrs, recordCardReview: record };
  const handle = createRouter(
    makeTestRouterDeps({
      auth: ok({ verifyToken: () => Promise.resolve(ok(GOOD)) }),
      routeDeps: ok(makeTestRouteDeps({ userDb: () => makeTestUserDb(), reviewDb: () => reviewDb, now: () => opts.now ?? new Date('2026-11-27T04:00:00Z') })),
    }),
  );
  return { handle, readCard, readSrs, record };
}

const post = (body: unknown, method = 'POST'): Request =>
  new Request('http://localhost/api/reviews', { method, headers, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
const valid = { cardId: CARD_ID, mode: 'A', rating: 'fast' };
const errorBody = async (res: Response) => ApiErrorBodySchema.parse(await res.json()).error;

describe('T-032 QA: POST /reviews', () => {
  it('(QA-13) success body is the whole read card with only the schedule replaced, as JSON', async () => {
    const s = setup();
    const res = await s.handle(post(valid));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body: unknown = await res.json();
    expect(body).toEqual({ ...learning(), schedule: { state: 'reviewing', correctCount: 2, intervalStep: 1, dueDate: '2026-11-30' } });
    expect(JSON.stringify(body)).not.toContain('user_id');
    expect(JSON.stringify(body)).not.toContain('userId');
  });

  it('(QA-14) the success body schedule is what the database layer returned, not a recomputation', async () => {
    const stored = card({ state: 'reviewing', correctCount: 9, intervalStep: 1, dueDate: '2030-01-01' }).schedule;
    const s = setup();
    s.record.mockImplementationOnce((input) => Promise.resolve(ok({ id: input.cardId, schedule: stored })));
    const res = await s.handle(post(valid));
    expect(CardSchema.parse(await res.json()).schedule).toEqual(stored);
  });

  it('(QA-15) each dependency is called exactly once with the right inputs', async () => {
    const s = setup();
    await s.handle(post({ ...valid, mode: 'B', rating: 'hesitant' }));
    expect(s.readCard).toHaveBeenCalledTimes(1);
    expect(s.readCard).toHaveBeenCalledWith(CARD_ID);
    expect(s.readSrs).toHaveBeenCalledTimes(1);
    expect(s.record).toHaveBeenCalledTimes(1);
    expect(s.record.mock.calls[0]?.[0].mode).toBe('B');
  });

  it('(QA-16) a failed card read is returned as is and nothing else is read or recorded', async () => {
    const s = setup({ card: err({ kind: 'db_failed', message: 'select card failed (42501)' }) });
    const res = await s.handle(post(valid));
    expect(res.status).toBe(500);
    expect((await errorBody(res)).kind).toBe('db_failed');
    expect(s.readSrs).not.toHaveBeenCalled();
    expect(s.record).not.toHaveBeenCalled();
  });

  it('(QA-17) a failed srs read stops before recording and keeps its kind', async () => {
    const s = setup({ srs: err({ kind: 'db_failed', message: 'select profile failed' }) });
    const res = await s.handle(post(valid));
    expect(res.status).toBe(500);
    expect((await errorBody(res)).kind).toBe('db_failed');
    expect(s.record).not.toHaveBeenCalled();
  });

  it('(QA-18) a year boundary at Taipei midnight rolls the date and the due date into the next year', async () => {
    const s = setup({ now: new Date('2026-12-31T16:00:00Z') });
    expect((await s.handle(post(valid))).status).toBe(200);
    const input = s.record.mock.calls[0]?.[0];
    expect(input?.reviewDate).toBe('2027-01-01');
    expect(input?.outcome.schedule.dueDate).toBe('2027-01-04');
  });

  it('(QA-19) a mastered card is rejected with the state path and the card content never appears', async () => {
    const mastered = card({ state: 'mastered', correctCount: 5, intervalStep: 3, dueDate: null });
    const s = setup({ card: ok(mastered) });
    const res = await s.handle(post(valid));
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toContain(SECRET);
    expect(ApiErrorBodySchema.parse(JSON.parse(text)).error.issues?.[0]?.path).toBe('state');
  });

  it('(QA-20) JSON that is not an object (null, array, number, empty object) is 400 validation and reads no card', async () => {
    for (const body of ['null', '[]', '7', '{}', '"x"']) {
      const s = setup();
      const res = await s.handle(post(body));
      expect(res.status, body).toBe(400);
      expect((await errorBody(res)).kind).toBe('validation');
      expect(s.readCard).not.toHaveBeenCalled();
    }
  });

  it('(QA-21) rating and mode values outside the enums are 400 on their own paths', async () => {
    for (const [patch, path] of [
      [{ rating: 'medium' }, 'rating'],
      [{ rating: 1 }, 'rating'],
      [{ mode: 'a' }, 'mode'],
      [{ cardId: 123 }, 'cardId'],
    ] as const) {
      const s = setup();
      const res = await s.handle(post({ ...valid, ...patch }));
      expect(res.status).toBe(400);
      expect((await errorBody(res)).issues?.[0]?.path).toBe(path);
      expect(s.readCard).not.toHaveBeenCalled();
    }
  });

  it('(QA-22) GET /reviews is not served and calls nothing', async () => {
    const s = setup();
    const res = await s.handle(post('', 'GET'));
    expect(res.status).not.toBe(200);
    expect(s.readCard).not.toHaveBeenCalled();
    expect(s.record).not.toHaveBeenCalled();
  });

  it('(QA-23) forgot on a learning card goes back to learning step 0 and the call passes forgot', async () => {
    const s = setup();
    await s.handle(post({ ...valid, rating: 'forgot' }));
    const input = s.record.mock.calls[0]?.[0];
    expect(input?.rating).toBe('forgot');
    expect(input?.outcome.schedule).toEqual({ state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-28' });
  });
});

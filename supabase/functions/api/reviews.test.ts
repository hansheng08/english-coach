import {
  ApiErrorBodySchema,
  CardSchema,
  err,
  ok,
  SrsSettingsSchema,
  type AppError,
  type Card,
  type Result,
  type SrsSettings,
} from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { TokenClaims, VerifyToken } from '../_shared/db/auth.ts';
import type { RecordReviewInput, ReviewDb } from '../_shared/db/reviews.ts';
import { makeTestUserDb } from '../_shared/db/test/fakes.ts';
import { createRouter, ROUTES } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';

const CARD_ID = '123e4567-e89b-42d3-a456-426614174000';
const UUID = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';
const GOOD: TokenClaims = { role: 'authenticated', sub: UUID, is_anonymous: false };
const bearer = { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json' };
const NOON = new Date('2026-11-27T04:00:00Z'); // 台北 2026-11-27 12:00
const CHUNK = 'move the needle';

const learning = (): Card =>
  CardSchema.parse({
    id: CARD_ID,
    chunk: CHUNK,
    meaningZh: '帶來改變',
    exampleEn: 'This will move the needle.',
    synonyms: ['make a difference'],
    sourceSentence: null,
    sourceType: 'manual',
    schedule: { state: 'learning', correctCount: 1, intervalStep: 0, dueDate: '2026-11-27' },
    priorityNew: false,
    ttsPath: null,
    generatedBy: null,
    createdAt: '2026-11-20T00:00:00+08:00',
    masteredAt: null,
  });

const reviewing2 = (): Card =>
  CardSchema.parse({ ...learning(), schedule: { state: 'reviewing', correctCount: 3, intervalStep: 2, dueDate: '2026-11-27' } });
const mastered = (): Card =>
  CardSchema.parse({
    ...learning(),
    schedule: { state: 'mastered', correctCount: 5, intervalStep: 3, dueDate: null },
    masteredAt: '2026-11-25T00:00:00+08:00',
  });

type Opts = {
  readonly card?: Result<Card | null, AppError>;
  readonly srs?: Result<SrsSettings, AppError>;
  readonly record?: Result<unknown, AppError>;
  readonly now?: Date;
  readonly verify?: VerifyToken;
};

function setup(opts: Opts = {}) {
  const readCard = vi.fn<ReviewDb['readCardForReview']>(() => Promise.resolve(opts.card ?? ok(learning())));
  const readSrs = vi.fn<ReviewDb['readSrsSettings']>(() => Promise.resolve(opts.srs ?? ok(SrsSettingsSchema.parse({}))));
  const record = vi.fn<ReviewDb['recordCardReview']>((input: RecordReviewInput) =>
    Promise.resolve(opts.record !== undefined && !opts.record.ok ? opts.record : ok({ id: input.cardId, schedule: input.outcome.schedule })),
  );
  const reviewDbCalls = vi.fn();
  const userDbCalls = vi.fn();
  const reviewDb: ReviewDb = { readCardForReview: readCard, readSrsSettings: readSrs, recordCardReview: record };
  const handle = createRouter(
    makeTestRouterDeps({
      auth: ok({ verifyToken: opts.verify ?? (() => Promise.resolve(ok(GOOD))) }),
      routeDeps: ok(
        makeTestRouteDeps({
          userDb: () => {
            userDbCalls();
            return makeTestUserDb();
          },
          reviewDb: () => {
            reviewDbCalls();
            return reviewDb;
          },
          now: () => opts.now ?? NOON,
        }),
      ),
    }),
  );
  return { handle, readCard, readSrs, record, reviewDbCalls, userDbCalls };
}

const post = (body: unknown, headers: Record<string, string> = bearer): Request =>
  new Request('http://localhost/api/reviews', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const valid = { cardId: CARD_ID, mode: 'A', rating: 'fast' };

async function errorOf(res: Response): Promise<{ kind: string; message: string; issues: { path: string }[] }> {
  const e = ApiErrorBodySchema.parse(await res.json()).error;
  return { kind: e.kind, message: e.message, issues: e.issues ?? [] };
}

describe('POST /reviews', () => {
  it('(AC-T32-1) (TC-1) is a route; no token and a bad token are 401 and touch neither reviewDb nor userDb', async () => {
    expect(Object.keys(ROUTES)).toContain('POST /reviews');
    const noToken = setup();
    const res1 = await noToken.handle(post(valid, { 'Content-Type': 'application/json' }));
    const bad = setup({ verify: () => Promise.resolve(err({ kind: 'unauthenticated', message: 'x' })) });
    const res2 = await bad.handle(post(valid));
    for (const [res, s] of [
      [res1, noToken],
      [res2, bad],
    ] as const) {
      expect(res.status).toBe(401);
      expect((await errorOf(res)).kind).toBe('unauthenticated');
      expect(s.reviewDbCalls).not.toHaveBeenCalled();
      expect(s.userDbCalls).not.toHaveBeenCalled();
    }
  });

  it('(AC-T32-2) (TC-2) a bad body is 400 validation on the right path and reads no card', async () => {
    const cases: readonly (readonly [unknown, string])[] = [
      ['not json', 'body'],
      [{ cardId: 'x', mode: 'A', rating: 'fast' }, 'cardId'],
      [{ ...valid, mode: 'C' }, 'mode'],
      [{ cardId: CARD_ID, mode: 'A' }, 'rating'],
    ];
    for (const [body, path] of cases) {
      const s = setup();
      const res = await s.handle(post(body));
      expect(res.status).toBe(400);
      const e = await errorOf(res);
      expect(e.kind).toBe('validation');
      expect(e.issues[0]?.path).toBe(path);
      expect(s.readCard).not.toHaveBeenCalled();
    }
  });

  it('(AC-T32-3) (TC-3) a card that cannot be read is 404 not_found and nothing is recorded', async () => {
    const s = setup({ card: ok(null) });
    const res = await s.handle(post(valid));
    expect(res.status).toBe(404);
    // 線上的錯誤本文不帶 entity（toApiErrorBody 沒有這個欄位）；entity: 'card' 在 _shared/db/reviews.test.ts 驗證。
    expect((await errorOf(res)).kind).toBe('not_found');
    expect(s.record).not.toHaveBeenCalled();
  });

  it('(AC-T32-4) (TC-4) the default srs gives 3 days (the missing-profile and empty-settings cases are in reviews.test.ts of _shared/db)', async () => {
    const s = setup({ srs: ok(SrsSettingsSchema.parse({})) });
    expect((await s.handle(post(valid))).status).toBe(200);
    const input = s.record.mock.calls[0]?.[0];
    expect(input?.outcome.intervalDaysApplied).toBe(3);
    expect(input?.outcome.schedule.dueDate).toBe('2026-11-30');
  });

  it('(AC-T32-4) (TC-5) a custom srs changes interval_days_applied', async () => {
    const srs = SrsSettingsSchema.parse({ step_days: [2, 5, 9], after_last_days: 9, forgot_days: 1 });
    const s = setup({ srs: ok(srs) });
    expect((await s.handle(post(valid))).status).toBe(200);
    expect(s.record.mock.calls[0]?.[0].outcome.intervalDaysApplied).toBe(2);
  });

  it('(AC-T32-4) (TC-6) an invalid srs is 500 internal and nothing is recorded', async () => {
    const s = setup({ srs: err({ kind: 'internal', message: 'profile.settings.srs is invalid' }) });
    const res = await s.handle(post(valid));
    expect(res.status).toBe(500);
    expect((await errorOf(res)).kind).toBe('internal');
    expect(s.record).not.toHaveBeenCalled();
  });

  it('(AC-T32-5) (TC-7) reviewDate is the Taipei date, on both sides of midnight', async () => {
    const cases: readonly (readonly [string, string])[] = [
      ['2026-11-27T15:59:59Z', '2026-11-27'],
      ['2026-11-27T16:00:00Z', '2026-11-28'],
    ];
    for (const [now, date] of cases) {
      const s = setup({ now: new Date(now) });
      expect((await s.handle(post(valid))).status).toBe(200);
      expect(s.record.mock.calls[0]?.[0].reviewDate).toBe(date);
    }
  });

  it('(AC-T32-5) (TC-8) a mastered card is 400 validation and nothing is recorded', async () => {
    const s = setup({ card: ok(mastered()) });
    const res = await s.handle(post(valid));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).kind).toBe('validation');
    expect(s.record).not.toHaveBeenCalled();
  });

  it('(AC-T32-6) (TC-9) records with the read schedule as before and the applyReview result as outcome', async () => {
    for (const rating of ['hesitant', 'forgot'] as const) {
      const s = setup({ card: ok(reviewing2()) });
      expect((await s.handle(post({ ...valid, mode: 'B', rating }))).status).toBe(200);
      const input = s.record.mock.calls[0]?.[0];
      expect(input?.cardId).toBe(CARD_ID);
      expect(input?.reviewDate).toBe('2026-11-27');
      expect(input?.mode).toBe('B');
      expect(input?.rating).toBe(rating);
      expect(input?.before).toEqual(reviewing2().schedule);
      expect(input?.outcome.schedule).toEqual(
        rating === 'hesitant'
          ? { state: 'reviewing', correctCount: 4, intervalStep: 2, dueDate: '2026-12-04' }
          : { state: 'learning', correctCount: 3, intervalStep: 0, dueDate: '2026-11-28' },
      );
    }
  });

  it('(AC-T32-7) (TC-10) success is 200 with a Card whose schedule is new and other fields are unchanged', async () => {
    const s = setup({ card: ok(reviewing2()) });
    const res = await s.handle(post({ ...valid, rating: 'hesitant' }));
    expect(res.status).toBe(200);
    const body = CardSchema.parse(await res.json());
    expect(body.schedule).toEqual({ state: 'reviewing', correctCount: 4, intervalStep: 2, dueDate: '2026-12-04' });
    expect(body.chunk).toBe(CHUNK);
    expect(body.meaningZh).toBe('帶來改變');
    expect(body.createdAt).toBe(reviewing2().createdAt);
  });

  it('(AC-T32-8) (TC-12) a conflict from the database is 409 conflict on card', async () => {
    const s = setup({ record: err({ kind: 'conflict', entity: 'card', message: 'record_card_review conflict' }) });
    const res = await s.handle(post(valid));
    expect(res.status).toBe(409);
    expect((await errorOf(res)).kind).toBe('conflict');
  });

  it('(AC-T32-8) (TC-13) not_found and db_failed from the database keep their status and leak no values', async () => {
    const cases: readonly (readonly [AppError, number])[] = [
      [{ kind: 'not_found', entity: 'card', message: 'card not found' }, 404],
      [{ kind: 'db_failed', message: 'record_card_review failed (42501)' }, 500],
      [{ kind: 'db_failed', message: 'record_card_review failed' }, 500],
    ];
    for (const [error, status] of cases) {
      const s = setup({ record: err(error) });
      const res = await s.handle(post(valid));
      expect(res.status).toBe(status);
      const text = await res.text();
      expect(text).not.toContain(CHUNK);
      expect(text).not.toContain('2026-11-27');
    }
  });

  it('(AC-T32-11) (TC-18) without reviewDb wired the route is 500 internal "reviewDb not wired" and never calls userDb', async () => {
    const userDb = vi.fn(() => makeTestUserDb());
    const handle = createRouter(
      makeTestRouterDeps({
        auth: ok({ verifyToken: () => Promise.resolve(ok(GOOD)) }),
        routeDeps: ok(makeTestRouteDeps({ userDb })),
      }),
    );
    const res = await handle(post(valid));
    expect(res.status).toBe(500);
    const e = await errorOf(res);
    expect(e.kind).toBe('internal');
    expect(e.message).toBe('reviewDb not wired');
    expect(userDb).not.toHaveBeenCalled();
  });
});

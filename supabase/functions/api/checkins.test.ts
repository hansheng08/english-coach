import {
  ApiErrorBodySchema,
  err,
  ok,
  SLOT_STEPS,
  SLOTS,
  UserIdSchema,
  type AppError,
  type CheckinEvent,
  type Result,
} from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import type { TokenClaims, VerifyToken } from '../_shared/db/auth.ts';
import { userDbFrom } from '../_shared/db/user-db.ts';
import type { DbResponse } from '../_shared/db/client.ts';
import { makeTestDbClient } from '../_shared/db/test/fakes.ts';
import { createRouter, type RouteDeps } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';

const UUID = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';
const OTHER = '9a8b7c6d-1111-4222-8333-444455556666';
const ORIGIN = 'http://localhost:5173';
const GOOD: TokenClaims = { role: 'authenticated', sub: UUID, is_anonymous: false };
const NOW = new Date('2026-11-27T04:00:00Z'); // 台北 2026-11-27 12:00
const bearer = { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json' };

type Rows = Readonly<Record<string, unknown>>;
type Setup = {
  readonly handle: (req: Request) => Promise<Response>;
  readonly rows: Rows[];
  readonly userDbCalls: () => number;
  readonly insertCalls: () => number;
};

function setup(opts: {
  readonly now?: Date;
  readonly respond?: () => PromiseLike<DbResponse<unknown>>;
  readonly verify?: VerifyToken;
  readonly routeDeps?: Result<RouteDeps, AppError>;
}): Setup {
  const rows: Rows[] = [];
  let userDbCalls = 0;
  const client = makeTestDbClient({
    from: () => ({
      insert: (row) => {
        rows.push(row);
        return opts.respond?.() ?? Promise.resolve({ data: null, error: null });
      },
    }),
  });
  const routeDeps = makeTestRouteDeps({
    userDb: (ctx) => {
      userDbCalls += 1;
      return userDbFrom(client, ctx.userId);
    },
    now: () => opts.now ?? NOW,
  });
  const handle = createRouter(
    makeTestRouterDeps({
      auth: ok({ verifyToken: opts.verify ?? (() => Promise.resolve(ok(GOOD))) }),
      routeDeps: opts.routeDeps ?? ok(routeDeps),
      allowedOrigins: [ORIGIN],
    }),
  );
  return { handle, rows, userDbCalls: () => userDbCalls, insertCalls: () => rows.length };
}

const post = (body: unknown, headers: Record<string, string> = bearer): Request =>
  new Request('http://localhost/api/checkins', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const valid: CheckinEvent = { planDate: '2026-11-27' as CheckinEvent['planDate'], slot: 'morning', step: 'reading', status: 'completed' };
const withDate = (planDate: string): unknown => ({ ...valid, planDate });

async function errorBody(res: Response): Promise<{ kind: string; issues: { path: string; message: string }[] }> {
  const e = ApiErrorBodySchema.parse(await res.json()).error;
  return { kind: e.kind, issues: e.issues ?? [] };
}

describe('POST /checkins authentication', () => {
  it('(AC-T53-1) (TC-1) no token, bad token, and role anon are all 401 and never touch userDb', async () => {
    const cases: readonly Setup[] = [
      setup({}),
      setup({ verify: () => Promise.resolve(err({ kind: 'unauthenticated', message: 'x' })) }),
      setup({ verify: () => Promise.resolve(ok({ role: 'anon', sub: UUID, is_anonymous: false })) }),
    ];
    const headers: readonly Record<string, string>[] = [{ 'Content-Type': 'application/json' }, bearer, bearer];
    for (const [i, s] of cases.entries()) {
      const res = await s.handle(post(valid, headers[i]));
      expect(res.status).toBe(401);
      expect((await errorBody(res)).kind).toBe('unauthenticated');
      expect(s.userDbCalls()).toBe(0);
    }
  });
});

describe('POST /checkins validation', () => {
  it('(AC-T53-2) (TC-2) a non-JSON body is 400 validation with path body', async () => {
    const s = setup({});
    const res = await s.handle(post('not json'));
    expect(res.status).toBe(400);
    const b = await errorBody(res);
    expect(b.kind).toBe('validation');
    expect(b.issues[0]?.path).toBe('body');
    expect(s.insertCalls()).toBe(0);
  });

  it('(AC-T53-2) (TC-3) a step that does not belong to the slot is rejected on path step', async () => {
    const s = setup({});
    const res = await s.handle(post({ ...valid, slot: 'noon', step: 'reading' }));
    expect(res.status).toBe(400);
    const b = await errorBody(res);
    expect(b.kind).toBe('validation');
    expect(b.issues.some((i) => i.path === 'step')).toBe(true);
    expect(s.insertCalls()).toBe(0);
  });

  it('(AC-T53-2) (TC-4) opened only pairs with step slot, and slot only with opened', async () => {
    const s = setup({});
    for (const body of [
      { ...valid, status: 'opened', step: 'reading' },
      { ...valid, status: 'completed', step: 'slot' },
    ]) {
      const res = await s.handle(post(body));
      expect(res.status).toBe(400);
      const b = await errorBody(res);
      expect(b.kind).toBe('validation');
      expect(b.issues.some((i) => i.path === 'step')).toBe(true);
    }
    expect(s.insertCalls()).toBe(0);
  });

  it('(AC-T53-2) (TC-5) bad slot, status, date format, or a missing step is 400 on the right field', async () => {
    const s = setup({});
    const noStep = { planDate: valid.planDate, slot: valid.slot, status: valid.status };
    const cases: readonly (readonly [unknown, string])[] = [
      [{ ...valid, slot: 'night' }, 'slot'],
      [{ ...valid, status: 'done' }, 'status'],
      [{ ...valid, planDate: '2026/11/27' }, 'planDate'],
      [noStep, 'step'],
    ];
    for (const [body, path] of cases) {
      const res = await s.handle(post(body));
      expect(res.status).toBe(400);
      const b = await errorBody(res);
      expect(b.kind).toBe('validation');
      expect(b.issues.length).toBeGreaterThan(0);
      expect(b.issues.some((i) => i.path === path)).toBe(true);
    }
    expect(s.insertCalls()).toBe(0);
  });
});

describe('POST /checkins planDate window', () => {
  const dates = ['2026-11-26', '2026-11-27', '2026-11-28'] as const;
  const boundary: readonly (readonly [string, readonly number[]])[] = [
    ['2026-11-27T15:59:59Z', [204, 204, 400]],
    ['2026-11-27T16:00:00Z', [400, 204, 204]],
  ];
  for (const [now, statuses] of boundary) {
    it(`(AC-T53-3) (TC-6) now=${now}: accepts Taipei today and yesterday only`, async () => {
      for (const [i, d] of dates.entries()) {
        const s = setup({ now: new Date(now) });
        const res = await s.handle(post(withDate(d)));
        expect(res.status, d).toBe(statuses[i]);
        if (statuses[i] === 400) {
          expect((await errorBody(res)).issues).toEqual([expect.objectContaining({ path: 'planDate' })]);
          expect(s.insertCalls()).toBe(0);
        }
      }
    });
  }

  it('(AC-T53-3) (TC-7) the day before yesterday and tomorrow are 400 on planDate', async () => {
    for (const d of ['2026-11-25', '2026-11-28']) {
      const s = setup({});
      const res = await s.handle(post(withDate(d)));
      expect(res.status).toBe(400);
      const b = await errorBody(res);
      expect(b.kind).toBe('validation');
      expect(b.issues[0]?.path).toBe('planDate');
      expect(s.insertCalls()).toBe(0);
    }
  });
});

describe('POST /checkins writes', () => {
  it('(AC-T53-4) (TC-8) writes exactly five columns for the ctx user and answers 204 with CORS', async () => {
    const s = setup({});
    const res = await s.handle(post({ ...valid, userId: OTHER, recordedAt: '2020-01-01T00:00:00Z' }, { ...bearer, Origin: ORIGIN }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(s.rows).toEqual([
      { user_id: UserIdSchema.parse(UUID), plan_date: '2026-11-27', slot: 'morning', step: 'reading', status: 'completed' },
    ]);
    expect(Object.keys(s.rows[0] ?? {})).toEqual(['user_id', 'plan_date', 'slot', 'step', 'status']);
  });

  it('(AC-T53-4) (TC-9) every slot step with completed/skipped, and every slot opened, is written as sent', async () => {
    const events: CheckinEvent[] = [];
    for (const slot of SLOTS) {
      for (const step of SLOT_STEPS[slot]) {
        for (const status of ['completed', 'skipped'] as const) events.push({ ...valid, slot, step, status });
      }
      events.push({ ...valid, slot, step: 'slot', status: 'opened' });
    }
    for (const e of events) {
      const s = setup({});
      const res = await s.handle(post(e));
      expect(res.status, `${e.slot}/${e.step}/${e.status}`).toBe(204);
      expect(s.rows).toHaveLength(1);
      expect(s.rows[0]).toMatchObject({ slot: e.slot, step: e.step, status: e.status });
    }
  });
});

describe('POST /checkins database results', () => {
  it('(AC-T53-5) (TC-10) a 23505 duplicate is a successful 204', async () => {
    const s = setup({ respond: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }) });
    expect((await s.handle(post(valid))).status).toBe(204);
  });

  it('(AC-T53-5) (TC-11) other database errors and thrown errors are 500 db_failed without event values', async () => {
    const failing: readonly (() => PromiseLike<DbResponse<unknown>>)[] = [
      () => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied 2026-11-27 reading' } }),
      () => Promise.reject(new Error('boom 2026-11-27 reading')),
    ];
    for (const respond of failing) {
      const s = setup({ respond });
      const res = await s.handle(post(valid));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toContain('db_failed');
      expect(text).not.toContain('2026-11-27');
      expect(text).not.toContain('reading');
    }
  });
});

describe('POST /checkins wiring', () => {
  it('(AC-T53-7) (TC-13) routeDeps err is returned as that error', async () => {
    const s = setup({ routeDeps: err({ kind: 'internal', message: 'x' }) });
    const res = await s.handle(post(valid));
    expect(res.status).toBe(500);
    expect((await errorBody(res)).kind).toBe('internal');
  });
});

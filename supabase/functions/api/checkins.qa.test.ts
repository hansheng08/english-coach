import { ApiErrorBodySchema, CheckinEventSchema, err, httpStatusOf, ok, UserIdSchema, type AppError, type Result } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import type { TokenClaims } from '../_shared/db/auth.ts';
import type { DbClient, DbResponse } from '../_shared/db/client.ts';
import { insertCheckin } from '../_shared/db/checkin.ts';
import { makeTestDbClient } from '../_shared/db/test/fakes.ts';
import { userDbFrom } from '../_shared/db/user-db.ts';
import { createRouter, type RouteDeps } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';

// QA probes for T-053 AC-T53-2～5、7（POST /checkins 冪等、日期窗、回應形狀）。fake 值皆為低熵。
const USER = '00000000-0000-4000-8000-000000000053';
const OTHER = '00000000-0000-4000-8000-000000000099';
const ORIGIN = 'http://localhost:5173';
const CLAIMS: TokenClaims = { role: 'authenticated', sub: USER, is_anonymous: false };
const HEADERS = { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json', Origin: ORIGIN };
const UNIQUE = ['user_id', 'plan_date', 'slot', 'step', 'status'] as const;

type Row = Readonly<Record<string, unknown>>;

/** 假資料庫：照 slot_checkin_event_key 唯一鍵行為，重複的列回 23505、不寫入；記錄表名與每次收到的列。 */
function uniqueDb() {
  const stored = new Map<string, Row>();
  const tables: string[] = [];
  const received: Row[] = [];
  const client = makeTestDbClient({
    from: (table) => {
      tables.push(table);
      return {
        insert: (row) => {
          received.push(row);
          const key = UNIQUE.map((c) => String(row[c])).join('|');
          if (stored.has(key)) return Promise.resolve<DbResponse<unknown>>({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "slot_checkin_event_key"' } });
          stored.set(key, row);
          return Promise.resolve<DbResponse<unknown>>({ data: null, error: null });
        },
      };
    },
  });
  return { client, stored, tables, received };
}

function router(client: DbClient, now: () => Date, routeDeps?: Result<RouteDeps, AppError>) {
  let userDbCalls = 0;
  const deps = makeTestRouteDeps({
    userDb: (ctx) => {
      userDbCalls += 1;
      return userDbFrom(client, ctx.userId);
    },
    now,
  });
  // auth／allowedOrigins 覆寫：工廠的「固定測試使用者」與「一個測試 origin」字面值未在任務單定死，這裡維持既有斷言用的 USER／ORIGIN。
  const handle = createRouter(
    makeTestRouterDeps({
      auth: ok({ verifyToken: () => Promise.resolve(ok(CLAIMS)) }),
      routeDeps: routeDeps ?? ok(deps),
      allowedOrigins: [ORIGIN],
    }),
  );
  return { handle, userDbCalls: () => userDbCalls };
}

const post = (body: string, method = 'POST'): Request => new Request('http://localhost/api/checkins', { method, headers: HEADERS, body: method === 'GET' ? null : body });
const event = (planDate: string, extra: Record<string, unknown> = {}) => JSON.stringify({ planDate, slot: 'noon', step: 'cards', status: 'completed', ...extra });
const at = (iso: string) => () => new Date(iso);

async function shape(res: Response) {
  return { status: res.status, body: await res.text(), cors: res.headers.get('Access-Control-Allow-Origin'), type: res.headers.get('Content-Type') };
}
async function kind(res: Response) {
  return ApiErrorBodySchema.parse(await res.json()).error;
}

describe('T-053 QA POST /checkins idempotency', () => {
  it('(QA-1) the same event twice: one stored row, and the first and repeated responses are identical 204s', async () => {
    const db = uniqueDb();
    const r = router(db.client, at('2026-11-27T04:00:00Z'));
    const first = await shape(await r.handle(post(event('2026-11-27'))));
    const again = await shape(await r.handle(post(event('2026-11-27'))));
    expect(first).toEqual({ status: 204, body: '', cors: ORIGIN, type: null });
    expect(again).toEqual(first);
    expect(db.stored.size).toBe(1);
    expect(db.received).toHaveLength(2);
    expect(db.tables).toEqual(['slot_checkin', 'slot_checkin']);
  });

  it('(QA-2) ten concurrent identical requests all succeed and leave exactly one row (the database key decides, not an app-level check)', async () => {
    const db = uniqueDb();
    const r = router(db.client, at('2026-11-27T04:00:00Z'));
    const results = await Promise.all(Array.from({ length: 10 }, () => r.handle(post(event('2026-11-27')))));
    expect(results.map((x) => x.status)).toEqual(Array.from({ length: 10 }, () => 204));
    expect(db.received).toHaveLength(10);
    expect(db.stored.size).toBe(1);
  });

  it('(QA-3) a different status or step for the same slot is a different event, not a duplicate; extra body keys never reach the row', async () => {
    const db = uniqueDb();
    const r = router(db.client, at('2026-11-27T04:00:00Z'));
    const extras = { user_id: OTHER, userId: OTHER, id: OTHER, recorded_at: '2020-01-01T00:00:00Z', recordedAt: '2020-01-01T00:00:00Z' };
    expect((await r.handle(post(event('2026-11-27', extras)))).status).toBe(204);
    expect((await r.handle(post(event('2026-11-27', { status: 'skipped' })))).status).toBe(204);
    expect((await r.handle(post(event('2026-11-27', { slot: 'noon', step: 'slot', status: 'opened' })))).status).toBe(204);
    expect(db.stored.size).toBe(3);
    for (const row of db.received) {
      expect(Object.keys(row)).toEqual([...UNIQUE]);
      expect(row['user_id']).toBe(USER);
    }
  });

  it('(QA-4) the repository maps only 23505 to ok: RLS 42501 and a check-constraint 23514 stay db_failed without data', async () => {
    const user = UserIdSchema.parse(USER);
    const e = { planDate: '2026-11-27', slot: 'noon', step: 'cards', status: 'completed' } as const;
    const answer = (code: string | undefined): DbClient =>
      makeTestDbClient({
        from: () => ({ insert: () => Promise.resolve<DbResponse<unknown>>({ data: null, error: { code, message: `boom 2026-11-27 cards ${USER}` } }) }),
      });
    const parsed = CheckinEventSchema.parse(e);
    expect(await insertCheckin(answer('23505'), user, parsed)).toEqual(ok(null));
    for (const code of ['42501', '23514', '23503', '2350', '235050']) {
      const res = await insertCheckin(answer(code), user, parsed);
      expect(res).toEqual(err({ kind: 'db_failed', message: `insert slot_checkin failed (${code})` }));
    }
    expect(await insertCheckin(answer(undefined), user, parsed)).toEqual(err({ kind: 'db_failed', message: 'insert slot_checkin failed' }));
  });
});

describe('T-053 QA POST /checkins date window and shape', () => {
  it('(QA-5) Taipei today/yesterday across month, leap-day and year boundaries; replay after the window is rejected', async () => {
    const cases: readonly { now: string; ok: readonly string[]; bad: readonly string[] }[] = [
      { now: '2026-11-30T16:00:00Z', ok: ['2026-12-01', '2026-11-30'], bad: ['2026-11-29', '2026-12-02'] },
      { now: '2028-02-29T16:00:00Z', ok: ['2028-03-01', '2028-02-29'], bad: ['2028-02-28', '2028-03-02'] },
      { now: '2026-12-31T16:00:00Z', ok: ['2027-01-01', '2026-12-31'], bad: ['2026-12-30', '2027-01-02'] },
      { now: '2026-12-31T15:59:59Z', ok: ['2026-12-31', '2026-12-30'], bad: ['2027-01-01', '2026-12-29'] },
    ];
    for (const c of cases) {
      const db = uniqueDb();
      const r = router(db.client, at(c.now));
      for (const d of c.ok) expect((await r.handle(post(event(d)))).status, `${c.now} ${d}`).toBe(204);
      for (const d of c.bad) {
        const res = await r.handle(post(event(d)));
        expect(res.status, `${c.now} ${d}`).toBe(400);
        expect((await kind(res)).issues?.map((i) => i.path)).toEqual(['planDate']);
      }
      expect(db.stored.size).toBe(c.ok.length);
    }
  });

  it('(QA-6) the clock is read on every request, not once: yesterday is accepted at 23:59:59 and refused one second after midnight', async () => {
    const db = uniqueDb();
    const times = [new Date('2026-11-27T15:59:59Z'), new Date('2026-11-27T16:00:01Z')];
    let calls = 0;
    const r = router(db.client, () => {
      calls += 1;
      return times[calls - 1] ?? new Date('2026-11-27T16:00:01Z');
    });
    expect((await r.handle(post(event('2026-11-26')))).status).toBe(204);
    expect((await r.handle(post(event('2026-11-26', { status: 'skipped' })))).status).toBe(400);
  });

  it('(QA-7) non-object JSON, an empty body and impossible calendar dates are 400 validation and never reach the database', async () => {
    const db = uniqueDb();
    const r = router(db.client, at('2026-11-27T04:00:00Z'));
    for (const body of ['null', '[]', '"x"', '42', '', '{', event('2026-02-30'), event('2026-11-27T00:00:00Z'), event(' 2026-11-27')]) {
      const res = await r.handle(post(body));
      expect(res.status, body).toBe(400);
      const e = await kind(res);
      expect(e.kind).toBe('validation');
      expect((e.issues ?? []).length).toBeGreaterThan(0);
    }
    for (const body of ['', '{']) expect((await kind(await r.handle(post(body)))).issues?.[0]?.path).toBe('body');
    expect(db.received).toHaveLength(0);
  });

  it('(QA-8) 400 and 500 answers keep the CORS header and a JSON content type; GET /checkins is not a route and writes nothing', async () => {
    const db = uniqueDb();
    const r = router(db.client, at('2026-11-27T04:00:00Z'));
    const bad = await r.handle(post(event('2026-11-20')));
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(bad.headers.get('Content-Type')).toContain('application/json');
    const failing = makeTestDbClient({
      from: () => ({ insert: () => Promise.resolve<DbResponse<unknown>>({ data: null, error: { code: '42501', message: 'x' } }) }),
    });
    const broken = await router(failing, at('2026-11-27T04:00:00Z')).handle(post(event('2026-11-27')));
    expect(broken.status).toBe(500);
    expect(broken.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await kind(broken)).kind).toBe('db_failed');
    const get = await r.handle(post('', 'GET'));
    expect(get.status).toBeGreaterThanOrEqual(400);
    expect(db.received).toHaveLength(0);
  });

  it('(QA-9) a failed routeDeps never builds a userDb and answers with its own kind', async () => {
    const db = uniqueDb();
    const failure: AppError = { kind: 'plan_not_ready', message: 'x' };
    const r = router(db.client, at('2026-11-27T04:00:00Z'), err(failure));
    const res = await r.handle(post(event('2026-11-27')));
    expect(res.status).toBe(httpStatusOf(failure));
    expect((await kind(res)).kind).toBe('plan_not_ready');
    expect(r.userDbCalls()).toBe(0);
    expect(db.received).toHaveLength(0);
  });
});

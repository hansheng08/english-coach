import { CheckinEventSchema, ok } from '@english-coach/contracts';
import { expectErr } from '@english-coach/contracts/testing';
import { describe, expect, it, vi } from 'vitest';
import { makeTestDbClient, makeTestUserDb } from '../_shared/db/test/fakes.ts';
import { createRouter } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';

const EVENT = { planDate: '2026-11-27', slot: 'morning', step: 'reading', status: 'completed' } as const;
const CHECKIN = CheckinEventSchema.parse(EVENT);

describe('test factories (defaults fail loudly)', () => {
  it('(AC-T32-12) (TC-19) unstubbed methods return errors and now is fixed', async () => {
    const e = expectErr(await makeTestUserDb().insertCheckin(CHECKIN));
    expect(e.kind).toBe('internal');
    expect(e.message).toContain('not stubbed: insertCheckin');
    const res = await makeTestDbClient().from('card').insert({});
    expect(res.error?.code).toBe('TEST');
    expect(res.error?.message).toContain('not stubbed: card.insert');
    expect(makeTestRouteDeps().now().toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(typeof makeTestRouteDeps().reviewDb).toBe('function');
  });

  it('(AC-T32-12) (TC-20) overrides replace the defaults and the rest stays unstubbed', async () => {
    const insertCheckin = vi.fn(() => Promise.resolve(ok(null)));
    const userDb = makeTestUserDb({ insertCheckin });
    expect((await userDb.insertCheckin(CHECKIN)).ok).toBe(true);
    expect(insertCheckin).toHaveBeenCalledTimes(1);
    expect(expectErr(await userDb.insertProviderCall({ capability: 'stt', provider: 'groq', model: null, tier: 'free', errorKind: null, latencyMs: 1 })).message).toContain(
      'not stubbed: insertProviderCall',
    );
    expect(makeTestRouteDeps({ now: () => new Date('2026-01-01T00:00:00Z') }).now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(makeTestRouterDeps({ allowedOrigins: ['http://a.test', 'http://b.test'] }).allowedOrigins).toHaveLength(2);
    expect(makeTestRouterDeps().allowedOrigins).toHaveLength(1);
  });

  it('(AC-T32-12) (TC-21) createRouter(makeTestRouterDeps()) serves health and routes checkins to the unstubbed userDb', async () => {
    const handle = createRouter(makeTestRouterDeps());
    const headers = { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json' };
    const health = await handle(new Request('http://localhost/api/health', { headers }));
    expect(health.status).toBe(200);
    const res = await handle(new Request('http://localhost/api/checkins', { method: 'POST', headers, body: JSON.stringify(EVENT) }));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('not stubbed: insertCheckin');
  });
});

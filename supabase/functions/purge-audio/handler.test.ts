import { err, ok, ApiErrorBodySchema, type AppError } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import type { SupabaseSecretEnv } from '../_shared/config/env.ts';
import type { PurgePhase, PurgeRun, PurgeStats } from '../_shared/db/audio-purge.ts';
import { createPurgeHandler } from './handler.ts';

const NOW = new Date('2026-11-28T00:00:00.000Z');
const env: SupabaseSecretEnv = { url: 'http://fake.local', secretKey: 'k1' };
const ZERO = { selected: 0, purged: 0, failed: 0 };
const ZERO_STATS: PurgeStats = { shadow: ZERO, evening: ZERO, orphan: ZERO };
const request = (apikey: string | undefined): Request =>
  new Request('http://localhost/purge-audio', {
    method: 'POST',
    ...(apikey === undefined ? {} : { headers: { apikey } }),
  });

function setup(run: PurgeRun, envResult: ReturnType<typeof ok<SupabaseSecretEnv>> | ReturnType<typeof err<AppError>> = ok(env)) {
  const logs: string[] = [];
  let purgeCalls = 0;
  const handler = createPurgeHandler({
    env: envResult,
    purge: () => {
      purgeCalls += 1;
      return Promise.resolve(run);
    },
    now: () => NOW,
    log: (line) => logs.push(line),
  });
  return { handler, logs, purgeCalls: () => purgeCalls };
}

const withError = (error: AppError, phase: PurgePhase, stats: PurgeStats = ZERO_STATS): PurgeRun => ({ stats, error, phase });

describe('createPurgeHandler (T-046)', () => {
  it('(AC-T46-7) (TC-16) a bad env is 500 and a bad key is 401; purge is never called and nothing is logged', async () => {
    const bad = setup({ stats: ZERO_STATS, error: null }, err({ kind: 'internal', message: 'missing env SUPABASE_URL' }));
    const r1 = await bad.handler(request('k1'));
    expect(r1.status).toBe(500);
    expect(ApiErrorBodySchema.parse(await r1.json()).error.kind).toBe('internal');

    const wrong = setup({ stats: ZERO_STATS, error: null });
    for (const key of [undefined, 'k2']) {
      const r2 = await wrong.handler(request(key));
      expect(r2.status).toBe(401);
      const body = ApiErrorBodySchema.parse(await r2.json());
      expect(body.error.kind).toBe('unauthenticated');
      expect(JSON.stringify(body)).not.toContain('k1');
    }
    expect(bad.purgeCalls() + wrong.purgeCalls()).toBe(0);
    expect(bad.logs.concat(wrong.logs)).toEqual([]);
  });

  it('(AC-T46-7) (TC-17) success and partial failures are 200 with the stats and a single log line without error=', async () => {
    for (const failed of [0, 2]) {
      const stats: PurgeStats = { ...ZERO_STATS, shadow: { selected: 3, purged: 3 - failed, failed } };
      const { handler, logs } = setup({ stats, error: null });
      const res = await handler(request('k1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(stats);
      expect(logs).toEqual([`purge-audio shadow=3/${String(3 - failed)}/${String(failed)} evening=0/0/0 orphan=0/0/0`]);
    }
  });

  it('(AC-T46-7) (TC-18) error status and body come from toApiErrorBody; the log is one line with error and phase and no secrets', async () => {
    const stats: PurgeStats = {
      shadow: { selected: 1, purged: 1, failed: 0 },
      evening: { selected: 2, purged: 1, failed: 1 },
      orphan: { selected: 200, purged: 0, failed: 0 },
    };
    const cases: readonly [AppError, number, string][] = [
      [{ kind: 'db_failed', message: 'audio paths in use failed (42501)' }, 500, ' error=db_failed phase=orphan'],
      [{ kind: 'storage_failed', op: 'list', message: 'list orphan audio failed' }, 502, ' error=storage_failed phase=orphan'],
    ];
    for (const [error, status, tail] of cases) {
      const { handler, logs } = setup(withError(error, 'orphan', stats));
      const res = await handler(request('k1'));
      expect(res.status).toBe(status);
      const body = ApiErrorBodySchema.parse(await res.json());
      expect(body.error.kind).toBe(error.kind);
      expect('orphan' in body).toBe(false);
      expect(logs).toEqual([`purge-audio shadow=1/1/0 evening=2/1/1 orphan=200/0/0${tail}`]);
      expect(logs[0]).not.toContain('k1');
      expect(logs[0]).not.toContain(error.message);
    }
  });

  it('(AC-T46-7) (TC-18) the expired phases use their own kind and phase in the log', async () => {
    const { handler, logs } = setup(withError({ kind: 'db_failed', message: 'list expired failed' }, 'shadow'));
    const res = await handler(request('k1'));
    expect(res.status).toBe(500);
    expect(logs).toEqual(['purge-audio shadow=0/0/0 evening=0/0/0 orphan=0/0/0 error=db_failed phase=shadow']);
    const evening = setup(withError({ kind: 'storage_failed', op: 'delete', message: 'x' }, 'evening'));
    expect((await evening.handler(request('k1'))).status).toBe(502);
    expect(evening.logs[0]).toMatch(/ error=storage_failed phase=evening$/);
  });

  it('(AC-T46-14) (TC-32) orphan stats appear in the 200 body and in one log line without paths', async () => {
    const stats: PurgeStats = { ...ZERO_STATS, orphan: { selected: 3, purged: 2, failed: 1 } };
    const { handler, logs } = setup({ stats, error: null });
    const res = await handler(request('k1'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as PurgeStats).orphan).toEqual({ selected: 3, purged: 2, failed: 1 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('orphan=3/2/1');
    expect(logs[0]).not.toMatch(/shadow\/|evening\/|\.wav|\.webm/);
  });

  it('(AC-T46-15) (AC-T46-17) (TC-33) (TC-37) a recheck failure is 500 db_failed from toApiErrorBody with phase=orphan and the accumulated stats', async () => {
    const stats: PurgeStats = { ...ZERO_STATS, orphan: { selected: 200, purged: 0, failed: 0 } };
    const { handler, logs } = setup(withError({ kind: 'db_failed', message: 'audio paths in use failed' }, 'orphan', stats));
    const res = await handler(request('k1'));
    expect(res.status).toBe(500);
    expect(ApiErrorBodySchema.parse(await res.json()).error.kind).toBe('db_failed');
    expect(logs).toEqual(['purge-audio shadow=0/0/0 evening=0/0/0 orphan=200/0/0 error=db_failed phase=orphan']);
  });
});

import { err, ok, type AppError, type Result, type StoragePath } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import {
  PURGE_ORPHAN_MAX_CALLS,
  purgeDepsFrom,
  purgeExpiredAudio,
  type AudioTable,
  type ExpiredAudio,
  type OrphanCursor,
  type OrphanObject,
  type PurgeDbClient,
  type PurgeDeps,
} from './audio-purge.ts';

const U = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';
const NOW = new Date('2026-11-28T00:00:00.000Z');
const CUTOFF = new Date('2026-11-27T00:00:00.000Z');
const sp = (n: number): StoragePath => `${U}/shadow/2026-11-24/${String(n)}-x.wav` as StoragePath;
const expired = (n: number): ExpiredAudio => ({ id: `id-${String(n)}`, audioPath: sp(n) });
const orphan = (n: number): OrphanObject => ({
  path: sp(n),
  createdAt: `2026-11-20T00:00:00.${String(n).padStart(6, '0')}+00:00`,
});
const page = (from: number, count: number): OrphanObject[] => Array.from({ length: count }, (_, i) => orphan(from + i));
const dbFailed: AppError = { kind: 'db_failed', message: 'list failed' };
const removeFailed: AppError = { kind: 'storage_failed', op: 'delete', message: 'remove failed' };
const listFailed: AppError = { kind: 'storage_failed', op: 'list', message: 'list failed' };

type Options = {
  expired?: Partial<Record<AudioTable, Result<readonly ExpiredAudio[], AppError>>>;
  orphanPages?: readonly Result<readonly OrphanObject[], AppError>[];
  inUse?: (paths: readonly StoragePath[], call: number) => Result<readonly StoragePath[], AppError>;
  remove?: (paths: readonly StoragePath[], call: number) => Result<null, AppError>;
  clear?: (table: AudioTable, row: ExpiredAudio) => Result<null, AppError>;
};

function makeDeps(o: Options = {}) {
  const calls = {
    listExpired: [] as [AudioTable, Date, number][],
    remove: [] as StoragePath[][],
    clear: [] as [AudioTable, ExpiredAudio][],
    listOrphan: [] as [Date, number, OrphanCursor | null][],
    inUse: [] as StoragePath[][],
  };
  const deps: PurgeDeps = {
    listExpired: (table, now, limit) => {
      calls.listExpired.push([table, now, limit]);
      return Promise.resolve(o.expired?.[table] ?? ok([]));
    },
    removeObjects: (paths) => {
      calls.remove.push([...paths]);
      return Promise.resolve(o.remove?.(paths, calls.remove.length - 1) ?? ok(null));
    },
    clearAudioPath: (table, row) => {
      calls.clear.push([table, row]);
      return Promise.resolve(o.clear?.(table, row) ?? ok(null));
    },
    listOrphanCandidates: (cutoff, limit, after) => {
      calls.listOrphan.push([cutoff, limit, after]);
      return Promise.resolve(o.orphanPages?.[calls.listOrphan.length - 1] ?? ok([]));
    },
    pathsInUse: (paths) => {
      calls.inUse.push([...paths]);
      return Promise.resolve(o.inUse?.(paths, calls.inUse.length - 1) ?? ok([]));
    },
  };
  return { deps, calls };
}

// ---- fake supabase-js subset that records the chain ----
type Pg = { data: unknown; error: { code?: string; message: string } | null } | 'throw';
type ClientOptions = {
  select?: Pg;
  update?: Pg;
  rpc?: (fn: string, args: Record<string, unknown>) => Pg;
  remove?: { data: unknown; error: { message: string } | null } | 'throw';
};

function fakeClient(o: ClientOptions = {}) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    not: [] as unknown[][],
    lte: [] as unknown[][],
    order: [] as unknown[][],
    limit: [] as number[],
    update: [] as unknown[],
    eq: [] as unknown[][],
    rpc: [] as { fn: string; args: Record<string, unknown> }[],
    bucket: [] as string[],
    remove: [] as string[][],
  };
  const pg = (r: Pg | undefined) => {
    if (r === 'throw') throw new Error(`boom ${U}/secret/path`);
    return Promise.resolve(r ?? { data: [], error: null });
  };
  const client: PurgeDbClient = {
    from: (table) => {
      calls.from.push(table);
      return {
        select: (cols) => {
          calls.select.push(cols);
          return {
            not: (...a) => {
              calls.not.push(a);
              return {
                lte: (...b) => {
                  calls.lte.push(b);
                  return {
                    order: (...c) => {
                      calls.order.push(c);
                      return {
                        limit: (n) => {
                          calls.limit.push(n);
                          return pg(o.select) as never;
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        update: (values) => {
          calls.update.push(values);
          return {
            eq: (...a) => {
              calls.eq.push(a);
              return {
                eq: (...b) => {
                  calls.eq.push(b);
                  return pg(o.update);
                },
              };
            },
          };
        },
      };
    },
    rpc: (fn, args) => {
      calls.rpc.push({ fn, args });
      return pg(o.rpc?.(fn, args));
    },
    storage: {
      from: (bucket) => {
        calls.bucket.push(bucket);
        return {
          remove: (paths) => {
            calls.remove.push(paths);
            if (o.remove === 'throw') throw new Error(`boom ${paths.join(',')}`);
            return Promise.resolve(o.remove ?? { data: null, error: null });
          },
        };
      },
    },
  };
  return { client, calls };
}

describe('purgeExpiredAudio: expired rows (T-046)', () => {
  it('(AC-T46-3) (TC-6) removes each table batch once and clears every row', async () => {
    const { deps, calls } = makeDeps({
      expired: { shadow_attempt: ok([expired(1), expired(2), expired(3)]), evening_answer: ok([expired(4), expired(5)]) },
    });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(calls.remove.slice(0, 2)).toEqual([[sp(1), sp(2), sp(3)], [sp(4), sp(5)]]);
    expect(calls.clear).toHaveLength(5);
    expect(run.stats.shadow).toEqual({ selected: 3, purged: 3, failed: 0 });
    expect(run.stats.evening).toEqual({ selected: 2, purged: 2, failed: 0 });
    expect(run.error).toBeNull();
  });

  it('(AC-T46-3) (TC-7) a successful remove counts every row as purged even if some objects never existed', async () => {
    const { deps } = makeDeps({ expired: { shadow_attempt: ok([expired(1), expired(2)]) } });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(run.stats.shadow).toEqual({ selected: 2, purged: 2, failed: 0 });
  });

  it('(AC-T46-4) (TC-8) a failed remove skips clearAudioPath for that table and counts the whole batch as failed', async () => {
    const { deps, calls } = makeDeps({
      expired: { shadow_attempt: ok([expired(1), expired(2), expired(3)]), evening_answer: ok([expired(4)]) },
      remove: (_p, call) => (call === 0 ? err(removeFailed) : ok(null)),
    });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(run.stats.shadow).toEqual({ selected: 3, purged: 0, failed: 3 });
    expect(run.stats.evening).toEqual({ selected: 1, purged: 1, failed: 0 });
    expect(calls.clear.map(([t]) => t)).toEqual(['evening_answer']);
  });

  it('(AC-T46-4) (TC-9) a failed clearAudioPath only fails that row', async () => {
    const { deps } = makeDeps({
      expired: { shadow_attempt: ok([expired(1), expired(2), expired(3)]) },
      clear: (_t, row) => (row.id === 'id-2' ? err(dbFailed) : ok(null)),
    });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(run.stats.shadow).toEqual({ selected: 3, purged: 2, failed: 1 });
  });

  it('(AC-T46-5) (TC-10) limit defaults to 200 and can be passed; tables are listed in order', async () => {
    const a = makeDeps();
    await purgeExpiredAudio(a.deps, NOW);
    expect(a.calls.listExpired.map(([t, n, l]) => [t, n, l])).toEqual([
      ['shadow_attempt', NOW, 200],
      ['evening_answer', NOW, 200],
    ]);
    const b = makeDeps();
    await purgeExpiredAudio(b.deps, NOW, 5);
    expect(b.calls.listExpired.map(([, , l]) => l)).toEqual([5, 5]);
    expect(b.calls.listOrphan[0]?.[1]).toBe(5);
  });

  it('(AC-T46-5) (TC-11) one failing table does not stop the other; error is the first error and stats keep the rest', async () => {
    const { deps, calls } = makeDeps({
      expired: { shadow_attempt: err(dbFailed), evening_answer: ok([expired(4)]) },
      orphanPages: [ok([orphan(9)])],
    });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(run.error).toEqual(dbFailed);
    expect(run.phase).toBe('shadow');
    expect(run.stats.shadow).toEqual({ selected: 0, purged: 0, failed: 0 });
    expect(run.stats.evening).toEqual({ selected: 1, purged: 1, failed: 0 });
    expect(run.stats.orphan).toEqual({ selected: 1, purged: 1, failed: 0 });
    expect(calls.remove).toHaveLength(2);
  });

  it('(AC-T46-5) (TC-12) nothing expired and no orphans means no remove and all-zero stats', async () => {
    const { deps, calls } = makeDeps();
    const run = await purgeExpiredAudio(deps, NOW);
    expect(calls.remove).toHaveLength(0);
    expect(run).toEqual({
      stats: {
        shadow: { selected: 0, purged: 0, failed: 0 },
        evening: { selected: 0, purged: 0, failed: 0 },
        orphan: { selected: 0, purged: 0, failed: 0 },
      },
      error: null,
    });
  });
});

describe('purgeDepsFrom (T-046)', () => {
  const row = (n: number) => ({ id: `id-${String(n)}`, audio_path: sp(n), audio_expires_at: '2026-11-01T00:00:00Z' });

  it('(AC-T46-6) (TC-13) listExpired selects exactly three columns with the documented filter, order and limit', async () => {
    const { client, calls } = fakeClient({ select: { data: [row(1), row(2)], error: null } });
    const r = expectOk(await purgeDepsFrom(client).listExpired('evening_answer', NOW, 7));
    expect(r).toEqual([expired(1), expired(2)]);
    expect(calls.from).toEqual(['evening_answer']);
    expect(calls.select).toEqual(['id,audio_path,audio_expires_at']);
    expect(calls.not).toEqual([['audio_path', 'is', null]]);
    expect(calls.lte).toEqual([['audio_expires_at', NOW.toISOString()]]);
    expect(calls.order).toEqual([['audio_expires_at', { ascending: true }]]);
    expect(calls.limit).toEqual([7]);
  });

  it('(AC-T46-6) (TC-14) clearAudioPath only sets audio_path to null by id and audio_path; remove sends the whole batch to the audio bucket', async () => {
    const { client, calls } = fakeClient();
    const deps = purgeDepsFrom(client);
    expectOk(await deps.clearAudioPath('shadow_attempt', expired(1)));
    expect(calls.update).toEqual([{ audio_path: null }]);
    expect(calls.eq).toEqual([
      ['id', 'id-1'],
      ['audio_path', sp(1)],
    ]);
    expectOk(await deps.removeObjects([sp(1), sp(2)]));
    expect(calls.bucket).toEqual(['audio']);
    expect(calls.remove).toEqual([[sp(1), sp(2)]]);
  });

  it('(AC-T46-6) (TC-15) supabase-js errors and exceptions become db_failed or storage_failed(delete) without paths', async () => {
    const denied = { data: null, error: { code: '42501', message: `denied ${sp(1)}` } } as const;
    const query = purgeDepsFrom(fakeClient({ select: denied }).client);
    const e1 = expectErr(await query.listExpired('shadow_attempt', NOW, 1));
    const e2 = expectErr(await purgeDepsFrom(fakeClient({ select: 'throw' }).client).listExpired('shadow_attempt', NOW, 1));
    const e3 = expectErr(await purgeDepsFrom(fakeClient({ update: denied }).client).clearAudioPath('shadow_attempt', expired(1)));
    const e4 = expectErr(
      await purgeDepsFrom(fakeClient({ remove: { data: null, error: { message: `nope ${sp(1)}` } } }).client).removeObjects([sp(1)]),
    );
    const e5 = expectErr(await purgeDepsFrom(fakeClient({ remove: 'throw' }).client).removeObjects([sp(1)]));
    expect([e1.kind, e2.kind, e3.kind]).toEqual(['db_failed', 'db_failed', 'db_failed']);
    expect(e4).toMatchObject({ kind: 'storage_failed', op: 'delete' });
    expect(e5).toMatchObject({ kind: 'storage_failed', op: 'delete' });
    for (const e of [e1, e2, e3, e4, e5]) expect(e.message).not.toContain(U);
  });

  it('(AC-T46-13) (TC-27) listOrphanCandidates uses the RPC with ISO cutoff and limit, never Storage list; wrong shapes fail as list', async () => {
    const good = fakeClient({
      rpc: () => ({ data: [{ object_name: sp(1), created_at: '2026-11-20T00:00:00.123456+00:00' }], error: null }),
    });
    const r = expectOk(await purgeDepsFrom(good.client).listOrphanCandidates(CUTOFF, 200, null));
    expect(r).toEqual([{ path: sp(1), createdAt: '2026-11-20T00:00:00.123456+00:00' }]);
    expect(good.calls.rpc).toEqual([
      { fn: 'list_orphan_audio_objects', args: { p_cutoff: CUTOFF.toISOString(), p_limit: 200 } },
    ]);
    expect(good.calls.bucket).toEqual([]);
    const withCursor = fakeClient();
    await purgeDepsFrom(withCursor.client).listOrphanCandidates(CUTOFF, 200, { createdAt: 'T', name: 'n' });
    expect(withCursor.calls.rpc[0]?.args).toMatchObject({ p_after_created_at: 'T', p_after_name: 'n' });
    const bad = fakeClient({ rpc: () => ({ data: [{ foo: 1 }], error: null }) });
    expect(expectErr(await purgeDepsFrom(bad.client).listOrphanCandidates(CUTOFF, 200, null))).toMatchObject({
      kind: 'storage_failed',
      op: 'list',
    });
  });

  it('(AC-T46-14) (TC-30) pathsInUse goes through the RPC with a path array, no in() query, no user_id; null data is db_failed', async () => {
    const used = fakeClient({ rpc: () => ({ data: [{ audio_path: sp(2) }], error: null }) });
    expect(expectOk(await purgeDepsFrom(used.client).pathsInUse([sp(1), sp(2)]))).toEqual([sp(2)]);
    expect(used.calls.rpc).toEqual([{ fn: 'audio_paths_in_use', args: { p_paths: [sp(1), sp(2)] } }]);
    expect(used.calls.from).toEqual([]);
    expect(JSON.stringify(used.calls.rpc)).not.toContain('user_id');
    const nul = fakeClient({ rpc: () => ({ data: null, error: null }) });
    expect(expectErr(await purgeDepsFrom(nul.client).pathsInUse([sp(1)])).kind).toBe('db_failed');
  });

  it('(AC-T46-15) (TC-33) RPC errors and exceptions map to storage_failed(list) or db_failed, with no path in the message', async () => {
    const denied = { data: null, error: { code: '42501', message: `denied ${sp(1)}` } } as const;
    const listErr = expectErr(await purgeDepsFrom(fakeClient({ rpc: () => denied }).client).listOrphanCandidates(CUTOFF, 1, null));
    const listThrow = expectErr(await purgeDepsFrom(fakeClient({ rpc: () => 'throw' }).client).listOrphanCandidates(CUTOFF, 1, null));
    const useErr = expectErr(await purgeDepsFrom(fakeClient({ rpc: () => denied }).client).pathsInUse([sp(1)]));
    const useThrow = expectErr(await purgeDepsFrom(fakeClient({ rpc: () => 'throw' }).client).pathsInUse([sp(1)]));
    expect(listErr).toMatchObject({ kind: 'storage_failed', op: 'list' });
    expect(listThrow).toMatchObject({ kind: 'storage_failed', op: 'list' });
    expect(useErr.kind).toBe('db_failed');
    expect(useThrow.kind).toBe('db_failed');
    for (const e of [listErr, listThrow, useErr, useThrow]) expect(e.message).not.toContain(U);
  });
});

describe('purgeOrphans (T-046)', () => {
  it('(AC-T46-13) (TC-26) runs after the expired tables; cutoff is now - 24h, limit 200, first cursor null; one remove for all candidates', async () => {
    const { deps, calls } = makeDeps({
      expired: { shadow_attempt: ok([expired(1)]) },
      orphanPages: [ok([orphan(10), orphan(11), orphan(12)])],
    });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(calls.listOrphan).toEqual([[CUTOFF, 200, null]]);
    expect(calls.remove).toEqual([[sp(1)], [sp(10), sp(11), sp(12)]]);
    expect(run.stats.orphan).toEqual({ selected: 3, purged: 3, failed: 0 });
    expect(run.error).toBeNull();
  });

  it('(AC-T46-13) (TC-28) the application layer does not pre-filter rows that also appear in the expired list', async () => {
    const { deps, calls } = makeDeps({
      expired: { shadow_attempt: ok([expired(10)]) },
      orphanPages: [ok([orphan(10), orphan(11)])],
    });
    await purgeExpiredAudio(deps, NOW);
    expect(calls.inUse).toEqual([[sp(10), sp(11)]]);
  });

  it('(AC-T46-14) (TC-29) rows still in use are dropped before remove but stay in selected; all-in-use skips remove', async () => {
    const some = makeDeps({ orphanPages: [ok(page(1, 3))], inUse: () => ok([sp(2)]) });
    const r1 = await purgeExpiredAudio(some.deps, NOW);
    expect(some.calls.remove).toEqual([[sp(1), sp(3)]]);
    expect(r1.stats.orphan).toEqual({ selected: 3, purged: 2, failed: 0 });
    const all = makeDeps({ orphanPages: [ok(page(1, 3))], inUse: (p) => ok(p) });
    const r2 = await purgeExpiredAudio(all.deps, NOW);
    expect(all.calls.remove).toHaveLength(0);
    expect(r2.stats.orphan).toEqual({ selected: 3, purged: 0, failed: 0 });
    expect(r2.error).toBeNull();
  });

  it('(AC-T46-14) (TC-31) a failing remove counts the batch as failed and leaves error null', async () => {
    const { deps } = makeDeps({ orphanPages: [ok(page(1, 3))], remove: () => err(removeFailed) });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(run.stats.orphan).toEqual({ selected: 3, purged: 0, failed: 3 });
    expect(run.error).toBeNull();
  });

  it('(AC-T46-15) (TC-33) a failing first list stops the orphan phase with storage_failed(list) and keeps the expired work', async () => {
    const { deps, calls } = makeDeps({
      expired: { evening_answer: ok([expired(4)]) },
      orphanPages: [err(listFailed)],
    });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(run.error).toEqual(listFailed);
    expect(run.phase).toBe('orphan');
    expect(run.stats.evening.purged).toBe(1);
    expect(calls.listOrphan).toHaveLength(1);
    expect(calls.inUse).toHaveLength(0);
  });

  it('(AC-T46-15) (TC-33) a list failure on the 2nd call keeps what was already deleted', async () => {
    const { deps } = makeDeps({ orphanPages: [ok(page(1, 200)), err(listFailed)] });
    const run = await purgeExpiredAudio(deps, NOW);
    expect(run.error).toEqual(listFailed);
    expect(run.stats.orphan).toEqual({ selected: 200, purged: 200, failed: 0 });
  });

  it('(AC-T46-17) (TC-35) at most 5 list calls; stops early on a short page; the cursor repeats the last row verbatim', async () => {
    const full = makeDeps({ orphanPages: [0, 1, 2, 3, 4, 5].map((i) => ok(page(i * 200, 200))) });
    const r1 = await purgeExpiredAudio(full.deps, NOW);
    expect(PURGE_ORPHAN_MAX_CALLS).toBe(5);
    expect(full.calls.listOrphan).toHaveLength(5);
    expect(r1.stats.orphan.selected).toBe(1000);

    const p1 = page(0, 200);
    const short = makeDeps({ orphanPages: [ok(p1), ok(page(200, 50)), ok(page(250, 10))] });
    const r2 = await purgeExpiredAudio(short.deps, NOW);
    expect(short.calls.listOrphan).toHaveLength(2);
    expect(short.calls.listOrphan[1]?.[2]).toEqual({ createdAt: '2026-11-20T00:00:00.000199+00:00', name: sp(199) });
    expect(r2.stats.orphan.selected).toBe(250);
  });

  it('(AC-T46-17) (TC-36) a poison batch does not block newer orphans; a batch emptied by the recheck still advances the cursor', async () => {
    const poison = makeDeps({
      orphanPages: [ok(page(0, 200)), ok(page(200, 30))],
      remove: (_p, call) => (call === 0 ? err(removeFailed) : ok(null)),
    });
    const r1 = await purgeExpiredAudio(poison.deps, NOW);
    expect(r1.stats.orphan).toEqual({ selected: 230, purged: 30, failed: 200 });
    expect(r1.error).toBeNull();
    expect(poison.calls.listOrphan[1]?.[2]?.name).toBe(sp(199));

    const emptied = makeDeps({ orphanPages: [ok(page(0, 200)), ok([])], inUse: (p) => ok(p) });
    const r2 = await purgeExpiredAudio(emptied.deps, NOW);
    expect(emptied.calls.inUse).toHaveLength(1);
    expect(emptied.calls.remove).toHaveLength(0);
    expect(emptied.calls.listOrphan).toHaveLength(2);
    expect(emptied.calls.listOrphan[1]?.[2]?.name).toBe(sp(199));
    expect(r2.stats.orphan).toEqual({ selected: 200, purged: 0, failed: 0 });
  });

  it('(AC-T46-17) (TC-37) a failed recheck stops the orphan phase without counting purged or failed; expired tables still run', async () => {
    const first = makeDeps({
      expired: { shadow_attempt: ok([expired(1)]) },
      orphanPages: [ok(page(100, 200))],
      inUse: () => err(dbFailed),
    });
    const r1 = await purgeExpiredAudio(first.deps, NOW);
    expect(first.calls.remove).toEqual([[sp(1)]]);
    expect(first.calls.listOrphan).toHaveLength(1);
    expect(r1.error).toEqual(dbFailed);
    expect(r1.phase).toBe('orphan');
    expect(r1.stats.orphan).toEqual({ selected: 200, purged: 0, failed: 0 });
    expect(r1.stats.shadow.purged).toBe(1);

    const second = makeDeps({
      orphanPages: [ok(page(0, 200)), ok(page(200, 200))],
      inUse: (p, call) => (call === 0 ? ok([]) : err(dbFailed)),
    });
    const r2 = await purgeExpiredAudio(second.deps, NOW);
    expect(r2.stats.orphan).toEqual({ selected: 400, purged: 200, failed: 0 });
    expect(second.calls.remove).toHaveLength(1);
    expect(r2.error).toEqual(dbFailed);
  });

  it('(AC-T46-17) (TC-41) an empty list ends the loop without recheck or remove; a full page is followed by one more list that counts toward the cap', async () => {
    const none = makeDeps({ orphanPages: [ok([])] });
    const r0 = await purgeExpiredAudio(none.deps, NOW);
    expect(none.calls.listOrphan).toHaveLength(1);
    expect(none.calls.inUse).toHaveLength(0);
    expect(none.calls.remove).toHaveLength(0);
    expect(r0.stats.orphan).toEqual({ selected: 0, purged: 0, failed: 0 });
    expect(r0.error).toBeNull();

    const exact = makeDeps({ orphanPages: [ok(page(0, 200)), ok([]), ok(page(500, 5))] });
    const r1 = await purgeExpiredAudio(exact.deps, NOW);
    expect(exact.calls.listOrphan).toHaveLength(2);
    expect(exact.calls.inUse).toHaveLength(1);
    expect(exact.calls.remove).toHaveLength(1);
    expect(r1.stats.orphan).toEqual({ selected: 200, purged: 200, failed: 0 });

    const capped = makeDeps({ orphanPages: [0, 1, 2, 3].map((i) => ok(page(i * 200, 200))).concat([ok([]), ok(page(900, 3))]) });
    const r2 = await purgeExpiredAudio(capped.deps, NOW);
    expect(capped.calls.listOrphan).toHaveLength(5);
    expect(capped.calls.inUse).toHaveLength(4);
    expect(capped.calls.remove).toHaveLength(4);
    expect(r2.stats.orphan.selected).toBe(800);
  });
});

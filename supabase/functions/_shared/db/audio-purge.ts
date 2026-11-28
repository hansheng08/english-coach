import {
  err,
  ok,
  StoragePathSchema,
  tryCatchAsync,
  type AppError,
  type Result,
  type StoragePath,
} from '@english-coach/contracts';
import { runDb } from './client.ts';

// ARCHITECTURE §4.12.2、§4.12.2.1。secret 金鑰（繞過 RLS）的跨使用者維護查詢，只做表上寫的事（§4.12.5）。
// 本檔不建立 secret client（PurgeDbClient 由 secret client 滿足）、不寫 log、不丟例外。

export type AudioTable = 'shadow_attempt' | 'evening_answer';
export type ExpiredAudio = { readonly id: string; readonly audioPath: StoragePath };
export type OrphanObject = { readonly path: StoragePath; readonly createdAt: string };
export type OrphanCursor = { readonly createdAt: string; readonly name: string };

export type PurgeDeps = {
  readonly listExpired: (
    table: AudioTable,
    now: Date,
    limit: number,
  ) => Promise<Result<readonly ExpiredAudio[], AppError>>;
  readonly removeObjects: (paths: readonly StoragePath[]) => Promise<Result<null, AppError>>;
  readonly clearAudioPath: (table: AudioTable, row: ExpiredAudio) => Promise<Result<null, AppError>>;
  readonly listOrphanCandidates: (
    cutoff: Date,
    limit: number,
    after: OrphanCursor | null,
  ) => Promise<Result<readonly OrphanObject[], AppError>>;
  readonly pathsInUse: (paths: readonly StoragePath[]) => Promise<Result<readonly StoragePath[], AppError>>;
};

type PgResult<T> = PromiseLike<{
  readonly data: T | null;
  readonly error: { readonly code?: string; readonly message: string } | null;
}>;

/** 最小的 supabase-js 子集；secret client 的回傳型別同時滿足 DbClient 與它。測試用「記錄呼叫」的假物件。 */
export interface PurgeDbClient {
  from(table: AudioTable): {
    select(columns: string): {
      not(
        column: string,
        op: 'is',
        value: null,
      ): {
        lte(column: string, value: string): {
          order(
            column: string,
            options: { ascending: boolean },
          ): { limit(n: number): PgResult<readonly Record<string, unknown>[]> };
        };
      };
    };
    update(values: { audio_path: null }): {
      eq(column: 'id', value: string): { eq(column: 'audio_path', value: string): PgResult<unknown> };
    };
  };
  rpc(fn: 'list_orphan_audio_objects' | 'audio_paths_in_use', args: Record<string, unknown>): PgResult<unknown>;
  readonly storage: {
    from(bucket: 'audio'): {
      remove(paths: string[]): PromiseLike<{
        readonly data: unknown;
        readonly error: { readonly message: string } | null;
      }>;
    };
  };
}

export type PurgeTableStats = { readonly selected: number; readonly purged: number; readonly failed: number };
export type PurgeStats = {
  readonly shadow: PurgeTableStats;
  readonly evening: PurgeTableStats;
  readonly orphan: PurgeTableStats;
};
export type PurgePhase = 'shadow' | 'evening' | 'orphan';
/** stats 永遠有（沒跑到的階段全 0）；error 是第一個錯誤；phase 是該錯誤發生的階段（只在 error 非 null 時有，給 handler 的 log 用）。 */
export type PurgeRun = { readonly stats: PurgeStats; readonly error: AppError | null; readonly phase?: PurgePhase };

export const PURGE_BATCH_LIMIT = 200;
export const PURGE_ORPHAN_MAX_CALLS = 5;

const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const EMPTY: PurgeTableStats = { selected: 0, purged: 0, failed: 0 };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const listFailed = (): AppError => ({ kind: 'storage_failed', op: 'list', message: 'list orphan audio failed' });
const deleteFailed = (): AppError => ({ kind: 'storage_failed', op: 'delete', message: 'remove audio objects failed' });

export function purgeDepsFrom(client: PurgeDbClient): PurgeDeps {
  return {
    listExpired: async (table, now, limit) => {
      const res = await runDb(`list expired ${table}`, () =>
        client
          .from(table)
          .select('id,audio_path,audio_expires_at')
          .not('audio_path', 'is', null)
          .lte('audio_expires_at', now.toISOString())
          .order('audio_expires_at', { ascending: true })
          .limit(limit),
      );
      if (!res.ok) return err(res.error);
      if (!Array.isArray(res.value)) return err({ kind: 'db_failed', message: `list expired ${table} failed` });
      const rows: ExpiredAudio[] = [];
      for (const row of res.value as readonly unknown[]) {
        if (!isRecord(row) || typeof row['id'] !== 'string') continue;
        const path = StoragePathSchema.safeParse(row['audio_path']);
        if (path.success) rows.push({ id: row['id'], audioPath: path.data });
      }
      return ok(rows);
    },

    removeObjects: async (paths) => {
      const res = await tryCatchAsync(
        async () => await client.storage.from('audio').remove([...paths]),
        deleteFailed,
      );
      if (!res.ok) return err(res.error);
      return res.value.error === null ? ok(null) : err(deleteFailed());
    },

    clearAudioPath: async (table, row) => {
      const res = await runDb(`clear audio_path ${table}`, () =>
        client.from(table).update({ audio_path: null }).eq('id', row.id).eq('audio_path', row.audioPath),
      );
      return res.ok ? ok(null) : err(res.error);
    },

    listOrphanCandidates: async (cutoff, limit, after) => {
      const args: Record<string, unknown> = { p_cutoff: cutoff.toISOString(), p_limit: limit };
      if (after !== null) {
        args['p_after_created_at'] = after.createdAt;
        args['p_after_name'] = after.name;
      }
      const res = await tryCatchAsync(async () => await client.rpc('list_orphan_audio_objects', args), listFailed);
      if (!res.ok) return err(res.error);
      const { data, error } = res.value;
      if (error !== null || !Array.isArray(data)) return err(listFailed());
      const rows: OrphanObject[] = [];
      for (const row of data as readonly unknown[]) {
        if (!isRecord(row) || typeof row['created_at'] !== 'string') return err(listFailed());
        const path = StoragePathSchema.safeParse(row['object_name']);
        if (!path.success) return err(listFailed());
        rows.push({ path: path.data, createdAt: row['created_at'] });
      }
      return ok(rows);
    },

    pathsInUse: async (paths) => {
      const res = await runDb('audio paths in use', () => client.rpc('audio_paths_in_use', { p_paths: [...paths] }));
      if (!res.ok) return err(res.error);
      const bad = (): AppError => ({ kind: 'db_failed', message: 'audio paths in use failed (shape)' });
      if (!Array.isArray(res.value)) return err(bad());
      const used: StoragePath[] = [];
      for (const row of res.value as readonly unknown[]) {
        if (!isRecord(row)) return err(bad());
        const path = StoragePathSchema.safeParse(row['audio_path']);
        if (!path.success) return err(bad());
        used.push(path.data);
      }
      return ok(used);
    },
  };
}

async function purgeTable(
  deps: PurgeDeps,
  table: AudioTable,
  now: Date,
  limit: number,
): Promise<{ readonly stats: PurgeTableStats; readonly error: AppError | null }> {
  const listed = await deps.listExpired(table, now, limit);
  if (!listed.ok) return { stats: EMPTY, error: listed.error };
  const rows = listed.value;
  if (rows.length === 0) return { stats: EMPTY, error: null };
  const removed = await deps.removeObjects(rows.map((r) => r.audioPath));
  if (!removed.ok) return { stats: { selected: rows.length, purged: 0, failed: rows.length }, error: null };
  let purged = 0;
  let failed = 0;
  for (const row of rows) {
    const cleared = await deps.clearAudioPath(table, row);
    if (cleared.ok) purged += 1;
    else failed += 1;
  }
  return { stats: { selected: rows.length, purged, failed }, error: null };
}

/** 孤兒階段（§4.12.2.1）：最多 PURGE_ORPHAN_MAX_CALLS 次列出，游標推進到每次回傳的最後一列。 */
export async function purgeOrphans(
  deps: PurgeDeps,
  now: Date,
  limit: number = PURGE_BATCH_LIMIT,
): Promise<{ readonly stats: PurgeTableStats; readonly error: AppError | null }> {
  const cutoff = new Date(now.getTime() - ORPHAN_AGE_MS);
  let selected = 0;
  let purged = 0;
  let failed = 0;
  let cursor: OrphanCursor | null = null;
  const current = (): PurgeTableStats => ({ selected, purged, failed });

  for (let call = 0; call < PURGE_ORPHAN_MAX_CALLS; call += 1) {
    const listed = await deps.listOrphanCandidates(cutoff, limit, cursor);
    if (!listed.ok) return { stats: current(), error: listed.error };
    const rows = listed.value;
    const last = rows[rows.length - 1];
    if (last === undefined) break;
    selected += rows.length;
    cursor = { createdAt: last.createdAt, name: last.path };

    const inUse = await deps.pathsInUse(rows.map((r) => r.path));
    if (!inUse.ok) return { stats: current(), error: inUse.error };
    const used = new Set<string>(inUse.value);
    const remaining = rows.map((r) => r.path).filter((p) => !used.has(p));
    if (remaining.length > 0) {
      const removed = await deps.removeObjects(remaining);
      if (removed.ok) purged += remaining.length;
      else failed += remaining.length;
    }
    if (rows.length < limit) break;
  }
  return { stats: current(), error: null };
}

/** 入口：shadow 到期、evening 到期、孤兒三個階段彼此獨立；error 是第一個錯誤。不丟例外、不寫 log。 */
export async function purgeExpiredAudio(
  deps: PurgeDeps,
  now: Date,
  limit: number = PURGE_BATCH_LIMIT,
): Promise<PurgeRun> {
  const shadow = await purgeTable(deps, 'shadow_attempt', now, limit);
  const evening = await purgeTable(deps, 'evening_answer', now, limit);
  const orphan = await purgeOrphans(deps, now, limit);
  const stats: PurgeStats = { shadow: shadow.stats, evening: evening.stats, orphan: orphan.stats };
  if (shadow.error !== null) return { stats, error: shadow.error, phase: 'shadow' };
  if (evening.error !== null) return { stats, error: evening.error, phase: 'evening' };
  if (orphan.error !== null) return { stats, error: orphan.error, phase: 'orphan' };
  return { stats, error: null };
}

import { err, ok, UserIdSchema, type AppError, type Result, type UserId } from '@english-coach/contracts';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseSecretEnv } from '../config/env.ts';
import type { PurgeDbClient } from './audio-purge.ts';
import { planDbClientFrom, runDb, type DbClient, type PlanDbClient } from './client.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * 有哪些使用者要備料（ARCHITECTURE §4.12.5 的例外之一）：只讀 `profile.user_id`，不讀其他欄位。
 * 其他查詢都經 PlanStore（每個查詢都帶 user_id）。
 */
export async function listProfileUserIds(client: PlanDbClient): Promise<Result<readonly UserId[], AppError>> {
  const res = await runDb('select profile', () => client.from('profile').select('user_id'));
  if (!res.ok) return err(res.error);
  if (!Array.isArray(res.value)) return err({ kind: 'db_failed', message: 'select profile returned an unexpected shape' });
  const rows: readonly unknown[] = res.value;
  const ids: UserId[] = [];
  for (const row of rows) {
    const id = isRecord(row) ? UserIdSchema.safeParse(row['user_id']) : null;
    if (id === null || !id.success) return err({ kind: 'db_failed', message: 'select profile returned an unexpected shape' });
    ids.push(id.data);
  }
  return ok(ids);
}

/**
 * secret 金鑰的 client（繞過 RLS）：只給 purge-audio、daily-prep（CLAUDE.md §5 第 14、15 條）。
 * 只能在各函式的 index.ts 建立（tooling/secret-client-scope.test.ts 固定檔案清單）。
 * 以逐方法轉接的方式滿足 PurgeDbClient，避免 supabase-js 的完整型別和最小介面互相比對；`plan` 是 PlanStore 用的查詢鏈。
 */
export function createServiceClient(env: SupabaseSecretEnv): DbClient & PurgeDbClient & { readonly plan: PlanDbClient } {
  const client = createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    from: (table) => ({
      insert: (row: Readonly<Record<string, unknown>>) => client.from(table).insert(row),
      select: (columns) => ({
        not: (column, op, value) => ({
          lte: (lteColumn, lteValue) => ({
            order: (orderColumn, options) => ({
              limit: async (n) => {
                const res = await client
                  .from(table)
                  .select(columns)
                  .not(column, op, value)
                  .lte(lteColumn, lteValue)
                  .order(orderColumn, options)
                  .limit(n);
                return { data: res.data === null ? null : res.data.flatMap((row: unknown) => (isRecord(row) ? [row] : [])), error: res.error };
              },
            }),
          }),
        }),
      }),
      update: (values) => ({
        eq: (idColumn, id) => ({
          eq: (pathColumn, path) => client.from(table).update(values).eq(idColumn, id).eq(pathColumn, path),
        }),
      }),
    }),
    rpc: (fn, args) => client.rpc(fn, args),
    plan: planDbClientFrom(client),
    storage: { from: (bucket) => ({ remove: (paths) => client.storage.from(bucket).remove(paths) }) },
  };
}

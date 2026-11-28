import { createClient } from '@supabase/supabase-js';
import type { SupabaseSecretEnv } from '../config/env.ts';
import type { PurgeDbClient } from './audio-purge.ts';
import type { DbClient } from './client.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * secret 金鑰的 client（繞過 RLS）：只給 purge-audio、daily-prep（CLAUDE.md §5 第 14、15 條）。
 * 只能在各函式的 index.ts 建立（tooling/secret-client-scope.test.ts 固定檔案清單）。
 * 以逐方法轉接的方式滿足 PurgeDbClient，避免 supabase-js 的完整型別和最小介面互相比對。
 */
export function createServiceClient(env: SupabaseSecretEnv): DbClient & PurgeDbClient {
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
    storage: { from: (bucket) => ({ remove: (paths) => client.storage.from(bucket).remove(paths) }) },
  };
}

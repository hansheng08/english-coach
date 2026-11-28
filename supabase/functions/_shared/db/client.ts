import { err, ok, tryCatchAsync, type AppError, type Result } from '@english-coach/contracts';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseEnv } from '../config/env.ts';
import type { AuthContext } from './auth.ts';

/** supabase-js 回應中 repository 會讀的部分；只在 _shared/db 內使用，不傳出（ADR-008 修訂 1）。 */
export type DbResponse<T> = {
  readonly data: T;
  readonly error: { readonly code?: string | undefined; readonly message: string } | null;
};

/** repository 用到的 supabase-js 最小介面：正式是 createUserClient 的結果，測試給假的。 */
export interface DbClient {
  from(table: string): { insert(row: Readonly<Record<string, unknown>>): PromiseLike<DbResponse<unknown>> };
}

/** POST /reviews 用到的 supabase-js 最小介面：讀一列（`select().eq().maybeSingle()`）與 `rpc`（T-032；定義在這裡以免 client.ts 與 reviews.ts 互相 import）。 */
export interface ReviewDbClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): PromiseLike<DbResponse<Readonly<Record<string, unknown>> | null>> };
    };
  };
  rpc(fn: string, args: Readonly<Record<string, unknown>>): PromiseLike<DbResponse<unknown>>;
}

/** 以使用者身分、受 RLS 限制的 client（ADR-010 決定 3：publishable 金鑰＋該使用者的 token）。 */
export function createUserClient(ctx: AuthContext, env: SupabaseEnv): DbClient & ReviewDbClient {
  const sb = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
  });
  // 手寫轉接：supabase-js 的泛型型別直接指定給兩個最小介面會讓 tsc 超出型別深度（TS2589）。
  return {
    from: (table) => ({
      insert: (row) => sb.from(table).insert(row),
      select: (columns) => ({
        eq: (column, value) => ({
          maybeSingle: async () => {
            const { data, error } = await sb.from(table).select(columns).eq(column, value).maybeSingle();
            const row: unknown = data;
            const isRow = typeof row === 'object' && row !== null && !Array.isArray(row);
            return { data: isRow ? { ...row } : null, error };
          },
        }),
      }),
    }),
    rpc: (fn, args) => sb.rpc(fn, args),
  };
}

/** 把會丟例外或回 `{ error }` 的 supabase-js 呼叫轉成 Result；訊息只有操作名稱與 Postgres 錯誤碼，不含資料（NFR-04）。 */
export async function runDb<T>(op: string, call: () => PromiseLike<DbResponse<T>>): Promise<Result<T, AppError>> {
  const res = await tryCatchAsync(
    async () => await call(),
    (): AppError => ({ kind: 'db_failed', message: `${op} failed` }),
  );
  if (!res.ok) return err(res.error);
  const { data, error } = res.value;
  if (error !== null) {
    return err({ kind: 'db_failed', message: error.code === undefined ? `${op} failed` : `${op} failed (${error.code})` });
  }
  return ok(data);
}

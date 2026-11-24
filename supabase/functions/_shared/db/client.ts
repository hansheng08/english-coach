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

/** 以使用者身分、受 RLS 限制的 client（ADR-010 決定 3：publishable 金鑰＋該使用者的 token）。 */
export function createUserClient(ctx: AuthContext, env: SupabaseEnv): DbClient {
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
  });
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

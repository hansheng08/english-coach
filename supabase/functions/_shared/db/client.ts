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

/**
 * PlanStore（`plan-store.ts`）用到的查詢鏈：每個方法回同一種可 await 的查詢，和 supabase-js 的 PostgREST builder 同名同序。
 * 使用者 client 與 secret client 共用（T-025a；ARCHITECTURE §4.12.5）。
 */
export interface PlanQuery extends PromiseLike<DbResponse<unknown>> {
  select(columns: string): PlanQuery;
  insert(row: Readonly<Record<string, unknown>>): PlanQuery;
  upsert(row: Readonly<Record<string, unknown>>, options: { readonly onConflict: string; readonly ignoreDuplicates: boolean }): PlanQuery;
  update(values: Readonly<Record<string, unknown>>): PlanQuery;
  eq(column: string, value: string | number | boolean): PlanQuery;
  is(column: string, value: null): PlanQuery;
  not(column: string, operator: 'is', value: null): PlanQuery;
  lt(column: string, value: string): PlanQuery;
  gte(column: string, value: string): PlanQuery;
  lte(column: string, value: string): PlanQuery;
  or(filter: string): PlanQuery;
  order(column: string, options?: { readonly ascending: boolean }): PlanQuery;
  limit(count: number): PlanQuery;
  maybeSingle(): PlanQuery;
}
export interface PlanDbClient {
  from(table: string): PlanQuery;
}

const isPlanQuery = (x: unknown): x is PlanQuery => typeof x === 'object' && x !== null;

/** supabase-js 回了意料之外的東西時用：任何鏈式呼叫都回自己，await 時是 `error`（不丟例外）。 */
const brokenQuery: PlanQuery = {
  then: (onfulfilled, onrejected) =>
    Promise.resolve<DbResponse<unknown>>({ data: null, error: { message: 'unexpected query builder' } }).then(onfulfilled, onrejected),
  select: () => brokenQuery,
  insert: () => brokenQuery,
  upsert: () => brokenQuery,
  update: () => brokenQuery,
  eq: () => brokenQuery,
  is: () => brokenQuery,
  not: () => brokenQuery,
  lt: () => brokenQuery,
  gte: () => brokenQuery,
  lte: () => brokenQuery,
  or: () => brokenQuery,
  order: () => brokenQuery,
  limit: () => brokenQuery,
  maybeSingle: () => brokenQuery,
};

/** supabase-js 的 builder 本來就是這個形狀；用型別守衛接上，避免把泛型型別直接指定給介面（TS2589）。 */
export function planDbClientFrom(sb: { from(table: string): unknown }): PlanDbClient {
  return {
    from: (table) => {
      const q = sb.from(table);
      return isPlanQuery(q) ? q : brokenQuery;
    },
  };
}

/** createUserClient 的結果：POST /checkins、POST /reviews 與 PlanStore 各用一個欄位／介面。 */
export type UserClient = DbClient & ReviewDbClient & { readonly plan: PlanDbClient };

/** 以使用者身分、受 RLS 限制的 client（ADR-010 決定 3：publishable 金鑰＋該使用者的 token）。 */
export function createUserClient(ctx: AuthContext, env: SupabaseEnv): UserClient {
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
    plan: planDbClientFrom(sb),
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

import type { AppError, Result, UserId } from '@english-coach/contracts';
import type { SupabaseEnv } from '../config/env.ts';
import type { AuthContext } from './auth.ts';
import { createUserClient, type DbClient } from './client.ts';
import { insertProviderCall, type ProviderCallRecord } from './provider-call.ts';

/** endpoint 拿到的資料庫入口：只有回 Result 的函式，沒有 client、沒有 `{ data, error }`（ADR-008 修訂 1）。 */
export type UserDb = {
  readonly insertProviderCall: (r: ProviderCallRecord) => Promise<Result<null, AppError>>;
};

export function userDbFrom(client: DbClient, userId: UserId): UserDb {
  return { insertProviderCall: (r) => insertProviderCall(client, userId, r) };
}

/** ADR-010 決定 3 的 `createUserDb(ctx)`：受 RLS 限制，user_id 一律取自 AuthContext。 */
export function createUserDb(ctx: AuthContext, env: SupabaseEnv): UserDb {
  return userDbFrom(createUserClient(ctx, env), ctx.userId);
}

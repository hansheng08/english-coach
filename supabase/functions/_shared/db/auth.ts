import {
  err,
  ok,
  tryCatchAsync,
  UserIdSchema,
  type AppError,
  type Brand,
  type Result,
  type UserId,
} from '@english-coach/contracts';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseEnv } from '../config/env.ts';

/** 只有本檔可以建立（ADR-008 修訂 3）。 */
export type AuthContext = Brand<{ readonly userId: UserId; readonly accessToken: string }, 'AuthContext'>;

export type TokenClaims = { readonly role?: unknown; readonly sub?: unknown; readonly is_anonymous?: unknown };
export type VerifyToken = (token: string) => Promise<Result<TokenClaims, AppError>>;
export type RequireUserDeps = { readonly verifyToken: VerifyToken };

const BEARER = /^Bearer\s+(\S+)$/i;

const unauthenticated = (): AppError => ({ kind: 'unauthenticated', message: 'missing or invalid jwt' });

export async function requireUser(req: Request, deps: RequireUserDeps): Promise<Result<AuthContext, AppError>> {
  const header = req.headers.get('Authorization');
  const token = header === null ? undefined : BEARER.exec(header)?.[1];
  if (token === undefined) return err(unauthenticated());

  const verified = await deps.verifyToken(token);
  if (!verified.ok) return err(unauthenticated());

  const claims = verified.value;
  if (claims.role !== 'authenticated' || claims.is_anonymous === true) return err(unauthenticated());

  const userId = UserIdSchema.safeParse(claims.sub);
  if (!userId.success) return err(unauthenticated());

  return ok({ userId: userId.data, accessToken: token } as AuthContext);
}

/** 連網路（getClaims 驗 JWKS），不寫單元測試；由 CI db job 的 401／200 驗證。 */
export function createGetClaimsVerifier(env: SupabaseEnv): VerifyToken {
  const client = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return async (token) => {
    const result = await tryCatchAsync(
      () => client.auth.getClaims(token),
      () => unauthenticated(),
    );
    if (!result.ok) return err(result.error);
    const { data, error } = result.value;
    if (error !== null || data === null) return err(unauthenticated());
    return ok({ role: data.claims.role, sub: data.claims.sub, is_anonymous: data.claims.is_anonymous });
  };
}

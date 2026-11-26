import { createClient } from '@supabase/supabase-js';
import { err, ok, UserIdSchema } from '@english-coach/contracts';
import type { AppError, Result } from '@english-coach/contracts';
import type { ApiClient, AuthSession, LoadedApi } from '../client.ts';

// 只列出會用到的 Supabase Auth 方法：登入、讀 session、登出。刻意不含任何註冊方法（ARCHITECTURE §7：關閉註冊）。
type AuthUser = { readonly id: string; readonly email?: string | undefined };
type AuthFailure = { readonly status?: number | undefined; readonly code?: string | undefined };
export type SupabaseAuthLike = {
  readonly auth: {
    getSession(): Promise<{ data: { session: { user: AuthUser } | null }; error: AuthFailure | null }>;
    signInWithPassword(c: {
      email: string;
      password: string;
    }): Promise<{ data: { session: { user: AuthUser } | null }; error: AuthFailure | null }>;
    signOut(): Promise<{ error: AuthFailure | null }>;
  };
};

const internal = (message: string): AppError => ({ kind: 'internal', message });

function toSession(user: AuthUser): Result<AuthSession, AppError> {
  const id = UserIdSchema.safeParse(user.id);
  if (!id.success) return err(internal('auth user id is not a uuid'));
  return ok({ userId: id.data, email: user.email ?? '' });
}

/** 帳密錯（400／invalid_credentials）→ unauthenticated；其他一律 internal。 */
function isBadCredentials(e: AuthFailure): boolean {
  return e.code === 'invalid_credentials' || e.status === 400 || e.status === 401;
}

export function createSupabaseClient(sb: SupabaseAuthLike): ApiClient {
  return {
    async getSession() {
      try {
        const { data, error } = await sb.auth.getSession();
        if (error !== null) return err(internal('could not read the session'));
        return data.session === null ? ok(null) : toSession(data.session.user);
      } catch {
        return err(internal('could not read the session'));
      }
    },
    async signInWithPassword(email, password) {
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error !== null) {
          return err<AppError>(
            isBadCredentials(error)
              ? { kind: 'unauthenticated', message: 'invalid credentials' }
              : internal('sign-in failed'),
          );
        }
        return data.session === null ? err(internal('sign-in returned no session')) : toSession(data.session.user);
      } catch {
        return err(internal('sign-in failed'));
      }
    },
    async signOut() {
      try {
        const { error } = await sb.auth.signOut();
        return error === null ? ok(undefined) : err(internal('sign-out failed'));
      } catch {
        return err(internal('sign-out failed'));
      }
    },
  };
}

export function createSupabaseApi(url: string, publishableKey: string): LoadedApi {
  return { client: createSupabaseClient(createClient(url, publishableKey)), preview: null };
}

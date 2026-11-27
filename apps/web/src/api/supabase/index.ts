import { createClient } from '@supabase/supabase-js';
import { err, ok, tryCatchAsync, UserIdSchema } from '@english-coach/contracts';
import type { AppError, Result } from '@english-coach/contracts';
import type { ApiClient, ApiRuntime, AuthSession } from '../client';

type AuthErrorLike = { readonly message: string; readonly status?: number | undefined; readonly code?: string | undefined };
type SessionLike = { readonly user: { readonly id: string; readonly email?: string | undefined } };

/** supabase-js 的 auth 只用到這三個方法；測試注入假的。全程不呼叫任何註冊 API（ARCHITECTURE §7）。 */
export interface AuthLike {
  getSession(): Promise<{ data: { session: SessionLike | null }; error: AuthErrorLike | null }>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<{ data: { session: SessionLike | null }; error: AuthErrorLike | null }>;
  signOut(): Promise<{ error: AuthErrorLike | null }>;
}

const internal = (message: string): AppError => ({ kind: 'internal', message });

const isBadCredentials = (e: AuthErrorLike): boolean =>
  e.code === 'invalid_credentials' || (e.status === 400 && /invalid login credentials/i.test(e.message));

function toSession(session: SessionLike): Result<AuthSession, AppError> {
  const userId = UserIdSchema.safeParse(session.user.id);
  if (!userId.success) return err(internal('auth user id is not a UUID'));
  return ok({ userId: userId.data, email: session.user.email ?? '' });
}

export function createSupabaseApiClient(auth: AuthLike): ApiClient {
  return {
    async getSession() {
      const r = await tryCatchAsync(() => auth.getSession(), () => internal('getSession failed'));
      if (!r.ok) return r;
      if (r.value.error !== null) return err(internal('getSession failed'));
      const { session } = r.value.data;
      return session === null ? ok(null) : toSession(session);
    },
    async signInWithPassword(email, password) {
      const r = await tryCatchAsync(() => auth.signInWithPassword({ email, password }), () => internal('signInWithPassword failed'));
      if (!r.ok) return r;
      const { error, data } = r.value;
      if (error !== null) {
        return err(isBadCredentials(error) ? { kind: 'unauthenticated', message: 'invalid credentials' } : internal('signInWithPassword failed'));
      }
      return data.session === null ? err(internal('signInWithPassword returned no session')) : toSession(data.session);
    },
    async signOut() {
      const r = await tryCatchAsync(() => auth.signOut(), () => internal('signOut failed'));
      if (!r.ok) return r;
      return r.value.error === null ? ok(undefined) : err(internal('signOut failed'));
    },
  };
}

/** api/index.ts 在 VITE_DATA_MODE=supabase 時呼叫。URL 與金鑰缺漏在建置時就被 vite.config.ts 擋下。 */
export function createApi(): ApiRuntime {
  const url = import.meta.env.VITE_SUPABASE_URL ?? '';
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  const supabase = createClient(url, key);
  return { client: createSupabaseApiClient(supabase.auth), preview: null };
}

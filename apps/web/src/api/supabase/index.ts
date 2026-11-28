import { createClient } from '@supabase/supabase-js';
import { ApiErrorBodySchema, err, ok, tryCatchAsync, TtsResponseSchema, UserIdSchema } from '@english-coach/contracts';
import type { ApiErrorBody, AppError, Result, StoragePath } from '@english-coach/contracts';
import type { ApiClient, ApiClientDeps, ApiRuntime, AuthSession } from '../client';

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

/** `supabase.storage.from('tts')` 的最小形狀；測試注入假的。 */
export interface SignedUrlSource {
  createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
}

export type SupabaseApiConfig = {
  /** Edge Function `api` 的網址（不含結尾 `/`）。 */
  readonly functionsUrl?: string;
  readonly publishableKey?: string;
  readonly ttsBucket?: SignedUrlSource;
};

const TTS_SIGNED_URL_SECONDS = 3600;
/** 沒有設定 `functionsUrl` 時的預設：本機 `supabase start` 的位址（絕對網址）。`createApi` 一定傳入真正的網址。 */
const LOCAL_FUNCTIONS_URL = 'http://127.0.0.1:54321/functions/v1/api';

/** 伺服器的 `ApiErrorBody`（§5.0.4）→ 前端的 `AppError`；/tts 不會回的種類（not_found 等）統一成 internal。 */
function fromErrorBody(body: ApiErrorBody['error']): AppError {
  const provider = body.provider ?? 'azure-speech';
  const capability = body.capability ?? 'tts';
  switch (body.kind) {
    case 'quota_exhausted':
    case 'rate_limited':
      return { kind: body.kind, provider, capability, message: body.message, retryAfterSec: body.retryAfterSec ?? null };
    case 'paid_not_allowed':
      return { kind: body.kind, provider, capability, message: body.message, reason: body.reason ?? 'no_consent' };
    case 'unavailable':
    case 'timeout':
    case 'auth':
    case 'region_blocked':
    case 'invalid_response':
    case 'not_configured':
      return { kind: body.kind, provider, capability, message: body.message };
    case 'validation':
      return { kind: 'validation', message: body.message, issues: [...(body.issues ?? [])] };
    case 'unauthenticated':
    case 'db_failed':
    case 'plan_not_ready':
    case 'internal':
      return { kind: body.kind, message: body.message };
    case 'storage_failed':
      return { kind: 'storage_failed', op: 'download', message: body.message };
    case 'not_found':
    case 'conflict':
    case 'news_unavailable':
      return internal(`unexpected error kind ${body.kind}`);
    default: {
      const unreachable: never = body.kind;
      return unreachable;
    }
  }
}

const unauthenticated = (): AppError => ({ kind: 'unauthenticated', message: 'not signed in' });

/** 沒傳 deps（只用登入的呼叫端與既有測試）時：全域 fetch、未登入（沒有 token）。正式接線一定在 `createApi` 傳入。 */
const DEFAULT_DEPS: ApiClientDeps = {
  fetch: (input, init) => globalThis.fetch(input, init),
  getAccessToken: () => Promise.resolve(null),
};

export function createSupabaseApiClient(auth: AuthLike, deps: ApiClientDeps = DEFAULT_DEPS, config: SupabaseApiConfig = {}): ApiClient {
  const functionsUrl = config.functionsUrl ?? LOCAL_FUNCTIONS_URL;

  async function postTts(text: string): Promise<Result<unknown, AppError>> {
    const token = await tryCatchAsync(() => deps.getAccessToken(), () => internal('getAccessToken failed'));
    if (!token.ok) return token;
    if (token.value === null) return err(unauthenticated());
    const { value: accessToken } = token;
    const res = await tryCatchAsync(
      () =>
        deps.fetch(`${functionsUrl}/tts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...(config.publishableKey === undefined ? {} : { apikey: config.publishableKey }),
          },
          body: JSON.stringify({ text }),
        }),
      () => internal('tts request failed'),
    );
    if (!res.ok) return res;
    const json = await tryCatchAsync(() => res.value.json() as Promise<unknown>, () => internal('tts response is not JSON'));
    if (!json.ok) return json;
    if (res.value.ok) return ok(json.value);
    const body = ApiErrorBodySchema.safeParse(json.value);
    return err(body.success ? fromErrorBody(body.data.error) : internal('tts error response has an unexpected shape'));
  }

  return {
    async tts(text) {
      const json = await postTts(text);
      if (!json.ok) return json;
      const parsed = TtsResponseSchema.safeParse(json.value);
      return parsed.success ? ok(parsed.data) : err(internal('tts response has an unexpected shape'));
    },
    async ttsSignedUrl(path: StoragePath) {
      const bucket = config.ttsBucket;
      if (bucket === undefined) return err(internal('tts bucket is not configured'));
      const r = await tryCatchAsync(
        async () => await bucket.createSignedUrl(path, TTS_SIGNED_URL_SECONDS),
        () => internal('createSignedUrl failed'),
      );
      if (!r.ok) return r;
      const url = r.value.data?.signedUrl;
      return r.value.error === null && url !== undefined
        ? ok(url)
        : err({ kind: 'storage_failed', op: 'sign', message: 'createSignedUrl failed' });
    },
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
  // 組成根注入 fetch 與 token 來源（§9.1.7）；未登入或取不到 token 回 null，不丟例外。
  const deps: ApiClientDeps = {
    fetch: (input, init) => globalThis.fetch(input, init),
    getAccessToken: async () => {
      const r = await tryCatchAsync(() => supabase.auth.getSession(), () => internal('getSession failed'));
      return r.ok ? (r.value.data.session?.access_token ?? null) : null;
    },
  };
  const client = createSupabaseApiClient(supabase.auth, deps, {
    functionsUrl: `${url}/functions/v1/api`,
    publishableKey: key,
    ttsBucket: supabase.storage.from('tts'),
  });
  return { client, preview: null };
}

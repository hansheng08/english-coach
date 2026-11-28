// TtsStore：POST /tts 要用的資料入口（ARCHITECTURE §4.19、§4.12.1）。使用者 client、受 RLS 限制；
// 對外只有回 Result 的函式，不交出 client（ADR-008 修訂 1）。錯誤訊息不含路徑與文字。
import {
  err,
  ok,
  tryCatchAsync,
  TtsSettingsSchema,
  type AppError,
  type Result,
  type StoragePath,
  type TtsResult,
  type UserId,
  type VoiceId,
} from '@english-coach/contracts';
import type { SupabaseEnv } from '../config/env.ts';
import type { AuthContext } from './auth.ts';
import { createUserClient, runDb, type StorageError, type TtsDbClient } from './client.ts';
import { insertProviderCall, type ProviderCallRecord } from './provider-call.ts';

const TTS_BUCKET = 'tts';
/** signed URL 有效期（§4.12.1）。 */
export const TTS_SIGNED_URL_SECONDS = 3600;

type Res<T> = Promise<Result<T, AppError>>;

export type TtsStore = {
  /** `profile.settings.tts.voice`；沒有 profile 列或沒有 `tts` → 預設語音；`tts` 不合法 → internal。 */
  readonly readVoice: () => Res<VoiceId>;
  /** 物件存在 → 大小（bytes）；不在 → null。 */
  readonly find: (path: StoragePath) => Res<{ readonly bytes: number } | null>;
  /** `upsert: false`；「已存在」（別的請求剛好先傳）也算成功。 */
  readonly upload: (path: StoragePath, audio: Uint8Array, mime: TtsResult['mime']) => Res<null>;
  readonly signedUrl: (path: StoragePath) => Res<string>;
  /** 只轉呼叫 insertProviderCall（不含文字與路徑）。 */
  readonly recordCall: (r: ProviderCallRecord) => Res<null>;
};

const storageFailed = (op: 'download' | 'upload' | 'sign'): AppError => ({
  kind: 'storage_failed',
  op,
  message: `storage ${op} failed`,
});

const isAlreadyExists = (e: StorageError): boolean => e.statusCode === '409' || /already exists|duplicate/i.test(e.message);

/** `<user_id>/<檔名>` → 資料夾與檔名（StoragePathSchema 保證有一個 `/`）。 */
function splitPath(path: StoragePath): { readonly folder: string; readonly name: string } {
  const i = path.indexOf('/');
  return { folder: path.slice(0, i), name: path.slice(i + 1) };
}

async function readVoice(client: TtsDbClient, userId: UserId): Res<VoiceId> {
  const res = await runDb('select profile', () => client.from('profile').select('settings').eq('user_id', userId).maybeSingle());
  if (!res.ok) return err(res.error);
  const settings = res.value?.['settings'];
  const tts = typeof settings === 'object' && settings !== null && 'tts' in settings ? settings.tts : {};
  const parsed = TtsSettingsSchema.safeParse(tts);
  if (!parsed.success) return err({ kind: 'internal', message: 'profile.settings.tts is invalid' });
  return ok(parsed.data.voice);
}

export function ttsStoreFrom(client: TtsDbClient, userId: UserId): TtsStore {
  const bucket = (): ReturnType<TtsDbClient['storage']['from']> => client.storage.from(TTS_BUCKET);
  return {
    readVoice: () => readVoice(client, userId),
    find: async (path) => {
      const { folder, name } = splitPath(path);
      const res = await tryCatchAsync(
        async () => await bucket().list(folder, { search: name, limit: 1 }),
        (): AppError => storageFailed('download'),
      );
      if (!res.ok) return err(res.error);
      if (res.value.error !== null) return err(storageFailed('download'));
      const hit = (res.value.data ?? []).find((f) => f.name === name);
      if (hit === undefined) return ok(null);
      const size: unknown = hit.metadata?.['size'];
      return typeof size === 'number' ? ok({ bytes: size }) : err(storageFailed('download'));
    },
    upload: async (path, audio, mime) => {
      const res = await tryCatchAsync(
        async () => await bucket().upload(path, audio, { contentType: mime, upsert: false }),
        (): AppError => storageFailed('upload'),
      );
      if (!res.ok) return err(res.error);
      if (res.value.error !== null && !isAlreadyExists(res.value.error)) return err(storageFailed('upload'));
      return ok(null);
    },
    signedUrl: async (path) => {
      const res = await tryCatchAsync(
        async () => await bucket().createSignedUrl(path, TTS_SIGNED_URL_SECONDS),
        (): AppError => storageFailed('sign'),
      );
      if (!res.ok) return err(res.error);
      const url = res.value.data?.signedUrl;
      if (res.value.error !== null || url === undefined) return err(storageFailed('sign'));
      return ok(url);
    },
    recordCall: (r) => insertProviderCall(client, userId, r),
  };
}

/** index.ts 的接線：使用者身分，受 RLS 限制。 */
export function createTtsStore(ctx: AuthContext, env: SupabaseEnv): TtsStore {
  return ttsStoreFrom(createUserClient(ctx, env).tts, ctx.userId);
}

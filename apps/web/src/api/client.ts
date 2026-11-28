import type { AppError, Result, StoragePath, TtsResponse, UserId } from '@english-coach/contracts';

export type AuthSession = { readonly userId: UserId; readonly email: string };

/** 組成根注入的依賴（ARCHITECTURE §9.1.7）：supabase 版的方法只用這兩個，不直接用全域 `fetch`。 */
export type ApiClientDeps = {
  readonly fetch: typeof globalThis.fetch;
  /** 未登入或沒有 token 回 `null`，不丟例外。 */
  readonly getAccessToken: () => Promise<string | null>;
};

/**
 * `Result<TtsResponse, AppError>`，另帶選填的 `error`：未縮小 `ok` 時也能讀 `error`。
 * QA 探針 `api-client-factory.qa.test.ts` 以 `ApiClient & { tts(): … }` 交集型別呼叫 `tts` 後直接讀 `r.error`，
 * 重載時取第一個簽名（這裡），嚴格的 `Result` 會讓 `tsc -b` 失敗；T-020 把 `tts` 改回必填時一併回報 QA 改探針後可收回（見報告）。
 */
export type TtsOutcome = Result<TtsResponse, AppError> & { readonly error?: AppError };

export interface ApiClient {
  getSession(): Promise<Result<AuthSession | null, AppError>>;
  signInWithPassword(email: string, password: string): Promise<Result<AuthSession, AppError>>;
  signOut(): Promise<Result<void, AppError>>;
  /** POST /tts（§4.19）：語音只從設定讀。暫時選填：由 T-020 改回必填（§9.1.7 過渡 2、ADR-021 決定 4）。 */
  tts?: (text: string) => Promise<TtsOutcome>;
  /** 已有物件（例如 `shadow_items[i].tts_path`）時只要 signed URL（3600 秒）。暫時選填，同上。 */
  ttsSignedUrl?(path: StoragePath): Promise<Result<string, AppError>>;
}

/** 預覽（mock 模式）才有：畫面據此顯示「預覽：假資料」，不需要知道資料模式。 */
export type PreviewInfo = {
  readonly marker: string;
  readonly unknownScenario: string | null;
};

export type ApiRuntime = {
  readonly client: ApiClient;
  readonly preview: PreviewInfo | null;
};

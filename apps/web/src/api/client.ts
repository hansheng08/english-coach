import type { AppError, Result, UserId } from '@english-coach/contracts';

// 本單只有登入；其他端點由之後的單加（ARCHITECTURE §9.1.1）。
export type AuthSession = { readonly userId: UserId; readonly email: string };

export interface ApiClient {
  getSession(): Promise<Result<AuthSession | null, AppError>>;
  signInWithPassword(email: string, password: string): Promise<Result<AuthSession, AppError>>;
  signOut(): Promise<Result<void, AppError>>;
}

/** mock 模式才有：畫面據此顯示「預覽：假資料」；畫面元件自己不判斷資料模式。 */
export type PreviewInfo = { readonly unknownScenario: string | null };

export type LoadedApi = { readonly client: ApiClient; readonly preview: PreviewInfo | null };

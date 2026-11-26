import type { AppError, Result, UserId } from '@english-coach/contracts';

export type AuthSession = { readonly userId: UserId; readonly email: string };

/** 本單只有登入；其他端點由之後的單加。 */
export interface ApiClient {
  getSession(): Promise<Result<AuthSession | null, AppError>>;
  signInWithPassword(email: string, password: string): Promise<Result<AuthSession, AppError>>;
  signOut(): Promise<Result<void, AppError>>;
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

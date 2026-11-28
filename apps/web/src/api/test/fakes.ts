// 前端測試工廠（ARCHITECTURE §9.1.7、CLAUDE.md §5 第 21 條）：測試一律用它們建 `ApiClient`／`ApiRuntime`，不寫完整物件字面值。
// 正式程式不得 import。加必填方法時，同一個 commit 在這裡補預設值。
import { err } from '@english-coach/contracts';
import type { AppError, Result } from '@english-coach/contracts';
import type { ApiClient, ApiClientDeps, ApiRuntime } from '../client';

const notStubbed = (name: string): Promise<Result<never, AppError>> =>
  Promise.resolve(err({ kind: 'internal', message: `not stubbed: ${name}` }));

/** 沒覆寫的方法回 `err({ kind: 'internal', message: 'not stubbed: <名稱>' })`。 */
export function makeTestApiClient(overrides?: Partial<ApiClient>): ApiClient {
  return {
    getSession: () => notStubbed('getSession'),
    signInWithPassword: () => notStubbed('signInWithPassword'),
    signOut: () => notStubbed('signOut'),
    tts: () => notStubbed('tts'),
    ttsSignedUrl: () => notStubbed('ttsSignedUrl'),
    ...overrides,
  };
}

export type TestApiRuntime = ApiRuntime & { readonly deps: ApiClientDeps };

export type TestApiRuntimeOverrides = {
  readonly client?: Partial<ApiClient>;
  readonly preview?: ApiRuntime['preview'];
  readonly fetch?: ApiClientDeps['fetch'];
  readonly getAccessToken?: ApiClientDeps['getAccessToken'];
};

/**
 * 預設：`client` 是 `makeTestApiClient()`、`preview` 是 `null`、`deps.fetch` 未覆寫就失敗、`deps.getAccessToken` 回 `null`（未登入）。
 */
export function makeTestApiRuntime(overrides?: TestApiRuntimeOverrides): TestApiRuntime {
  return {
    client: makeTestApiClient(overrides?.client),
    preview: overrides?.preview ?? null,
    deps: {
      fetch: overrides?.fetch ?? (() => Promise.reject(new Error('not stubbed: fetch'))),
      getAccessToken: overrides?.getAccessToken ?? (() => Promise.resolve(null)),
    },
  };
}

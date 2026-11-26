import { assertDataModeEnv } from '../../tooling/data-mode-guard.mjs';

export type DataMode = 'mock' | 'supabase';

/**
 * 建置時檢查資料模式。規則只有 O-023 的 tooling/data-mode-guard.mjs 一份，這裡只呼叫它。
 * 不合法就丟 Error（訊息就是 reason，只寫鍵名與原因，不寫值）。
 */
export function dataModeOrThrow(env: Readonly<Record<string, unknown>>): DataMode {
  const r = assertDataModeEnv(env);
  if (!r.ok) throw new Error(r.reason);
  return r.mode;
}

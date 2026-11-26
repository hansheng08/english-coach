export type DataMode = 'mock' | 'supabase';

const MODES: readonly string[] = ['mock', 'supabase'];
const REQUIRED_FOR_SUPABASE = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const;

const has = (env: Readonly<Record<string, unknown>>, key: string): boolean => Object.prototype.hasOwnProperty.call(env, key);
const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

/**
 * 建置時檢查資料模式（ARCHITECTURE §9.1.1、O-023 的 tooling/data-mode-guard.mjs 同一組規則；
 * 該檔是沒有型別宣告的 .mjs，tooling 不在本單範圍，所以這裡同等實作）。
 * 不合法就丟 Error；訊息只寫鍵名與原因，不寫值。
 */
export function dataModeOrThrow(env: Readonly<Record<string, unknown>>): DataMode {
  if (!has(env, 'VITE_DATA_MODE')) throw new Error('VITE_DATA_MODE is not set (no default)');
  const mode = env['VITE_DATA_MODE'];
  if (typeof mode !== 'string' || !MODES.includes(mode)) {
    throw new Error('VITE_DATA_MODE must be exactly "mock" or "supabase"');
  }
  const supabaseKeys = Object.keys(env).filter((k) => k.startsWith('VITE_SUPABASE_'));
  if (mode === 'mock') {
    if (supabaseKeys.length > 0) throw new Error(`mock mode must not define: ${supabaseKeys.join(', ')}`);
    return 'mock';
  }
  const missing = REQUIRED_FOR_SUPABASE.filter((k) => !has(env, k) || blank(env[k]));
  if (missing.length > 0) throw new Error(`supabase mode requires non-empty: ${missing.join(', ')}`);
  return 'supabase';
}

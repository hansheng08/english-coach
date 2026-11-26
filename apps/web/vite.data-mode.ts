// ARCHITECTURE §9.1.1、ADR-014 決定 1：VITE_DATA_MODE 沒有預設值，建置時檢查。
// 規則與 tooling/data-mode-guard.mjs 的 assertDataModeEnv（O-023）相同；那支是 .mjs，不在 apps/web 的 tsconfig 內，
// 所以這裡同等實作（兩邊的規則由各自的測試守住）。錯誤訊息只寫鍵名與原因，不寫值。

export type DataMode = 'mock' | 'supabase';

const REQUIRED_FOR_SUPABASE = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const;

const has = (env: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(env, key);
const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

export function dataModeOrThrow(env: Record<string, unknown>): DataMode {
  if (!has(env, 'VITE_DATA_MODE')) throw new Error('VITE_DATA_MODE is not set (no default)');
  const mode = env['VITE_DATA_MODE'];
  if (mode !== 'mock' && mode !== 'supabase') throw new Error('VITE_DATA_MODE must be exactly "mock" or "supabase"');
  const supabaseKeys = Object.keys(env).filter((k) => k.startsWith('VITE_SUPABASE_'));
  if (mode === 'mock') {
    if (supabaseKeys.length > 0) throw new Error(`mock mode must not define: ${supabaseKeys.join(', ')}`);
    return 'mock';
  }
  const missing = REQUIRED_FOR_SUPABASE.filter((k) => !has(env, k) || blank(env[k]));
  if (missing.length > 0) throw new Error(`supabase mode requires non-empty: ${missing.join(', ')}`);
  return 'supabase';
}

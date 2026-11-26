import type { LoadedApi } from './client.ts';

export type { ApiClient, AuthSession, LoadedApi, PreviewInfo } from './client.ts';
export { ApiProvider, useApi } from './context.tsx';

/**
 * 依 VITE_DATA_MODE 載入其中一份實作（ARCHITECTURE §9.1.1）。Vite 會把條件換成常數，沒選到的那邊不會進建置；
 * 這點沒有驗證，由 CI 掃 dist/ 保證（U-3）。
 */
export async function loadApi(search: string): Promise<LoadedApi> {
  if (import.meta.env.VITE_DATA_MODE === 'mock') {
    const mock = await import('./mock/index.ts');
    return mock.createMockApi(search);
  }
  const supabase = await import('./supabase/index.ts');
  return supabase.createSupabaseApi(import.meta.env.VITE_SUPABASE_URL ?? '', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '');
}

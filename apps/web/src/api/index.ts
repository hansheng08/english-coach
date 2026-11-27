import type { ApiRuntime } from './client';

export type { ApiClient, ApiRuntime, AuthSession, PreviewInfo } from './client';
export { ApiProvider, useApi } from './context';

/** 依 VITE_DATA_MODE 載入其中一邊；Vite 在建置時把條件換成常數，另一邊不會進 bundle（由 CI 掃 dist/ 保證）。 */
export async function loadApi(search: string): Promise<ApiRuntime> {
  if (import.meta.env.VITE_DATA_MODE === 'mock') {
    const mock = await import('./mock');
    return mock.createMockApi(search);
  }
  const supabase = await import('./supabase');
  return supabase.createApi();
}

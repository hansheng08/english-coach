export type DataModeCheck =
  | { readonly ok: true; readonly mode: 'mock' | 'supabase' }
  | { readonly ok: false; readonly reason: string };

export function assertDataModeEnv(env: unknown): DataModeCheck;

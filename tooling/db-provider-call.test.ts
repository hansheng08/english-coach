import { describe, expect, it } from 'vitest';
import migration from '../supabase/migrations/20261124160000_t006_attempts_answers_checkins_metrics.sql?raw';
import repository from '../supabase/functions/_shared/db/provider-call.ts?raw';

// 把 TS 寫入的欄位和真實資料庫的 INSERT 欄位權限綁在一起：後者由 CI db job 的 t006 pgTAP 對真實資料庫斷言（AC-T6-2）。
const grantColumns = (sql: string): string[] => {
  const m = /^grant insert \(([^)]*)\) on table public\.provider_call to authenticated;$/m.exec(sql);
  return m?.[1]?.split(',').map((c) => c.trim()) ?? [];
};
const repositoryColumns = (ts: string): string[] => {
  const m = /export const PROVIDER_CALL_COLUMNS = \[([^\]]*)\] as const;/.exec(ts);
  return [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1] ?? '');
};

describe('provider_call repository ↔ T-006 migration', () => {
  it('(AC-T7-3) PROVIDER_CALL_COLUMNS equals the authenticated INSERT grant on public.provider_call', () => {
    const granted = grantColumns(migration);
    expect(granted).toHaveLength(8);
    expect(repositoryColumns(repository)).toEqual(granted);
  });
});

import {
  ok,
  type AppError,
  type Capability,
  type ProviderErrorKind,
  type ProviderId,
  type Result,
  type Tier,
  type UserId,
} from '@english-coach/contracts';
import { runDb, type DbClient } from './client.ts';

/** 一次外部呼叫的紀錄：只有中繼資料，不含任何使用者文字、錄音或模型輸出（ARCHITECTURE §4、§13；CLAUDE.md）。 */
export type ProviderCallRecord = {
  readonly capability: Capability;
  readonly provider: ProviderId;
  readonly model: string | null;
  readonly tier: Tier;
  /** null＝成功；否則是失敗的種類。 */
  readonly errorKind: ProviderErrorKind | null;
  readonly latencyMs: number;
};

/** 寫入的欄位，必須和 T-006 migration 給 authenticated 的 `grant insert (…)` 一致（tooling/db-provider-call.test.ts）。 */
export const PROVIDER_CALL_COLUMNS = [
  'user_id',
  'capability',
  'provider',
  'model',
  'tier',
  'status',
  'error_kind',
  'latency_ms',
] as const;

export type ProviderCallRow = { readonly [K in (typeof PROVIDER_CALL_COLUMNS)[number]]: string | number | null };

/** 逐欄挑出，不展開 record：record 多帶的任何欄位都不會寫進資料庫。 */
export function providerCallRow(userId: UserId, r: ProviderCallRecord): ProviderCallRow {
  return {
    user_id: userId,
    capability: r.capability,
    provider: r.provider,
    model: r.model,
    tier: r.tier,
    status: r.errorKind === null ? 'ok' : 'error',
    error_kind: r.errorKind,
    latency_ms: Number.isFinite(r.latencyMs) ? Math.max(0, Math.round(r.latencyMs)) : 0,
  };
}

export async function insertProviderCall(
  client: DbClient,
  userId: UserId,
  r: ProviderCallRecord,
): Promise<Result<null, AppError>> {
  const res = await runDb('insert provider_call', () => client.from('provider_call').insert(providerCallRow(userId, r)));
  if (!res.ok) return res;
  return ok(null);
}

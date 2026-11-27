import { err, ok, tryCatchAsync, type AppError, type CheckinEvent, type Result, type UserId } from '@english-coach/contracts';
import type { DbClient } from './client.ts';

/** 寫入的欄位，必須和 T-006 migration 給 authenticated 的 `grant insert (…)` 一致（tooling/db-checkin.test.ts）。 */
export const SLOT_CHECKIN_COLUMNS = ['user_id', 'plan_date', 'slot', 'step', 'status'] as const;

export type SlotCheckinRow = { readonly [K in (typeof SLOT_CHECKIN_COLUMNS)[number]]: string };

/** Postgres 唯一鍵衝突：同一事件重送（ARCHITECTURE §4.8.3）。 */
const UNIQUE_VIOLATION = '23505';

/** 逐欄挑出，不展開 event；user_id 只取參數（來自 AuthContext）。 */
export function checkinRow(userId: UserId, e: CheckinEvent): SlotCheckinRow {
  return { user_id: userId, plan_date: e.planDate, slot: e.slot, step: e.step, status: e.status };
}

/** 冪等：23505 視為成功，第一次的 recorded_at 保留；其他錯誤只回操作名稱與錯誤碼，不含資料（NFR-04）。 */
export async function insertCheckin(client: DbClient, userId: UserId, e: CheckinEvent): Promise<Result<null, AppError>> {
  const op = 'insert slot_checkin';
  const res = await tryCatchAsync(
    async () => await client.from('slot_checkin').insert(checkinRow(userId, e)),
    (): AppError => ({ kind: 'db_failed', message: `${op} failed` }),
  );
  if (!res.ok) return err(res.error);
  const { error } = res.value;
  if (error === null || error.code === UNIQUE_VIOLATION) return ok(null);
  return err({ kind: 'db_failed', message: error.code === undefined ? `${op} failed` : `${op} failed (${error.code})` });
}

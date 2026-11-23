import type { Result } from '../src/result.ts';

/** 測試用：成功就回值（型別縮小），失敗就丟出讓測試失敗。只給測試程式用（@english-coach/contracts/testing）。 */
export function expectOk<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`expected ok, got err: ${JSON.stringify(r.error)}`);
}

/** 測試用：失敗就回錯誤（型別縮小），成功就丟出讓測試失敗。 */
export function expectErr<T, E>(r: Result<T, E>): E {
  if (!r.ok) return r.error;
  throw new Error('expected err, got ok'); // 不印出值：值可能是很大的 Uint8Array
}

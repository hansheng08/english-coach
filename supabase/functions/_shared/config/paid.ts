import { err, ok, type ProviderError, type Result } from '@english-coach/contracts';
import type { EnvGetter } from './env.ts';

const GEMINI_PAID_KEY_NAME = 'GEMINI_PAID_API_KEY';

/** 只有 providers/registry.ts 可以 import 本檔（ADR-008 #6）。錯誤訊息只含變數名稱，不含任何值。 */
export function loadGeminiPaidKey(get: EnvGetter): Result<string, ProviderError> {
  const value = get(GEMINI_PAID_KEY_NAME);
  if (value === undefined || value.length === 0) {
    return err({
      kind: 'not_configured',
      provider: 'gemini-paid',
      capability: 'llm',
      message: `missing env ${GEMINI_PAID_KEY_NAME}`,
    });
  }
  return ok(value);
}

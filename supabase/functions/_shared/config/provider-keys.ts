import { err, ok, type ProviderError, type Result } from '@english-coach/contracts';
import type { EnvGetter } from './env.ts';

const GEMINI_KEY_NAME = 'GEMINI_API_KEY';

/**
 * 免費 Gemini 金鑰的唯一讀取入口（ARCHITECTURE §5.4.2）。只有 providers/wiring.ts 可以 import 本檔（ADR-008 #19）。
 * 不讀 GEMINI_PAID_API_KEY（那只在 paid.ts）。錯誤訊息只含變數名稱，不含任何值。
 */
export function loadGeminiKey(get: EnvGetter): Result<string, ProviderError> {
  const value = get(GEMINI_KEY_NAME);
  if (value === undefined || value.trim().length === 0) {
    return err({
      kind: 'not_configured',
      provider: 'gemini',
      capability: 'llm',
      message: `missing env ${GEMINI_KEY_NAME}`,
    });
  }
  return ok(value);
}

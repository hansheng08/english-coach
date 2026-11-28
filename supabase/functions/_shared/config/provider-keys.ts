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

const GROQ_KEY_NAME = 'GROQ_API_KEY';

/**
 * Groq 金鑰的唯一讀取入口（ARCHITECTURE §5.5）。回傳 trim 後的值（前後的空白或換行不是金鑰的一部分）。
 * 錯誤訊息只含變數名稱，不含任何值。
 */
export function loadGroqKey(get: EnvGetter): Result<string, ProviderError> {
  const value = get(GROQ_KEY_NAME)?.trim();
  if (value === undefined || value.length === 0) {
    return err({
      kind: 'not_configured',
      provider: 'groq',
      capability: 'stt',
      message: `missing env ${GROQ_KEY_NAME}`,
    });
  }
  return ok(value);
}

export type AzureSpeechConfig ={ readonly key: string; readonly region: string };

const AZURE_KEY_NAME = 'AZURE_SPEECH_KEY';
const AZURE_REGION_NAME = 'AZURE_SPEECH_REGION';

/**
 * Azure Speech 的金鑰與 region（ARCHITECTURE §5.5）。region 會組進網址主機名稱，所以 trim、轉小寫後
 * 必須是 `^[a-z0-9]+$`。錯誤訊息只含變數名稱，不含任何值。
 */
export function loadAzureSpeechConfig(get: EnvGetter): Result<AzureSpeechConfig, ProviderError> {
  const fail = (message: string): Result<never, ProviderError> =>
    err({ kind: 'not_configured', provider: 'azure-speech', capability: 'pronunciation', message });
  const key = get(AZURE_KEY_NAME);
  const region = get(AZURE_REGION_NAME);
  const missing = [
    ...(key === undefined || key.trim().length === 0 ? [AZURE_KEY_NAME] : []),
    ...(region === undefined || region.trim().length === 0 ? [AZURE_REGION_NAME] : []),
  ];
  if (key === undefined || region === undefined || missing.length > 0) {
    return fail(`missing env ${missing.join(', ')}`);
  }
  const normalized = region.trim().toLowerCase();
  if (!/^[a-z0-9]+$/.test(normalized)) return fail(`invalid env ${AZURE_REGION_NAME}`);
  return ok({ key, region: normalized });
}

import type { ProviderError } from '@english-coach/contracts';
import { z } from 'zod';

export const GROQ_MODEL = 'whisper-large-v3-turbo';

/** 非 2xx 回應的資訊（ARCHITECTURE §5.7.4）。 */
export type GroqHttpFailure = { readonly status: number; readonly headers: Headers; readonly bodyText: string };

export type GroqPlainKind = 'unavailable' | 'timeout' | 'invalid_response';

export function redact(text: string, key: string): string {
  return key.length === 0 ? text : text.split(key).join('[redacted]');
}

export function plainError(key: string, kind: GroqPlainKind, message: string): ProviderError {
  return { kind, provider: 'groq', capability: 'stt', message: redact(message, key) };
}

/** §5.5 第 6 點：十進位秒數無條件進位；HTTP 日期、空的、格式不符或沒有 → null。 */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Math.ceil(Number.parseFloat(text));
}

/** §5.7.4 表下的規則：片語不分大小寫、縮寫要大寫，都要有字邊界；只看 `error.message`。 */
export function isGroqDailyQuotaMessage(message: string): boolean {
  return /\bper day\b/i.test(message) || /\baudio seconds\b/i.test(message) || /\b(?:RPD|ASD|ASH)\b/.test(message);
}

// 錯誤內容是 { error: { message, type } }；寬鬆解析，失敗就只依狀態判斷。
const ErrorBodySchema = z.object({
  error: z.object({ message: z.string().optional(), type: z.string().optional() }),
});

function parseErrorBody(bodyText: string): { message: string | undefined; type: string | undefined } {
  try {
    const parsed = ErrorBodySchema.safeParse(JSON.parse(bodyText));
    if (parsed.success) return { message: parsed.data.error.message, type: parsed.data.error.type };
  } catch {
    // 不是 JSON：只依狀態判斷
  }
  return { message: undefined, type: undefined };
}

// 順序固定：壓空白 → 遮蔽金鑰 → 截斷（先截斷會留下被切開的金鑰前段）。
const oneLine = (text: string, key: string): string => redact(text.replace(/\s+/g, ' ').trim(), key).slice(0, 200);

/**
 * §5.7.4 的對應表，由上往下取第一列符合的（純函式）。`apiKey` 只用來遮蔽訊息，預設不遮蔽。
 */
export function classifyGroqError(f: GroqHttpFailure, apiKey: string = ''): ProviderError {
  const body = parseErrorBody(f.bodyText);
  const detail = oneLine(body.message ?? (body.type === undefined ? f.bodyText : ''), apiKey);
  const typePart = body.type === undefined ? '' : ` (${oneLine(body.type, apiKey)})`;
  const message = `HTTP ${String(f.status)}${typePart}${detail.length === 0 ? '' : `: ${detail}`}`;
  const base = { provider: 'groq', capability: 'stt', message } as const;
  const { status } = f;
  if (status === 408 || status === 504) return { ...base, kind: 'timeout' };
  if (status === 429) {
    const retryAfterSec = parseRetryAfter(f.headers.get('retry-after'));
    const dailyRequests = f.headers.get('x-ratelimit-remaining-requests')?.trim() === '0';
    if (dailyRequests || (body.message !== undefined && isGroqDailyQuotaMessage(body.message))) {
      return { ...base, kind: 'quota_exhausted', retryAfterSec };
    }
    return { ...base, kind: 'rate_limited', retryAfterSec };
  }
  if (status === 401 || status === 403) return { ...base, kind: 'auth' };
  if (status === 404) return { ...base, kind: 'not_configured', message: `model not found: ${GROQ_MODEL} (${message})` };
  if (status === 422) return { ...base, kind: 'invalid_response' };
  return { ...base, kind: 'unavailable' };
}

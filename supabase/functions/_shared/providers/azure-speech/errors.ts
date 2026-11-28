import type { ProviderError } from '@english-coach/contracts';

export type AzureCapability = 'pronunciation' | 'tts';

/** 非 2xx 回應的資訊（ARCHITECTURE §5.6.4）。 */
export type AzureHttpFailure = { readonly status: number; readonly headers: Headers; readonly bodyText: string };

export type AzurePlainKind = 'unavailable' | 'timeout' | 'auth' | 'invalid_response' | 'not_configured';

export function redact(text: string, key: string): string {
  return key.length === 0 ? text : text.split(key).join('[redacted]');
}

export function plainError(
  capability: AzureCapability,
  key: string,
  kind: AzurePlainKind,
  message: string,
): ProviderError {
  return { kind, provider: 'azure-speech', capability, message: redact(message, key) };
}

/** §5.5 第 6 點：十進位秒數無條件進位；HTTP 日期、空的、格式不符或沒有 → null。 */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Math.ceil(Number.parseFloat(text));
}

// 順序固定：壓空白 → 遮蔽金鑰 → 截斷（先截斷會留下被切開的金鑰前段）。
const oneLine = (text: string, key: string): string => redact(text.replace(/\s+/g, ' ').trim(), key).slice(0, 200);

/**
 * §5.6.4 的對應表，由上往下取第一列符合的（純函式）。`apiKey` 只用來遮蔽訊息，預設不遮蔽。
 */
export function classifyAzureError(
  f: AzureHttpFailure,
  capability: AzureCapability,
  apiKey: string = '',
): ProviderError {
  const detail = oneLine(f.bodyText, apiKey);
  const message = detail.length === 0 ? `HTTP ${String(f.status)}` : `HTTP ${String(f.status)}: ${detail}`;
  const base = { provider: 'azure-speech', capability, message } as const;
  if (f.status === 408 || f.status === 504) return { ...base, kind: 'timeout' };
  if (f.status === 403 && /quota/i.test(f.bodyText)) return { ...base, kind: 'quota_exhausted', retryAfterSec: null };
  if (f.status === 429) {
    return { ...base, kind: 'rate_limited', retryAfterSec: parseRetryAfter(f.headers.get('retry-after')) };
  }
  if (f.status === 401 || f.status === 403) return { ...base, kind: 'auth' };
  return { ...base, kind: 'unavailable' };
}

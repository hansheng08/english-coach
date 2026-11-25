// 「依文件做」的樣本：ARCHITECTURE §5.4 標「未驗證」的情況沒有 A-003 實測樣本，這裡照官方文件的結構與 A-003 樣本的形狀手寫。
// 用到它們的測試名稱要含「未驗證」。真實格式不同時另開修正單（T-015 限制）。

const SIGNATURE = 'c2lnbmF0dXJlLW5vdC1yZWFs'; // 假的 thoughtSignature（不透明字串）

type Part = { readonly text?: string; readonly thought?: boolean };

/** 照 02-gen-* 的形狀（含多出的 thoughtSignature、serviceTier、modelVersion）。 */
export function generateBody(opts: {
  readonly parts?: readonly Part[];
  readonly finishReason?: string;
  readonly usage?: Record<string, number>;
}): string {
  const parts = (opts.parts ?? []).map((p) => ({ ...p, thoughtSignature: SIGNATURE }));
  const candidate: Record<string, unknown> = { content: { parts, role: 'model' }, index: 0 };
  if (opts.finishReason !== undefined) candidate['finishReason'] = opts.finishReason;
  return JSON.stringify({
    candidates: [candidate],
    usageMetadata: opts.usage ?? { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15, serviceTier: 'standard' },
    modelVersion: 'gemini-3.5-flash-lite',
    responseId: 'doc-sample',
  });
}

export const textBody = (text: string, finishReason = 'STOP'): string => generateBody({ parts: [{ text }], finishReason });

/** promptFeedback.blockReason：提示被擋下時沒有 candidates。 */
export const blockedBody = (blockReason: string): string => JSON.stringify({ promptFeedback: { blockReason } });

/** 錯誤內容 { error: { code, message, status, details? } }。 */
export function errorBody(
  code: number,
  status: string,
  message: string,
  details?: readonly Record<string, unknown>[],
): string {
  return JSON.stringify({ error: { code, message, status, ...(details === undefined ? {} : { details }) } });
}

const T = 'type.googleapis.com/google.rpc.';
export const quotaFailure = (...quotaIds: readonly string[]): Record<string, unknown> => ({
  '@type': `${T}QuotaFailure`,
  violations: quotaIds.map((quotaId) => ({ quotaMetric: 'generativelanguage.googleapis.com/generate_content', quotaId })),
});
export const retryInfo = (retryDelay: string): Record<string, unknown> => ({ '@type': `${T}RetryInfo`, retryDelay });
export const errorInfo = (reason: string): Record<string, unknown> => ({
  '@type': `${T}ErrorInfo`,
  reason,
  domain: 'googleapis.com',
});

/** 串流的一段（CRLF 空行結尾）。 */
export const sseEvent = (payload: unknown): string => `data: ${JSON.stringify(payload)}\r\n\r\n`;

/** 串流中間段：只有文字與累計的 usageMetadata。 */
export const deltaEvent = (text: string, candidatesTokenCount = 1): string =>
  sseEvent({
    candidates: [{ content: { parts: [{ text }], role: 'model' }, index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount, totalTokenCount: 10 + candidatesTokenCount },
  });

/** 串流最後一段：文字是空字串，只有 finishReason。 */
export const finalEvent = (finishReason: string, candidatesTokenCount = 1): string =>
  sseEvent({
    candidates: [{ content: { parts: [{ text: '', thoughtSignature: SIGNATURE }], role: 'model' }, finishReason, index: 0 }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount, totalTokenCount: 10 + candidatesTokenCount },
  });

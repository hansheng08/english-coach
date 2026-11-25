import { tryCatch, type LlmModelId, type ProviderError } from '@english-coach/contracts';
import { z } from 'zod';

/** 組錯誤訊息時需要的資訊：供應商 id（錯誤上的 provider）與金鑰（訊息一律先遮蔽，ARCHITECTURE §5.4.2）。 */
export type ErrorContext = { readonly id: 'gemini' | 'gemini-paid'; readonly apiKey: string };

type PlainKind = 'unavailable' | 'timeout' | 'auth' | 'region_blocked' | 'invalid_response' | 'not_configured';

export function redact(text: string, apiKey: string): string {
  return apiKey.length === 0 ? text : text.split(apiKey).join('[redacted]');
}

export function plainError(ctx: ErrorContext, kind: PlainKind, message: string): ProviderError {
  return { kind, provider: ctx.id, capability: 'llm', message: redact(message, ctx.apiKey) };
}

function limitError(
  ctx: ErrorContext,
  kind: 'quota_exhausted' | 'rate_limited',
  message: string,
  retryAfterSec: number | null,
): ProviderError {
  return { kind, provider: ctx.id, capability: 'llm', message: redact(message, ctx.apiKey), retryAfterSec };
}

// 錯誤內容（ARCHITECTURE §5.4.4）：寬鬆解析，details 可省略、不認得的 @type 忽略。
const ErrorBodySchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type GeminiErrorBody = z.infer<typeof ErrorBodySchema>['error'];

/** 錯誤內容不是 JSON 或沒有 `error` 物件時回 null（只依 HTTP 狀態判斷）。 */
export function parseErrorBody(body: string): GeminiErrorBody | null {
  const json = tryCatch(
    (): unknown => JSON.parse(body),
    () => null,
  );
  if (!json.ok) return null;
  const parsed = ErrorBodySchema.safeParse(json.value);
  return parsed.success ? parsed.data.error : null;
}

const TypedDetailSchema = z.object({ '@type': z.string() });
const ErrorInfoSchema = z.object({ reason: z.string().optional() });
const QuotaFailureSchema = z.object({ violations: z.array(z.object({ quotaId: z.string().optional() })).optional() });
const RetryInfoSchema = z.object({ retryDelay: z.string().optional() });

function detailsOf<T>(details: unknown, typeSuffix: string, schema: z.ZodType<T>): T[] {
  const list = z.array(z.unknown()).safeParse(details);
  if (!list.success) return [];
  return list.data.flatMap((item) => {
    const typed = TypedDetailSchema.safeParse(item);
    if (!typed.success || !typed.data['@type'].endsWith(typeSuffix)) return [];
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function retryAfterOf(details: unknown): number | null {
  for (const info of detailsOf(details, 'RetryInfo', RetryInfoSchema)) {
    const delay = info.retryDelay;
    if (delay !== undefined && /^\d+(\.\d+)?s$/.test(delay)) return Math.ceil(Number.parseFloat(delay));
  }
  return null;
}

function isDailyQuota(e: GeminiErrorBody | null): boolean {
  if (e === null) return false;
  const ids = detailsOf(e.details, 'QuotaFailure', QuotaFailureSchema)
    .flatMap((q) => q.violations ?? [])
    .flatMap((v) => (v.quotaId === undefined ? [] : [v.quotaId]));
  return ids.some((id) => id.includes('PerDay') || id.includes('Daily')) || (e.message ?? '').includes('limit: 0');
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * ARCHITECTURE §5.4.4 的對應表，由上往下取第一列符合的（純函式）。
 * 訊息是 `HTTP <狀態> <Google status>: <Google message 前 200 字>`，金鑰一律換成 [redacted]。
 */
export function classifyGeminiError(input: {
  readonly status: number;
  readonly body: string;
  readonly id: 'gemini' | 'gemini-paid';
  readonly model: LlmModelId;
  readonly apiKey: string;
}): ProviderError {
  const ctx: ErrorContext = { id: input.id, apiKey: input.apiKey };
  const { status } = input;
  const e = parseErrorBody(input.body);
  const googleStatus = e?.status;
  const googleMessage = e?.message ?? '';
  const label = `HTTP ${String(status)}${googleStatus === undefined ? '' : ` ${googleStatus}`}`;
  const text = googleMessage.length === 0 ? label : `${label}: ${oneLine(googleMessage)}`;

  if (status === 408 || status === 504) return plainError(ctx, 'timeout', text);
  if (status === 429) {
    if (isDailyQuota(e)) return limitError(ctx, 'quota_exhausted', text, null);
    return limitError(ctx, 'rate_limited', text, retryAfterOf(e?.details));
  }
  if (status === 402) return limitError(ctx, 'quota_exhausted', text, null);
  const failedPrecondition = status === 400 && googleStatus === 'FAILED_PRECONDITION';
  if (
    failedPrecondition &&
    (googleMessage.includes('location is not supported') || googleMessage.includes('not available in your country'))
  ) {
    return plainError(ctx, 'region_blocked', text);
  }
  const keyInvalid =
    status === 400 &&
    (googleMessage.includes('API key not valid') ||
      detailsOf(e?.details, 'ErrorInfo', ErrorInfoSchema).some((i) => i.reason === 'API_KEY_INVALID'));
  if (status === 401 || status === 403 || keyInvalid || failedPrecondition) return plainError(ctx, 'auth', text);
  if (status === 404) return plainError(ctx, 'not_configured', `model ${input.model} not found (${text})`);
  return plainError(ctx, 'unavailable', text);
}

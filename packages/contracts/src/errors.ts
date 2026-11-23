import { z } from 'zod';
import { CapabilitySchema, type ProviderError } from './providers.ts';
import { ProviderIdSchema, type NewsCategory } from './ids.ts';
import type { ValidationError } from './validation.ts';

export type Entity = 'card' | 'answer' | 'question' | 'plan' | 'resume' | 'article' | 'audio';

/** 全系統唯一的錯誤型別（以 kind 區分）。message 只給開發者看（英文、不含使用者文字或逐字稿，CLAUDE.md §5 第 9 點）；畫面文字由前端依 kind 產生。 */
export type AppError =
  | ProviderError
  | ValidationError
  | { kind: 'unauthenticated'; message: string }
  | { kind: 'not_found'; entity: Entity; message: string }
  | { kind: 'conflict'; entity: Entity; message: string }
  | { kind: 'storage_failed'; op: 'upload' | 'download' | 'delete' | 'sign'; message: string }
  | { kind: 'db_failed'; message: string }
  | { kind: 'news_unavailable'; category: NewsCategory; message: string } // 正常只在 daily-prep 內部流通；httpStatusOf 仍回 503（見對照表）
  | { kind: 'plan_not_ready'; message: string }
  | { kind: 'internal'; message: string }; // handler 最外層兜底

export const APP_ERROR_KINDS = [
  'quota_exhausted',
  'rate_limited',
  'unavailable',
  'timeout',
  'auth',
  'region_blocked',
  'invalid_response',
  'not_configured',
  'paid_not_allowed',
  'validation',
  'unauthenticated',
  'not_found',
  'conflict',
  'storage_failed',
  'db_failed',
  'news_unavailable',
  'plan_not_ready',
  'internal',
] as const;
export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];

export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504;

/** §6 第 2 點的錯誤回應（跨網路，有 zod）。 */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    kind: z.enum(APP_ERROR_KINDS),
    message: z.string(),
    retryable: z.boolean(),
    provider: ProviderIdSchema.optional(),
    capability: CapabilitySchema.optional(),
    retryAfterSec: z.number().int().nonnegative().optional(),
    reason: z.enum(['no_consent', 'monthly_cap_reached']).optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/** 依 §5.0.4 錯誤碼對照表。 */
export function httpStatusOf(e: AppError): HttpErrorStatus {
  switch (e.kind) {
    case 'quota_exhausted':
    case 'rate_limited':
      return 429;
    case 'unavailable':
    case 'invalid_response':
    case 'auth':
    case 'region_blocked':
    case 'storage_failed':
      return 502;
    case 'timeout':
      return 504;
    case 'not_configured':
    case 'news_unavailable':
    case 'plan_not_ready':
      return 503;
    case 'paid_not_allowed':
      return 403;
    case 'validation':
      return 400;
    case 'unauthenticated':
      return 401;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'db_failed':
    case 'internal':
      return 500;
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}

/** 依 §5.0.4 錯誤碼對照表：只表示畫面可以出現重送按鈕，重送也只打同一個供應商（AC-25）。 */
export function isRetryable(e: AppError): boolean {
  switch (e.kind) {
    case 'quota_exhausted':
    case 'rate_limited':
    case 'unavailable':
    case 'timeout':
    case 'invalid_response':
    case 'storage_failed':
    case 'db_failed':
    case 'news_unavailable':
    case 'plan_not_ready':
    case 'internal':
      return true;
    case 'auth':
    case 'region_blocked':
    case 'not_configured':
    case 'paid_not_allowed':
    case 'validation':
    case 'unauthenticated':
    case 'not_found':
    case 'conflict':
      return false;
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}

/** 只有 HTTP handler 呼叫。 */
export function toApiErrorBody(e: AppError): ApiErrorBody {
  const base = { kind: e.kind, message: e.message, retryable: isRetryable(e) };
  switch (e.kind) {
    case 'quota_exhausted':
    case 'rate_limited':
      return {
        error: {
          ...base,
          provider: e.provider,
          capability: e.capability,
          ...(e.retryAfterSec === null ? {} : { retryAfterSec: e.retryAfterSec }),
        },
      };
    case 'paid_not_allowed':
      return { error: { ...base, provider: e.provider, capability: e.capability, reason: e.reason } };
    case 'unavailable':
    case 'timeout':
    case 'auth':
    case 'region_blocked':
    case 'invalid_response':
    case 'not_configured':
      return { error: { ...base, provider: e.provider, capability: e.capability } };
    case 'validation':
      return { error: { ...base, issues: e.issues } };
    case 'unauthenticated':
    case 'not_found':
    case 'conflict':
    case 'storage_failed':
    case 'db_failed':
    case 'news_unavailable':
    case 'plan_not_ready':
    case 'internal':
      return { error: base };
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}

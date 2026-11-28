import { describe, expect, it } from 'vitest';
import { APP_ERROR_KINDS, ApiErrorBodySchema, httpStatusOf, isRetryable, toApiErrorBody } from './errors.ts';
import type { AppError, AppErrorKind, HttpErrorStatus } from './errors.ts';

// ARCHITECTURE §5.0.4 錯誤碼對照表
const TABLE: Record<AppErrorKind, { http: HttpErrorStatus; retryable: boolean }> = {
  quota_exhausted: { http: 429, retryable: true },
  rate_limited: { http: 429, retryable: true },
  unavailable: { http: 502, retryable: true },
  timeout: { http: 504, retryable: true },
  invalid_response: { http: 502, retryable: true },
  auth: { http: 502, retryable: false },
  region_blocked: { http: 502, retryable: false },
  not_configured: { http: 503, retryable: false },
  paid_not_allowed: { http: 403, retryable: false },
  validation: { http: 400, retryable: false },
  unauthenticated: { http: 401, retryable: false },
  not_found: { http: 404, retryable: false },
  conflict: { http: 409, retryable: false },
  storage_failed: { http: 502, retryable: true },
  db_failed: { http: 500, retryable: true },
  news_unavailable: { http: 503, retryable: true },
  plan_not_ready: { http: 503, retryable: true },
  internal: { http: 500, retryable: true },
};

const P = { provider: 'gemini', capability: 'llm', message: 'm' } as const;
const SAMPLES: Record<AppErrorKind, AppError> = {
  quota_exhausted: { ...P, kind: 'quota_exhausted', retryAfterSec: 120 },
  rate_limited: { ...P, kind: 'rate_limited', retryAfterSec: null },
  unavailable: { ...P, kind: 'unavailable' },
  timeout: { ...P, kind: 'timeout' },
  invalid_response: { ...P, kind: 'invalid_response' },
  auth: { ...P, kind: 'auth' },
  region_blocked: { ...P, kind: 'region_blocked' },
  not_configured: { ...P, kind: 'not_configured' },
  paid_not_allowed: { ...P, kind: 'paid_not_allowed', reason: 'no_consent' },
  validation: { kind: 'validation', issues: [{ path: 'a.b', message: 'bad' }], message: 'm' },
  unauthenticated: { kind: 'unauthenticated', message: 'm' },
  not_found: { kind: 'not_found', entity: 'card', message: 'm' },
  conflict: { kind: 'conflict', entity: 'answer', message: 'm' },
  storage_failed: { kind: 'storage_failed', op: 'upload', message: 'm' },
  db_failed: { kind: 'db_failed', message: 'm' },
  news_unavailable: { kind: 'news_unavailable', category: 'ai', message: 'm' },
  plan_not_ready: { kind: 'plan_not_ready', message: 'm' },
  internal: { kind: 'internal', message: 'm' },
};

describe('error kinds', () => {
  it('APP_ERROR_KINDS lists the 18 kinds exactly once', () => {
    expect(APP_ERROR_KINDS).toHaveLength(18);
    expect(new Set(APP_ERROR_KINDS).size).toBe(18);
    expect([...APP_ERROR_KINDS].sort()).toEqual(Object.keys(TABLE).sort());
  });
});

describe('httpStatusOf (§5.0.4 table)', () => {
  for (const kind of APP_ERROR_KINDS) {
    it(`${kind} -> ${String(TABLE[kind].http)}`, () => {
      expect(httpStatusOf(SAMPLES[kind])).toBe(TABLE[kind].http);
    });
  }

  it('news_unavailable -> 503 and plan_not_ready -> 503 (v1.2.1)', () => {
    expect(httpStatusOf(SAMPLES.news_unavailable)).toBe(503);
    expect(httpStatusOf(SAMPLES.plan_not_ready)).toBe(503);
  });
});

describe('isRetryable (§5.0.4 table)', () => {
  for (const kind of APP_ERROR_KINDS) {
    it(`${kind} -> ${String(TABLE[kind].retryable)}`, () => {
      expect(isRetryable(SAMPLES[kind])).toBe(TABLE[kind].retryable);
    });
  }

  it('news_unavailable and plan_not_ready are retryable, auth is not', () => {
    expect(isRetryable(SAMPLES.news_unavailable)).toBe(true);
    expect(isRetryable(SAMPLES.plan_not_ready)).toBe(true);
    expect(isRetryable(SAMPLES.auth)).toBe(false);
  });
});

describe('toApiErrorBody', () => {
  for (const kind of APP_ERROR_KINDS) {
    it(`${kind}: output passes ApiErrorBodySchema and retryable matches isRetryable`, () => {
      const sample = SAMPLES[kind];
      const body = toApiErrorBody(sample);
      const parsed = ApiErrorBodySchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body.error.kind).toBe(kind);
      expect(body.error.message).toBe(sample.message);
      expect(body.error.retryable).toBe(isRetryable(sample));
    });
  }

  it('retryAfterSec: null does not appear in the output', () => {
    const body = toApiErrorBody(SAMPLES.rate_limited);
    expect('retryAfterSec' in body.error).toBe(false);
  });

  it('retryAfterSec: number is kept', () => {
    expect(toApiErrorBody(SAMPLES.quota_exhausted).error.retryAfterSec).toBe(120);
  });

  it('provider errors carry provider and capability; paid_not_allowed carries reason; validation carries issues', () => {
    expect(toApiErrorBody(SAMPLES.timeout).error).toMatchObject({ provider: 'gemini', capability: 'llm' });
    expect(toApiErrorBody(SAMPLES.paid_not_allowed).error.reason).toBe('no_consent');
    expect(toApiErrorBody(SAMPLES.validation).error.issues).toEqual([{ path: 'a.b', message: 'bad' }]);
  });
});

describe('storage_failed op list (T-046)', () => {
  it('(AC-T46-16) (TC-34) op "list" is accepted and maps to 502 like the other ops', () => {
    const e: AppError = { kind: 'storage_failed', op: 'list', message: 'list failed' };
    expect(httpStatusOf(e)).toBe(502);
    const body = toApiErrorBody(e);
    expect(ApiErrorBodySchema.safeParse(body).success).toBe(true);
    expect(body.error).toEqual({ kind: 'storage_failed', message: 'list failed', retryable: true });
  });
});

describe('ApiErrorBodySchema', () => {
  it('rejects an unknown kind', () => {
    const r = ApiErrorBodySchema.safeParse({ error: { kind: 'nope', message: 'm', retryable: false } });
    expect(r.success).toBe(false);
  });

  it('rejects a body without retryable', () => {
    const r = ApiErrorBodySchema.safeParse({ error: { kind: 'internal', message: 'm' } });
    expect(r.success).toBe(false);
  });
});

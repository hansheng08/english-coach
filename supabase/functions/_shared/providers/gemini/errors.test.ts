import type { LlmModelId, ProviderError } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { classifyGeminiError } from './errors.ts';
import {
  ERR_503_GEN,
  ERR_BAD_FIELD,
  ERR_FAKE_KEY,
  ERR_MALFORMED_JSON,
  ERR_MODEL_NOT_FOUND,
  ERR_NO_KEY,
} from './test/a003-samples.ts';
import { errorBody, errorInfo, quotaFailure, retryInfo } from './test/doc-samples.ts';

const MODEL: LlmModelId = 'gemini-3.5-flash-lite';
const KEY = 'k-secret-1';
const classify = (status: number, body: string): ProviderError =>
  classifyGeminiError({ status, body, id: 'gemini', model: MODEL, apiKey: KEY });

describe('classifyGeminiError：已實測的列（A-003 樣本）', () => {
  it('(AC-T15-6) (TC-11) 05-err-fake-key：400＋API_KEY_INVALID → auth', () => {
    expect(classify(400, ERR_FAKE_KEY)).toMatchObject({ kind: 'auth', provider: 'gemini', capability: 'llm' });
  });

  it('(AC-T15-6) (TC-11) 05b-err-no-key：403 → auth', () => {
    expect(classify(403, ERR_NO_KEY).kind).toBe('auth');
  });

  it('(AC-T15-6) (TC-11) 06-err-model-not-found：404 → not_configured，訊息有模型名稱', () => {
    const e = classify(404, ERR_MODEL_NOT_FOUND);
    expect(e.kind).toBe('not_configured');
    expect(e.message).toContain(MODEL);
  });

  it('(AC-T15-6) (TC-11) 07-err-malformed-json：其他 400 → unavailable（不會被當成 auth）', () => {
    expect(classify(400, ERR_MALFORMED_JSON).kind).toBe('unavailable');
  });

  it('(AC-T15-6) (TC-11) 07b-err-bad-field：其他 400 → unavailable，訊息寫 HTTP 狀態與 Google status', () => {
    const e = classify(400, ERR_BAD_FIELD);
    expect(e.kind).toBe('unavailable');
    expect(e.message).toContain('HTTP 400');
    expect(e.message).toContain('INVALID_ARGUMENT');
  });

  it('(AC-T15-6) (TC-11) 02-gen-gemini-3.8-flash：503 → unavailable', () => {
    expect(classify(503, ERR_503_GEN).kind).toBe('unavailable');
  });
});

describe('classifyGeminiError：429（未驗證，依文件做的樣本）', () => {
  const quota = (details: readonly Record<string, unknown>[], message = 'Quota exceeded') =>
    classify(429, errorBody(429, 'RESOURCE_EXHAUSTED', message, details));

  it('(AC-T15-6) (TC-12) 未驗證：quotaId 含 PerDay → quota_exhausted，retryAfterSec 是 null', () => {
    const e = quota([quotaFailure('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), retryInfo('34s')]);
    expect(e).toMatchObject({ kind: 'quota_exhausted', retryAfterSec: null });
  });

  it('(AC-T15-6) (TC-12) 未驗證：quotaId 含 Daily → quota_exhausted', () => {
    expect(quota([quotaFailure('GenerateContentDailyLimit')])).toMatchObject({ kind: 'quota_exhausted', retryAfterSec: null });
  });

  it('(AC-T15-6) (TC-12) 未驗證：message 含 limit: 0 → quota_exhausted', () => {
    const e = classify(429, errorBody(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for metric, limit: 0'));
    expect(e).toMatchObject({ kind: 'quota_exhausted', retryAfterSec: null });
  });

  const perMinute = quotaFailure('GenerateRequestsPerMinutePerProjectPerModel-FreeTier');
  const cases: readonly [string, readonly Record<string, unknown>[], number | null][] = [
    ['34.5s（無條件進位）', [perMinute, retryInfo('34.5s')], 35],
    ['34s', [perMinute, retryInfo('34s')], 34],
    ['abc（格式不符）', [perMinute, retryInfo('abc')], null],
    ['沒有 RetryInfo', [perMinute], null],
  ];
  for (const [name, details, expected] of cases) {
    it(`(AC-T15-6) (TC-12) 未驗證：其他 429 → rate_limited，retryDelay ${name} → ${String(expected)}`, () => {
      expect(quota(details)).toMatchObject({ kind: 'rate_limited', retryAfterSec: expected });
    });
  }

  it('(AC-T15-6) (TC-12) 未驗證：429 沒有 details → rate_limited，retryAfterSec 是 null', () => {
    const e = classify(429, errorBody(429, 'RESOURCE_EXHAUSTED', 'Too many requests'));
    expect(e).toMatchObject({ kind: 'rate_limited', retryAfterSec: null });
  });
});

describe('classifyGeminiError：其他列（未驗證，依文件做的樣本）', () => {
  const FAILED_PRECONDITION = (message: string) => errorBody(400, 'FAILED_PRECONDITION', message);
  const cases: readonly [string, number, string, ProviderError['kind']][] = [
    ['402', 402, errorBody(402, 'FAILED_PRECONDITION', 'Prepayment depleted'), 'quota_exhausted'],
    [
      '400 FAILED_PRECONDITION＋location is not supported',
      400,
      FAILED_PRECONDITION('User location is not supported for the API use.'),
      'region_blocked',
    ],
    [
      '400 FAILED_PRECONDITION＋not available in your country',
      400,
      FAILED_PRECONDITION('This model is not available in your country.'),
      'region_blocked',
    ],
    ['400 FAILED_PRECONDITION（帳單）', 400, FAILED_PRECONDITION('Billing must be enabled for this project.'), 'auth'],
    ['400＋ErrorInfo API_KEY_INVALID（訊息沒有關鍵字）', 400, errorBody(400, 'INVALID_ARGUMENT', 'bad', [errorInfo('API_KEY_INVALID')]), 'auth'],
    ['401', 401, errorBody(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'), 'auth'],
    ['408', 408, errorBody(408, 'DEADLINE_EXCEEDED', 'Request timeout'), 'timeout'],
    ['504', 504, errorBody(504, 'DEADLINE_EXCEEDED', 'Deadline expired'), 'timeout'],
    ['500', 500, errorBody(500, 'INTERNAL', 'Internal error'), 'unavailable'],
    ['502', 502, errorBody(502, 'UNAVAILABLE', 'Bad gateway'), 'unavailable'],
    ['其他 5xx（599）', 599, errorBody(599, 'UNKNOWN', 'x'), 'unavailable'],
    ['其他 4xx（418）', 418, errorBody(418, 'UNKNOWN', 'teapot'), 'unavailable'],
    ['3xx（302）', 302, '', 'unavailable'],
    ['錯誤內容不是 JSON 的 503', 503, '<html>Service Unavailable</html>', 'unavailable'],
    ['錯誤內容不是 JSON 的 408（只依 HTTP 狀態）', 408, 'upstream timeout', 'timeout'],
  ];
  for (const [name, status, body, kind] of cases) {
    it(`(AC-T15-6) (TC-13) 未驗證：${name} → ${kind}`, () => {
      const e = classify(status, body);
      expect(e.kind).toBe(kind);
      expect(e.message).toContain(String(status));
    });
  }

  it('(AC-T15-6) (TC-13) 未驗證：402 的 retryAfterSec 是 null', () => {
    expect(classify(402, errorBody(402, 'FAILED_PRECONDITION', 'x'))).toMatchObject({ retryAfterSec: null });
  });

  it('(AC-T15-6) (TC-13) 未驗證：details 格式不認得時忽略，仍依狀態判斷', () => {
    const e = classify(429, errorBody(429, 'RESOURCE_EXHAUSTED', 'x', [{ '@type': 'type.example/Unknown', foo: 1 }]));
    expect(e).toMatchObject({ kind: 'rate_limited', retryAfterSec: null });
    const weird = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: 'not-an-array' } });
    expect(classify(429, weird).kind).toBe('rate_limited');
  });
});

describe('classifyGeminiError：金鑰保護', () => {
  it('(AC-T15-10) (TC-23) 錯誤內容回顯金鑰 → message 換成 [redacted]', () => {
    const e = classify(400, errorBody(400, 'INVALID_ARGUMENT', `bad request for key ${KEY}`));
    expect(e.message).toContain('[redacted]');
    expect(e.message).not.toContain(KEY);
  });

  it('(AC-T15-10) (TC-23) 付費 id 會帶在 provider 上', () => {
    const e = classifyGeminiError({ status: 503, body: '', id: 'gemini-paid', model: MODEL, apiKey: KEY });
    expect(e.provider).toBe('gemini-paid');
  });
});

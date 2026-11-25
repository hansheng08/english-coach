import type { LlmModelId, LlmProvider, LlmRequest } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGeminiProvider } from './index.ts';
import {
  ERR_503_GEN,
  ERR_MODEL_NOT_FOUND,
  GEN_31_FLASH_LITE,
  GEN_35_FLASH_LITE,
  GEN_MAXTOKENS_35_FLASH_LITE,
} from './test/a003-samples.ts';
import { blockedBody, errorBody, generateBody, quotaFailure, textBody } from './test/doc-samples.ts';
import {
  fakeFetch,
  hangIgnoringSignal,
  hangUntilAborted,
  installNoNetwork,
  json,
  networkError,
  type Reply,
} from './test/fake-fetch.ts';

installNoNetwork();

const KEY = 'k-secret-1';
const WordSchema = z.object({ word: z.string(), meaning_zh: z.string() });
type Word = z.infer<typeof WordSchema>;
const MODEL: LlmModelId = 'gemini-3.5-flash-lite';

const setup = (...replies: readonly Reply[]) => {
  const f = fakeFetch(...replies);
  const provider: LlmProvider = createGeminiProvider({ id: 'gemini', apiKey: KEY, fetch: f.fetch });
  return { provider, calls: f.calls };
};
const request = (over: Partial<LlmRequest<Word>> = {}): LlmRequest<Word> => ({
  model: MODEL,
  system: 'You are a JSON generator.',
  prompt: 'Define the word.',
  schema: WordSchema,
  maxOutputTokens: 256,
  timeoutMs: 2000,
  ...over,
});

describe('generate：請求（ARCHITECTURE §5.4.3）', () => {
  it('(AC-T15-3) (TC-4) POST 到 generateContent，金鑰只在標頭，內容只有指定欄位', async () => {
    const { provider, calls } = setup(json(200, GEN_35_FLASH_LITE));
    expectOk(await provider.generate(request({ model: 'gemini-3.5-flash-lite' })));
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(call?.url).not.toContain(KEY);
    expect(call?.method).toBe('POST');
    expect(call?.headers['x-goog-api-key']).toBe(KEY);
    expect(call?.body).toEqual({
      systemInstruction: { parts: [{ text: 'You are a JSON generator.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Define the word.' }] }],
      generationConfig: { maxOutputTokens: 256, responseMimeType: 'application/json' },
    });
    expect(JSON.stringify(call?.body)).not.toMatch(/thinkingConfig|temperature|topP|topK|responseJsonSchema/);
  });
});

describe('generate：成功（A-003 樣本）', () => {
  it('(AC-T15-4) (TC-6) 02-gen-gemini-3.5-flash-lite → 驗證後的值（thoughtSignature 等多出欄位不影響）', async () => {
    const { provider } = setup(json(200, GEN_35_FLASH_LITE));
    expect(expectOk(await provider.generate(request()))).toEqual({ word: 'versatile', meaning_zh: '多才多艺的' });
  });

  it('(AC-T15-4) (TC-6) 02-gen-gemini-3.1-flash-lite → 驗證後的值，網址用該模型', async () => {
    const { provider, calls } = setup(json(200, GEN_31_FLASH_LITE));
    const result = await provider.generate(request({ model: 'gemini-3.1-flash-lite' }));
    expect(expectOk(result)).toEqual({ word: 'versatile', meaning_zh: '多才多艺的，通用的' });
    expect(calls[0]?.url).toContain('/models/gemini-3.1-flash-lite:generateContent');
  });

  it('(AC-T15-4) (TC-7) 未驗證：thought: true 的 part 與空字串 part 不串進文字', async () => {
    const body = generateBody({
      parts: [
        { text: 'this is reasoning, not JSON', thought: true },
        { text: '{"word":"a",' },
        { text: '' },
        { text: '"meaning_zh":"b"}' },
      ],
      finishReason: 'STOP',
    });
    const { provider } = setup(json(200, body));
    expect(expectOk(await provider.generate(request()))).toEqual({ word: 'a', meaning_zh: 'b' });
  });
});

describe('generate：重試（AC-25、ADR-003）', () => {
  it('(AC-T15-5) (TC-8) STOP 但文字不是 JSON → 同模型重試 1 次後成功', async () => {
    const { provider, calls } = setup(json(200, textBody('Sure! here you go')), json(200, GEN_35_FLASH_LITE));
    expect(expectOk(await provider.generate(request()))).toEqual({ word: 'versatile', meaning_zh: '多才多艺的' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe(calls[0]?.url);
  });

  it('(AC-T15-5) (TC-8) STOP 但 JSON 不符 schema → 同模型重試 1 次後成功', async () => {
    const { provider, calls } = setup(json(200, textBody('{"word":1}')), json(200, GEN_35_FLASH_LITE));
    expectOk(await provider.generate(request()));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe(calls[0]?.url);
  });

  it('(AC-T15-5) (TC-9) 兩次都是 STOP 但不符 schema → invalid_response，fetch 2 次', async () => {
    const bad = json(200, textBody('{"word":"x"}'));
    const { provider, calls } = setup(bad, bad);
    expect(expectErr(await provider.generate(request())).kind).toBe('invalid_response');
    expect(calls).toHaveLength(2);
  });

  const noRetry: readonly [string, Reply, string][] = [
    ['02-gen-gemini-3.8-flash（503）', json(503, ERR_503_GEN), 'unavailable'],
    ['06-err-model-not-found（404）', json(404, ERR_MODEL_NOT_FOUND), 'not_configured'],
    ['08-maxtokens-gemini-3.5-flash-lite（MAX_TOKENS）', json(200, GEN_MAXTOKENS_35_FLASH_LITE), 'invalid_response'],
    [
      '未驗證：429',
      json(429, errorBody(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', [quotaFailure('PerMinute')])),
      'rate_limited',
    ],
  ];
  for (const [name, reply, kind] of noRetry) {
    it(`(AC-T15-5) (TC-10) ${name} → ${kind}，fetch 只 1 次`, async () => {
      const { provider, calls } = setup(reply);
      expect(expectErr(await provider.generate(request())).kind).toBe(kind);
      expect(calls).toHaveLength(1);
    });
  }
});

describe('generate：2xx 但格式不對（AC-T15-6）', () => {
  it('(AC-T15-6) (TC-14) 200 內容不是 JSON → invalid_response，不重試', async () => {
    const { provider, calls } = setup(json(200, '<html>oops</html>'));
    expect(expectErr(await provider.generate(request())).kind).toBe('invalid_response');
    expect(calls).toHaveLength(1);
  });

  it('(AC-T15-6) (TC-14) 200 沒有 candidates → invalid_response', async () => {
    const { provider } = setup(json(200, JSON.stringify({ usageMetadata: { promptTokenCount: 1 } })));
    expect(expectErr(await provider.generate(request())).kind).toBe('invalid_response');
  });

  it('(AC-T15-6) (TC-14) 200 結構不符（candidates 不是陣列）→ invalid_response', async () => {
    const { provider } = setup(json(200, JSON.stringify({ candidates: 'x' })));
    expect(expectErr(await provider.generate(request())).kind).toBe('invalid_response');
  });
});

describe('generate：finishReason（ARCHITECTURE §5.4.5）', () => {
  const cases: readonly [string, string, string][] = [
    ['CONTINUATION', 'CONTINUATION', 'invalid_response'],
    ['SAFETY（未驗證）', 'SAFETY', 'invalid_response'],
    ['LANGUAGE（未驗證）', 'LANGUAGE', 'invalid_response'],
    ['ESCALATION（未驗證）', 'ESCALATION', 'invalid_response'],
    ['RECITATION（未驗證）', 'RECITATION', 'invalid_response'],
    ['PUP_LIMITED_DISABLED（未驗證）', 'PUP_LIMITED_DISABLED', 'auth'],
    ['OTHER（未驗證）', 'OTHER', 'invalid_response'],
    ['未知的新值（未驗證）', 'SOME_NEW_REASON', 'invalid_response'],
    ['MAX_TOKENS', 'MAX_TOKENS', 'invalid_response'],
  ];
  for (const [name, finishReason, kind] of cases) {
    it(`(AC-T15-7) (TC-15) ${name} → ${kind}，不重試`, async () => {
      const { provider, calls } = setup(json(200, textBody('{"word":"a","meaning_zh":"b"}', finishReason)));
      const e = expectErr(await provider.generate(request()));
      expect(e.kind).toBe(kind);
      expect(e.message).toContain(finishReason);
      expect(calls).toHaveLength(1);
    });
  }

  it('(AC-T15-7) (TC-15) 08-maxtokens-gemini-3.5-flash-lite → invalid_response，不重試', async () => {
    const { provider, calls } = setup(json(200, GEN_MAXTOKENS_35_FLASH_LITE));
    expect(expectErr(await provider.generate(request())).kind).toBe('invalid_response');
    expect(calls).toHaveLength(1);
  });

  it('(AC-T15-7) (TC-15) 未驗證：promptFeedback.blockReason → invalid_response，訊息含 blocked:', async () => {
    const { provider, calls } = setup(json(200, blockedBody('PROHIBITED_CONTENT')));
    const e = expectErr(await provider.generate(request()));
    expect(e.kind).toBe('invalid_response');
    expect(e.message).toContain('blocked: PROHIBITED_CONTENT');
    expect(calls).toHaveLength(1);
  });
});

describe('generate：逾時與網路錯誤（AC-T15-9）', () => {
  it('(AC-T15-9) (TC-20) 永遠不回應的 fetch → timeout，且 signal 已被中止', async () => {
    const { provider, calls } = setup(hangUntilAborted);
    const e = expectErr(await provider.generate(request({ timeoutMs: 30 })));
    expect(e.kind).toBe('timeout');
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('(AC-T15-9) (TC-20) fetch 不理會 signal 也會在 timeoutMs 結束 → timeout', async () => {
    const { provider, calls } = setup(hangIgnoringSignal);
    expect(expectErr(await provider.generate(request({ timeoutMs: 30 }))).kind).toBe('timeout');
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('(AC-T15-9) (TC-20) 標頭回了但內容永遠讀不完 → timeout', async () => {
    const stuck: Reply = () =>
      new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 });
    const { provider } = setup(stuck);
    expect(expectErr(await provider.generate(request({ timeoutMs: 30 }))).kind).toBe('timeout');
  });

  it('(AC-T15-9) (TC-21) fetch 丟出 TypeError → unavailable，只 1 次', async () => {
    const { provider, calls } = setup(networkError('fetch failed'));
    expect(expectErr(await provider.generate(request())).kind).toBe('unavailable');
    expect(calls).toHaveLength(1);
  });
});

describe('generate：金鑰保護（NFR-05）', () => {
  it('(AC-T15-10) (TC-23) 錯誤內容 message 含金鑰的 400 → [redacted]', async () => {
    const { provider } = setup(json(400, errorBody(400, 'INVALID_ARGUMENT', `bad value ${KEY}`)));
    const e = expectErr(await provider.generate(request()));
    expect(e.message).toContain('[redacted]');
    expect(e.message).not.toContain(KEY);
  });

  it('(AC-T15-10) (TC-23) fetch 例外訊息含金鑰 → [redacted]', async () => {
    const { provider } = setup(networkError(`connect failed for ${KEY}`));
    const e = expectErr(await provider.generate(request()));
    expect(e.kind).toBe('unavailable');
    expect(e.message).toContain('[redacted]');
    expect(e.message).not.toContain(KEY);
  });

  it('(AC-T15-10) (TC-23) 模型輸出驗證失敗的訊息不含金鑰', async () => {
    const bad = json(200, textBody(`{"word":"${KEY}"}`));
    const { provider } = setup(bad, bad);
    expect(expectErr(await provider.generate(request())).message).not.toContain(KEY);
  });
});

// QA 對抗測試（T-015）：測試範圍與預期結果只依 ARCHITECTURE §5.4 與 docs/tasks/T-015.md 的 AC。
import type { LlmModelId, LlmProvider, LlmRequest, LlmStreamRequest, ProviderError, Result, StreamChunk } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyGeminiError } from './errors.ts';
import { createGeminiProvider } from './index.ts';
import { GEN_35_FLASH_LITE } from './test/a003-samples.ts';
import { fakeFetch, hangIgnoringSignal, installNoNetwork, json, sse, sseChunks, type Reply } from './test/fake-fetch.ts';

installNoNetwork();

const KEY = 'k-qa-secret-qa-secret-qa-secret';
const MODEL: LlmModelId = 'gemini-3.5-flash-lite';
const WordSchema = z.object({ word: z.string(), meaning_zh: z.string() });
type Word = z.infer<typeof WordSchema>;

const setup = (...replies: readonly Reply[]) => {
  const f = fakeFetch(...replies);
  const provider: LlmProvider = createGeminiProvider({ id: 'gemini', apiKey: KEY, fetch: f.fetch });
  return { provider, calls: f.calls };
};
const genReq = (over: Partial<LlmRequest<Word>> = {}): LlmRequest<Word> => ({
  model: MODEL,
  system: 's',
  prompt: 'p',
  schema: WordSchema,
  maxOutputTokens: 64,
  timeoutMs: 2000,
  ...over,
});
const streamReq = (over: Partial<LlmStreamRequest> = {}): LlmStreamRequest => ({
  model: MODEL,
  system: 's',
  prompt: 'p',
  maxOutputTokens: 64,
  timeoutMs: 2000,
  ...over,
});
const collect = async (it: AsyncIterable<Result<StreamChunk, ProviderError>>): Promise<Result<StreamChunk, ProviderError>[]> => {
  const out: Result<StreamChunk, ProviderError>[] = [];
  for await (const c of it) out.push(c);
  return out;
};
const event = (obj: unknown): string => `data: ${JSON.stringify(obj)}\r\n\r\n`;
const part = (text: string, finishReason?: string, usage?: Record<string, number>): unknown => ({
  candidates: [{ content: { parts: [{ text }], role: 'model' }, ...(finishReason === undefined ? {} : { finishReason }) }],
  ...(usage === undefined ? {} : { usageMetadata: usage }),
});
const stopText = (text: string): string =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
const errBody = (code: number, status: string, message: string, details?: unknown[]): string =>
  JSON.stringify({ error: { code, status, message, ...(details === undefined ? {} : { details }) } });

/** 金鑰的任一段長度 ≥ 8 的前綴都不可以出現在訊息裡。 */
const expectNoKeyFragment = (message: string): void => {
  for (let n = 8; n <= KEY.length; n += 1) expect(message).not.toContain(KEY.slice(0, n));
};

describe('QA：金鑰遮蔽的邊界（AC-T15-10）', () => {
  it('(QA-1) (AC-T15-10) 錯誤訊息很長、金鑰剛好落在截斷處 → 不留下金鑰的前段', () => {
    for (let pad = 150; pad <= 215; pad += 1) {
      const message = `${'x'.repeat(pad)} ${KEY} tail`;
      const e = classifyGeminiError({ status: 400, body: errBody(400, 'INVALID_ARGUMENT', message), id: 'gemini', model: MODEL, apiKey: KEY });
      expectNoKeyFragment(e.message);
    }
  });

  it('(QA-2) (AC-T15-10) 404 串流的錯誤內容回顯金鑰 → [redacted]', async () => {
    const { provider } = setup(sse(404, errBody(404, 'NOT_FOUND', `models/x is not found for key ${KEY}`)));
    const chunks = await collect(provider.stream(streamReq()));
    expect(chunks).toHaveLength(1);
    const e = expectErr(chunks[0] as Result<StreamChunk, ProviderError>);
    expect(e.kind).toBe('not_configured');
    expect(e.message).not.toContain(KEY);
  });
});

describe('QA：錯誤對應的比對順序（AC-T15-6）', () => {
  it('(QA-3) (AC-T15-6) 429 同時帶 API_KEY_INVALID 的 ErrorInfo → 仍是 rate_limited（429 列在 auth 列之前）', () => {
    const body = errBody(429, 'RESOURCE_EXHAUSTED', 'Too many', [
      { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.2s' },
    ]);
    const e = classifyGeminiError({ status: 429, body, id: 'gemini', model: MODEL, apiKey: KEY });
    expect(e.kind).toBe('rate_limited');
    expect(e).toMatchObject({ retryAfterSec: 1 });
  });

  it('(QA-4) (AC-T15-6) 429 每分鐘額度（quotaId 不含 PerDay／Daily）→ rate_limited', () => {
    const body = errBody(429, 'RESOURCE_EXHAUSTED', 'quota', [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
    ]);
    expect(classifyGeminiError({ status: 429, body, id: 'gemini', model: MODEL, apiKey: KEY }).kind).toBe('rate_limited');
  });

  it('(QA-5) (AC-T15-6) 400 FAILED_PRECONDITION＋not available in your country → region_blocked（不是 auth）', () => {
    const body = errBody(400, 'FAILED_PRECONDITION', 'User location is not available in your country.');
    expect(classifyGeminiError({ status: 400, body, id: 'gemini', model: MODEL, apiKey: KEY }).kind).toBe('region_blocked');
  });

  it('(QA-6) (AC-T15-6) region 訊息但 status 不是 FAILED_PRECONDITION → 不是 region_blocked', () => {
    const body = errBody(400, 'INVALID_ARGUMENT', 'User location is not supported for the API use.');
    expect(classifyGeminiError({ status: 400, body, id: 'gemini', model: MODEL, apiKey: KEY }).kind).toBe('unavailable');
  });

  it('(QA-7) (AC-T15-6) 2xx 以外的 1xx／3xx 狀態與錯誤內容為空 → unavailable', () => {
    expect(classifyGeminiError({ status: 304, body: '', id: 'gemini', model: MODEL, apiKey: KEY }).kind).toBe('unavailable');
    expect(classifyGeminiError({ status: 599, body: '<html>', id: 'gemini', model: MODEL, apiKey: KEY }).kind).toBe('unavailable');
  });
});

describe('QA：generate 重試與逾時（AC-T15-5、AC-T15-9）', () => {
  it('(QA-8) (AC-T15-5) STOP 但文字是空的 → 重試 1 次，仍空 → invalid_response，fetch 2 次', async () => {
    const { provider, calls } = setup(json(200, stopText('')), json(200, stopText('')));
    expect(expectErr(await provider.generate(genReq())).kind).toBe('invalid_response');
    expect(calls).toHaveLength(2);
  });

  it('(QA-9) (AC-T15-5) 第 1 次 STOP 但不合格、第 2 次 503 → unavailable，不再呼叫第 3 次', async () => {
    const { provider, calls } = setup(json(200, stopText('nope')), json(503, errBody(503, 'UNAVAILABLE', 'overloaded')));
    expect(expectErr(await provider.generate(genReq())).kind).toBe('unavailable');
    expect(calls).toHaveLength(2);
  });

  it('(QA-10) (AC-T15-9) timeoutMs 是整段時間：第 1 次不合格、第 2 次不回應 → timeout，兩次的 signal 都已中止', async () => {
    const { provider, calls } = setup(json(200, stopText('nope')), hangIgnoringSignal);
    const started = Date.now();
    expect(expectErr(await provider.generate(genReq({ timeoutMs: 80 }))).kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1500);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.signal?.aborted).toBe(true);
  });

  it('(QA-11) (AC-T15-4) 成功時多個 part 依序串起再 JSON.parse', async () => {
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"word":"a",' }, { text: '' }, { text: 'x', thought: true }, { text: '"meaning_zh":"一"}' }] }, finishReason: 'STOP' }],
    });
    const { provider } = setup(json(200, body));
    expect(expectOk(await provider.generate(genReq()))).toEqual({ word: 'a', meaning_zh: '一' });
  });

  it('(QA-12) (AC-T15-4) A-003 成功樣本在 gemini-paid 也一樣可用，網址不含金鑰', async () => {
    const f = fakeFetch(json(200, GEN_35_FLASH_LITE));
    const provider = createGeminiProvider({ id: 'gemini-paid', apiKey: KEY, fetch: f.fetch });
    const schema = z.unknown();
    expectOk(await provider.generate({ ...genReq(), schema }));
    expect(f.calls[0]?.url).not.toContain(KEY);
    expect(f.calls[0]?.headers['x-goog-api-key']).toBe(KEY);
  });
});

describe('QA：串流邊界（AC-T15-8）', () => {
  it('(QA-13) (AC-T15-8) 中文字的 UTF-8 位元組被切在兩段之間 → delta 文字完整', async () => {
    const whole = event(part('你好世界')) + event(part('', 'STOP', { promptTokenCount: 1, candidatesTokenCount: 2 }));
    const bytes = new TextEncoder().encode(whole);
    const byteCut = new TextEncoder().encode(whole.slice(0, whole.indexOf('你'))).length + 1; // 切在「你」的第 2 個位元組
    const reply: Reply = () => {
      let i = 0;
      const pieces = [bytes.slice(0, byteCut), bytes.slice(byteCut)];
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            const p = pieces[i];
            i += 1;
            if (p === undefined) c.close();
            else c.enqueue(p);
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    };
    const { provider } = setup(reply);
    const chunks = (await collect(provider.stream(streamReq()))).map((c) => expectOk(c));
    expect(chunks).toEqual([
      { type: 'delta', text: '你好世界' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2 } },
    ]);
  });

  it('(QA-14) (AC-T15-8) done 之後連線還送東西 → 不再產生任何東西', async () => {
    const { provider } = setup(sseChunks([event(part('a')), event(part('', 'STOP')) + event(part('late')) + event(part('', 'STOP'))]));
    const chunks = await collect(provider.stream(streamReq()));
    expect(chunks.map((c) => expectOk(c).type)).toEqual(['delta', 'done']);
  });

  it('(QA-15) (AC-T15-8) usage 取最後一段：outputTokens = candidates + thoughts；缺 candidatesTokenCount → null', async () => {
    const a = setup(sseChunks([event(part('a', undefined, { promptTokenCount: 5, candidatesTokenCount: 1 })), event(part('', 'STOP', { promptTokenCount: 5, candidatesTokenCount: 3, thoughtsTokenCount: 4 }))]));
    const last = (await collect(a.provider.stream(streamReq()))).at(-1);
    expect(expectOk(last as Result<StreamChunk, ProviderError>)).toEqual({ type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 7 } });
    const b = setup(sseChunks([event(part('', 'STOP', { promptTokenCount: 5 }))]));
    const lastB = (await collect(b.provider.stream(streamReq()))).at(-1);
    expect(expectOk(lastB as Result<StreamChunk, ProviderError>)).toEqual({ type: 'done', finishReason: 'stop', usage: null });
  });

  it('(QA-16) (AC-T15-8) 幾段 delta 後出現 blockReason → 已送的 delta 保留，再 done safety、usage null', async () => {
    const { provider } = setup(sseChunks([event(part('a')), event({ promptFeedback: { blockReason: 'SAFETY' } })]));
    const chunks = (await collect(provider.stream(streamReq()))).map((c) => expectOk(c));
    expect(chunks).toEqual([{ type: 'delta', text: 'a' }, { type: 'done', finishReason: 'safety', usage: null }]);
  });

  it('(QA-17) (AC-T15-8) 只用 \\n\\n 分隔（不是 CRLF）也能切段', async () => {
    const body = `data: ${JSON.stringify(part('a'))}\n\ndata: ${JSON.stringify(part('', 'STOP'))}\n\n`;
    const { provider } = setup(sseChunks([body]));
    const chunks = (await collect(provider.stream(streamReq()))).map((c) => expectOk(c).type);
    expect(chunks).toEqual(['delta', 'done']);
  });

  it('(QA-18) (AC-T15-8) 2xx 但內容是空的 → err invalid_response（沒有 finishReason）', async () => {
    const { provider } = setup(sseChunks([]));
    const chunks = await collect(provider.stream(streamReq()));
    expect(chunks).toHaveLength(1);
    expect(expectErr(chunks[0] as Result<StreamChunk, ProviderError>).kind).toBe('invalid_response');
  });
});

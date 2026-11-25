import type { LlmModelId, LlmProvider, LlmStreamRequest, ProviderError, Result, StreamChunk } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { createGeminiProvider } from './index.ts';
import {
  ERR_503_STREAM,
  ERR_MODEL_NOT_FOUND_STREAM,
  STREAM_35_FLASH_LITE,
  STREAM_MAXTOKENS_35_FLASH_LITE,
} from './test/a003-samples.ts';
import { deltaEvent, errorBody, finalEvent, sseEvent } from './test/doc-samples.ts';
import {
  fakeFetch,
  hangIgnoringSignal,
  hangUntilAborted,
  installNoNetwork,
  sse,
  sseChunks,
  sseThenHang,
  type Reply,
} from './test/fake-fetch.ts';

installNoNetwork();

const KEY = 'k-secret-1';
const MODEL: LlmModelId = 'gemini-3.5-flash-lite';

const setup = (...replies: readonly Reply[]) => {
  const f = fakeFetch(...replies);
  const provider: LlmProvider = createGeminiProvider({ id: 'gemini', apiKey: KEY, fetch: f.fetch });
  return { provider, calls: f.calls };
};
const request = (over: Partial<LlmStreamRequest> = {}): LlmStreamRequest => ({
  model: MODEL,
  system: 'You are a card writer.',
  prompt: 'Write three sentences.',
  maxOutputTokens: 256,
  timeoutMs: 2000,
  ...over,
});

type Item = Result<StreamChunk, ProviderError>;
async function collect(items: AsyncIterable<Item>): Promise<Item[]> {
  const out: Item[] = [];
  for await (const item of items) out.push(item);
  return out;
}
const messageOf = (item: Item | undefined): string => (item !== undefined && !item.ok ? item.error.message : '');
const summary = (items: readonly Item[]): string[] =>
  items.map((i) => (i.ok ? (i.value.type === 'delta' ? `delta:${i.value.text}` : `done:${i.value.finishReason}`) : `err:${i.error.kind}`));

describe('stream：請求（ARCHITECTURE §5.4.3）', () => {
  it('(AC-T15-3) (TC-5) POST 到 streamGenerateContent?alt=sse，沒有 responseMimeType，金鑰只在標頭', async () => {
    const { provider, calls } = setup(sse(200, STREAM_35_FLASH_LITE));
    await collect(provider.stream(request({ model: 'gemini-3.1-flash-lite' })));
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent?alt=sse',
    );
    expect(call?.url).not.toContain(KEY);
    expect(call?.method).toBe('POST');
    expect(call?.headers['x-goog-api-key']).toBe(KEY);
    expect(call?.body).toEqual({
      systemInstruction: { parts: [{ text: 'You are a card writer.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Write three sentences.' }] }],
      generationConfig: { maxOutputTokens: 256 },
    });
  });
});

describe('stream：成功（A-003 樣本）', () => {
  it('(AC-T15-8) (TC-16) 03-stream：delta 依序等於各段非空文字，最後只有 done，usage 取最後一段', async () => {
    const { provider } = setup(sse(200, STREAM_35_FLASH_LITE));
    const items = await collect(provider.stream(request()));
    expect(items).toEqual([
      { ok: true, value: { type: 'delta', text: '1.' } },
      { ok: true, value: { type: 'delta', text: ' She is a versatile actress who excels in both comedy and drama.\n2. This versatile' } },
      {
        ok: true,
        value: { type: 'delta', text: ' tool functions as a knife, screwdriver, and bottle opener.\n3. Denim jackets are versatile and match almost any outfit.' },
      },
      // 各段累計的 candidatesTokenCount 是 2、20、45、45；取最後一段的 45，不是相加
      { ok: true, value: { type: 'done', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 45 } } },
    ]);
  });

  it('(AC-T15-8) (TC-16) 位元組切在 CRLF 中間也得到同樣的結果', async () => {
    const pieces: string[] = [];
    for (let i = 0; i < STREAM_35_FLASH_LITE.length; i += 7) pieces.push(STREAM_35_FLASH_LITE.slice(i, i + 7));
    const whole = await collect(setup(sse(200, STREAM_35_FLASH_LITE)).provider.stream(request()));
    const split = await collect(setup(sseChunks(pieces)).provider.stream(request()));
    expect(split).toEqual(whole);
  });

  it('(AC-T15-7) (AC-T15-8) (TC-17) 09-stream-maxtokens：done，finishReason 是 max_tokens', async () => {
    const { provider } = setup(sse(200, STREAM_MAXTOKENS_35_FLASH_LITE));
    const items = await collect(provider.stream(request()));
    expect(summary(items)).toEqual(['delta:Job', 'done:max_tokens']);
  });
});

describe('stream：開始前失敗（HTTP 狀態判斷，不看 content-type）', () => {
  it('(AC-T15-8) (TC-18) 06b-err-model-not-found-stream（404）→ 只有一個 err not_configured', async () => {
    const { provider } = setup(sse(404, ERR_MODEL_NOT_FOUND_STREAM));
    const items = await collect(provider.stream(request()));
    expect(summary(items)).toEqual(['err:not_configured']);
    expect(messageOf(items[0])).toContain(MODEL);
  });

  it('(AC-T15-8) (TC-18) 11-stream-gemini-3.8-flash（503）→ 只有一個 err unavailable', async () => {
    const { provider, calls } = setup(sse(503, ERR_503_STREAM));
    expect(summary(await collect(provider.stream(request({ model: 'gemini-3.8-flash' }))))).toEqual(['err:unavailable']);
    expect(calls).toHaveLength(1);
  });
});

describe('stream：未驗證的情況（依文件做的樣本）', () => {
  const run = async (...pieces: string[]) => summary(await collect(setup(sseChunks(pieces)).provider.stream(request())));

  it('(AC-T15-8) (TC-19) 未驗證：幾段 delta 後一段 { error }（429）→ 已送的 delta 保留，再 err rate_limited，之後沒有東西', async () => {
    const midError = sseEvent(JSON.parse(errorBody(429, 'RESOURCE_EXHAUSTED', 'slow down')) as unknown);
    expect(await run(deltaEvent('Hello'), deltaEvent(' world'), midError, deltaEvent('ignored'), finalEvent('STOP'))).toEqual([
      'delta:Hello',
      'delta: world',
      'err:rate_limited',
    ]);
  });

  it('(AC-T15-8) (TC-19) 未驗證：一段不是 JSON → err invalid_response', async () => {
    expect(await run(deltaEvent('Hi'), 'data: {not json\r\n\r\n', finalEvent('STOP'))).toEqual(['delta:Hi', 'err:invalid_response']);
  });

  it('(AC-T15-8) (TC-19) 未驗證：結構不符的一段 → err invalid_response', async () => {
    expect(await run(sseEvent({ candidates: 'x' }))).toEqual(['err:invalid_response']);
  });

  it('(AC-T15-8) (TC-19) 未驗證：整段沒有 finishReason → err invalid_response', async () => {
    expect(await run(deltaEvent('Hi'), deltaEvent(' there'))).toEqual(['delta:Hi', 'delta: there', 'err:invalid_response']);
  });

  it('(AC-T15-8) (TC-19) 未驗證：promptFeedback.blockReason → done safety，usage 是 null', async () => {
    const items = await collect(setup(sseChunks([sseEvent({ promptFeedback: { blockReason: 'SAFETY' } })])).provider.stream(request()));
    expect(items).toEqual([{ ok: true, value: { type: 'done', finishReason: 'safety', usage: null } }]);
  });

  it('(AC-T15-7) (TC-19) 未驗證：SAFETY → done safety', async () => {
    expect(await run(finalEvent('SAFETY'))).toEqual(['done:safety']);
  });

  it('(AC-T15-7) (TC-19) 未驗證：PUP_LIMITED_DISABLED → err auth', async () => {
    expect(await run(finalEvent('PUP_LIMITED_DISABLED'))).toEqual(['err:auth']);
  });

  it('(AC-T15-7) (TC-19) 未驗證：OTHER 與未知的新值 → err invalid_response', async () => {
    expect(await run(finalEvent('OTHER'))).toEqual(['err:invalid_response']);
    expect(await run(finalEvent('BRAND_NEW'))).toEqual(['err:invalid_response']);
  });

  it('(AC-T15-7) (TC-19) 未驗證：CONTINUATION → done max_tokens', async () => {
    expect(await run(finalEvent('CONTINUATION'))).toEqual(['done:max_tokens']);
  });

  it('(AC-T15-8) (TC-19) 未驗證：最後一段後面沒有空行 → 仍被處理', async () => {
    const withoutBlankLine = finalEvent('STOP').replace(/\r\n\r\n$/, '');
    expect(await run(deltaEvent('Hi'), withoutBlankLine)).toEqual(['delta:Hi', 'done:stop']);
  });

  it('(AC-T15-8) (TC-19) 未驗證：不是 data: 開頭的行與沒有 data 的段落被忽略', async () => {
    expect(await run(': keep-alive\r\n\r\n', 'event: message\r\n', deltaEvent('Hi'), finalEvent('STOP'))).toEqual([
      'delta:Hi',
      'done:stop',
    ]);
  });
});

describe('stream：逾時、網路錯誤、提前停止（AC-T15-9）', () => {
  it('(AC-T15-9) (TC-20) 永遠不回應的 fetch → 一個 err timeout，signal 已被中止', async () => {
    const { provider, calls } = setup(hangUntilAborted);
    expect(summary(await collect(provider.stream(request({ timeoutMs: 30 }))))).toEqual(['err:timeout']);
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('(AC-T15-9) (TC-20) fetch 不理會 signal 也會在 timeoutMs 結束 → err timeout', async () => {
    const { provider } = setup(hangIgnoringSignal);
    expect(summary(await collect(provider.stream(request({ timeoutMs: 30 }))))).toEqual(['err:timeout']);
  });

  it('(AC-T15-9) (TC-20) 標頭與第一段回了但內容永遠不結束 → 先 delta 再 err timeout，signal 已被中止', async () => {
    const { provider, calls } = setup(sseThenHang(deltaEvent('Hi')));
    expect(summary(await collect(provider.stream(request({ timeoutMs: 50 }))))).toEqual(['delta:Hi', 'err:timeout']);
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('(AC-T15-9) (TC-21) 讀到一半丟錯 → 先送已收到的 delta，再 err unavailable', async () => {
    const { provider } = setup(sseChunks([deltaEvent('Hi'), deltaEvent(' there')], new TypeError('terminated')));
    expect(summary(await collect(provider.stream(request())))).toEqual(['delta:Hi', 'delta: there', 'err:unavailable']);
  });

  it('(AC-T15-9) (TC-21) fetch 丟出網路錯誤 → err unavailable', async () => {
    const reject: Reply = () => Promise.reject(new TypeError('fetch failed'));
    expect(summary(await collect(setup(reject).provider.stream(request())))).toEqual(['err:unavailable']);
  });

  it('(AC-T15-9) (TC-22) 讀到第一個 delta 就 break → 底層 signal 已被中止，不再產生東西', async () => {
    const { provider, calls } = setup(sse(200, STREAM_35_FLASH_LITE));
    const seen: Item[] = [];
    for await (const item of provider.stream(request())) {
      seen.push(item);
      break;
    }
    expect(summary(seen)).toEqual(['delta:1.']);
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('(AC-T15-8) 串流不重試：err 之後 fetch 仍只有 1 次', async () => {
    const { provider, calls } = setup(sse(200, deltaEvent('Hi')));
    expect(summary(await collect(provider.stream(request())))).toEqual(['delta:Hi', 'err:invalid_response']);
    expect(calls).toHaveLength(1);
  });
});

describe('stream：金鑰保護（NFR-05）', () => {
  it('(AC-T15-10) (TC-23) 串流途中 { error } 回顯金鑰 → [redacted]', async () => {
    const leaked = sseEvent(JSON.parse(errorBody(400, 'INVALID_ARGUMENT', `bad ${KEY}`)) as unknown);
    const items = await collect(setup(sseChunks([leaked])).provider.stream(request()));
    const message = messageOf(items[0]);
    expect(message).toContain('[redacted]');
    expect(message).not.toContain(KEY);
  });

  it('(AC-T15-10) (TC-23) 讀取例外訊息含金鑰 → [redacted]', async () => {
    const { provider } = setup(sseChunks([], new TypeError(`broken ${KEY}`)));
    const items = await collect(provider.stream(request()));
    const message = messageOf(items[0]);
    expect(message).toContain('[redacted]');
    expect(message).not.toContain(KEY);
  });
});

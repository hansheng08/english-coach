import { readFileSync, readdirSync } from 'node:fs';
import { TranscriptSchema, type AudioPayload, type ProviderError, type Result, type Transcript } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyGroqError, isGroqDailyQuotaMessage, parseRetryAfter } from './errors.ts';
import { createGroqProvider } from './index.ts';
import * as samples from './test/doc-samples.ts';
import {
  fakeFetch,
  hangBody,
  hangIgnoringSignal,
  hangUntilAborted,
  makeWav,
  networkError,
  opaqueRedirect,
  text,
  type FetchCall,
  type Reply,
} from './test/fake-fetch.ts';

const KEY = 'test-secret-123';
const TIMEOUT = 5000;
const webm: AudioPayload = { format: 'webm-opus', bytes: new Uint8Array([1, 2, 3, 4]) };
const wav: AudioPayload = { format: 'wav-pcm16-16k-mono', wav: makeWav() };

const make = (...replies: Reply[]) => {
  const f = fakeFetch(...replies);
  return { provider: createGroqProvider({ apiKey: KEY, fetch: f.fetch }), calls: f.calls };
};
const run = (
  p: { provider: ReturnType<typeof createGroqProvider> },
  audio: AudioPayload = webm,
  wordTimestamps = true,
  prompt?: string,
): Promise<Result<Transcript, ProviderError>> =>
  p.provider.transcribe(audio, {
    language: 'en',
    wordTimestamps,
    timeoutMs: TIMEOUT,
    ...(prompt === undefined ? {} : { prompt }),
  });
const only = (calls: FetchCall[]): FetchCall => {
  expect(calls).toHaveLength(1);
  const c = calls[0];
  if (c === undefined) throw new Error('no call');
  return c;
};
const form = (c: FetchCall): FormData => {
  if (!(c.body instanceof FormData)) throw new Error('body is not FormData');
  return c.body;
};
const ok200 = (body: string): Reply => text(200, body);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('工廠', () => {
  it('(AC-T16-2) (TC-2) 四個欄位照規格，建立時不呼叫 fetch', () => {
    const { provider, calls } = make();
    expect(provider.id).toBe('groq');
    expect(provider.tier).toBe('free');
    expect(provider.displayName).toBe('Groq Whisper');
    expect(provider.capability).toBe('stt');
    expect(calls).toHaveLength(0);
  });
});

describe('請求', () => {
  it('(AC-T16-3) (TC-3) webm：網址、標頭、欄位照 §5.7.2', async () => {
    const p = make(ok200(samples.VERBOSE_WITH_WORDS));
    expectOk(await run(p, webm, true, 'Um, so'));
    const c = only(p.calls);
    expect(c.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(c.method).toBe('POST');
    expect(c.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(c.headers.has('content-type')).toBe(false);
    expect(c.url).not.toContain(KEY);
    expect(c.redirect).toBe('manual');
    const f = form(c);
    const file = f.get('file');
    if (!(file instanceof File)) throw new Error('file is not a File');
    expect(file.type).toBe('audio/webm');
    expect(file.name).toBe('answer.webm');
    expect(f.get('model')).toBe('whisper-large-v3-turbo');
    expect(f.get('language')).toBe('en');
    expect(f.get('response_format')).toBe('verbose_json');
    expect(f.getAll('timestamp_granularities[]')).toEqual(['word']);
    expect(f.get('prompt')).toBe('Um, so');
  });

  it('(AC-T16-3) (TC-4) wav：MIME 與檔名；沒有 granularities、prompt、temperature、url', async () => {
    const p = make(ok200(samples.NO_TIMING));
    expectOk(await run(p, wav, false));
    const f = form(only(p.calls));
    const file = f.get('file');
    if (!(file instanceof File)) throw new Error('file is not a File');
    expect(file.type).toBe('audio/wav');
    expect(file.name).toBe('audio.wav');
    for (const name of ['timestamp_granularities[]', 'prompt', 'temperature', 'url']) {
      expect(f.has(name)).toBe(false);
    }
  });

  it('(AC-T16-3) (TC-22) 轉址不跟：302 與 opaqueredirect 都是 unavailable，fetch 只呼叫 1 次', async () => {
    const p = make(text(302, '', { Location: 'https://evil.example/x' }));
    const e = expectErr(await run(p));
    expect(e.kind).toBe('unavailable');
    expect(e.message).toContain('302');
    expect(p.calls.map((c) => c.url).join()).not.toContain('evil.example');
    expect(p.calls).toHaveLength(1);

    const q = make(opaqueRedirect);
    expect(expectErr(await run(q)).kind).toBe('unavailable');
    expect(q.calls).toHaveLength(1);
  });
});

describe('回應對應', () => {
  it('(AC-T16-4) (TC-5) 未驗證：成功＋逐字', async () => {
    const t = expectOk(await run(make(ok200(samples.VERBOSE_WITH_WORDS))));
    expect(TranscriptSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({
      text: 'Um, so I think we should ship it.',
      language: 'en',
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      durationMs: 3520,
      timing: 'words',
    });
    if (t.timing !== 'words') throw new Error('expected words');
    expect(t.words[0]).toEqual({ word: 'Um,', startMs: 120, endMs: 400, confidence: null });
    expect(t.words[3]).toEqual({ word: 'think', startMs: 900, endMs: 1235, confidence: null });
    expect(t.words[4]?.startMs).toBe(1300);
  });

  it('(AC-T16-4) (TC-6) 未驗證：沒有 duration 時取最大 end', async () => {
    expect(expectOk(await run(make(ok200(samples.WORDS_ONLY)))).durationMs).toBe(1250);
    expect(expectOk(await run(make(ok200(samples.SEGMENTS_ONLY)), webm, false)).durationMs).toBe(1750);
    expect(expectOk(await run(make(ok200(samples.NO_TIMING)), webm, false)).durationMs).toBe(0);
  });

  it('(AC-T16-4) (TC-7) 未驗證：進位後倒序 endMs 改成 startMs；空字跳過', async () => {
    const t = expectOk(await run(make(ok200(samples.REVERSED_AND_BLANK))));
    if (t.timing !== 'words') throw new Error('expected words');
    expect(t.words.map((w) => w.word)).toEqual(['a', 'c']);
    expect(t.words[0]?.endMs).toBe(t.words[0]?.startMs);
    expect(TranscriptSchema.safeParse(t).success).toBe(true);
  });

  it('(AC-T16-4) (TC-8) 未驗證：不要時間戳記 → timing none，沒有 words 欄位', async () => {
    const t = expectOk(await run(make(ok200(samples.VERBOSE_WITH_WORDS)), webm, false));
    expect(t.timing).toBe('none');
    expect('words' in t).toBe(false);
  });

  it('(AC-T16-5) (TC-9) 未驗證：要時間戳記但 words 沒有或是空 → invalid_response', async () => {
    for (const body of [samples.TEXT_NO_WORDS, samples.TEXT_EMPTY_WORDS]) {
      expect(expectErr(await run(make(ok200(body)))).kind).toBe('invalid_response');
    }
  });

  it('(AC-T16-5) (TC-10) 未驗證：沒講話 → ok，words 空', async () => {
    const t = expectOk(await run(make(ok200(samples.SILENCE))));
    expect(t).toMatchObject({ text: '', timing: 'words', words: [] });
  });

  it('(AC-T16-5) (TC-11) 回應壞掉 → invalid_response', async () => {
    for (const body of ['not json', samples.BAD_STRUCTURE]) {
      expect(expectErr(await run(make(ok200(body)))).kind).toBe('invalid_response');
    }
  });
});

describe('錯誤對應', () => {
  const classify = (status: number, body: string, headers: Record<string, string> = {}) =>
    classifyGroqError({ status, headers: new Headers(headers), bodyText: body });

  it('(AC-T16-6) (TC-12) 未驗證：每日額度（正例）→ quota_exhausted', async () => {
    const messages = [
      'Rate limit reached for model in organization on requests per day (RPD): Limit 2000',
      'Rate limit reached on audio seconds per hour (ASH): Limit 7200',
      'Rate limit reached (ASD): Limit 28800',
      'Rate limit reached on Audio Seconds per hour',
      'Rate limit reached for requests PER DAY',
    ];
    const p = make(text(429, samples.rateLimitBody('slow down'), { 'x-ratelimit-remaining-requests': '0' }));
    expect(expectErr(await run(p)).kind).toBe('quota_exhausted');
    for (const m of messages) {
      expect(isGroqDailyQuotaMessage(m)).toBe(true);
      expect(expectErr(await run(make(text(429, samples.rateLimitBody(m))))).kind).toBe('quota_exhausted');
    }
  });

  it('(AC-T16-6) (TC-13) 未驗證：每分鐘 → rate_limited', async () => {
    const e = expectErr(await run(make(text(429, samples.rateLimitBody('Rate limit reached for requests per minute')))));
    expect(e.kind).toBe('rate_limited');
  });

  it('(AC-T16-6) (TC-14) 其他狀態依表', () => {
    const body = JSON.stringify({ error: { message: 'bad', type: 'invalid_request_error' } });
    expect(classify(401, body).kind).toBe('auth');
    expect(classify(403, body).kind).toBe('auth');
    const nf = classify(404, body);
    expect(nf.kind).toBe('not_configured');
    expect(nf.message).toContain('whisper-large-v3-turbo');
    expect(classify(408, body).kind).toBe('timeout');
    expect(classify(422, body).kind).toBe('invalid_response');
    for (const status of [400, 413, 498, 302]) {
      const e = classify(status, body);
      expect(e.kind).toBe('unavailable');
      expect(e.message).toContain(String(status));
    }
    expect(classify(400, body).message).toContain('invalid_request_error');
    for (const status of [500, 503]) expect(classify(status, body).kind).toBe('unavailable');
    expect(classify(504, body).kind).toBe('timeout');
    expect(classify(400, 'plain text').kind).toBe('unavailable');
    expect(classify(400, 'plain text').provider).toBe('groq');
  });

  it('(AC-T16-6) (TC-21) 每日額度（反例）→ rate_limited', async () => {
    const bad = ['hash mismatch', 'server crash', 'Hash', 'HASH value', 'ashes', 'rpd exceeded', 'perday'];
    for (const m of bad) {
      expect(isGroqDailyQuotaMessage(m)).toBe(false);
      expect(expectErr(await run(make(text(429, samples.rateLimitBody(m))))).kind).toBe('rate_limited');
    }
    const typeOnly = samples.rateLimitBody('Rate limit reached for requests per minute', 'per day');
    expect(expectErr(await run(make(text(429, typeOnly)))).kind).toBe('rate_limited');
  });

  it('(AC-T16-7) (TC-15) retry-after：秒數進位，其他為 null；標頭名大小寫不拘', async () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter('7.2')).toBe(8);
    for (const v of ['Wed, 21 Oct 2026 07:28:00 GMT', '', 'abc', null]) expect(parseRetryAfter(v)).toBeNull();
    const body = samples.rateLimitBody('per minute');
    for (const name of ['retry-after', 'Retry-After', 'RETRY-AFTER']) {
      const e = expectErr(await run(make(text(429, body, { [name]: '7.2' }))));
      expect(e).toMatchObject({ kind: 'rate_limited', retryAfterSec: 8 });
    }
    const none = expectErr(await run(make(text(429, body))));
    expect(none).toMatchObject({ kind: 'rate_limited', retryAfterSec: null });
    const daily = expectErr(
      await run(make(text(429, body, { 'x-ratelimit-remaining-requests': '0', 'retry-after': '30' }))),
    );
    expect(daily).toMatchObject({ kind: 'quota_exhausted', retryAfterSec: 30 });
  });
});

describe('逾時與網路錯誤', () => {
  it('(AC-T16-8) (TC-16) 永遠不回應、不理會 signal、內容讀不完 → timeout', async () => {
    for (const reply of [hangUntilAborted, hangIgnoringSignal, hangBody]) {
      const p = make(reply);
      const pending = run(p);
      await vi.advanceTimersByTimeAsync(TIMEOUT);
      const e = expectErr(await pending);
      expect(e.kind).toBe('timeout');
      expect(only(p.calls).signal?.aborted).toBe(true);
    }
  });

  it('(AC-T16-8) (TC-17) 網路錯誤 → unavailable', async () => {
    const p = make(networkError('network down'));
    const e = expectErr(await run(p));
    expect(e.kind).toBe('unavailable');
    expect(p.calls).toHaveLength(1);
  });
});

describe('金鑰與重試', () => {
  it('(AC-T16-9) (TC-18) 金鑰遮蔽：錯誤內容與例外訊息', async () => {
    const leak = `bad key ${KEY} here`;
    const body = JSON.stringify({ error: { message: leak, type: `t-${KEY}` } });
    for (const reply of [text(500, body), text(500, leak), networkError(leak), ok200(`not json ${KEY}`)]) {
      const e = expectErr(await run(make(reply)));
      expect(e.message).not.toContain(KEY);
    }
    expect(expectErr(await run(make(text(500, body)))).message).toContain('[redacted]');
    expect(expectErr(await run(make(networkError(leak)))).message).toContain('[redacted]');
  });

  it('(AC-T16-10) (TC-19) 不重試：成功與各種錯誤 fetch 都只呼叫 1 次', async () => {
    const replies: Reply[] = [
      ok200(samples.VERBOSE_WITH_WORDS),
      ok200('not json'),
      ok200(samples.BAD_STRUCTURE),
      text(429, samples.rateLimitBody('per minute'), { 'retry-after': '3' }),
      text(429, samples.rateLimitBody('per day')),
      text(401, ''),
      text(404, ''),
      text(422, ''),
      text(500, ''),
      text(504, ''),
      text(302, ''),
      networkError('network down'),
    ];
    for (const reply of replies) {
      const p = make(reply);
      await run(p);
      expect(p.calls).toHaveLength(1);
    }
    const hung = make(hangUntilAborted);
    const pending = run(hung);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    await pending;
    expect(hung.calls).toHaveLength(1);
  });
});

describe('樣本內容', () => {
  it('(AC-T16-11) (TC-20) 未驗證：test/ 下沒有金鑰樣子的字串', () => {
    const dir = new URL('./test/', import.meta.url);
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(new URL(file, dir), 'utf8');
      expect(content).not.toContain('gsk_');
      expect(content).not.toContain('AIza');
    }
  });
});

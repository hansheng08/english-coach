import { readFileSync, readdirSync } from 'node:fs';
import { TranscriptSchema, type AudioPayload, type ProviderError, type Result, type Transcript } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGroqKey } from '../../config/provider-keys.ts';
import { classifyGroqError, isGroqDailyQuotaMessage, parseRetryAfter } from './errors.ts';
import { createGroqProvider } from './index.ts';
import {
  fakeFetch,
  makeWav,
  networkError,
  opaqueRedirect,
  text,
  type Reply,
} from './test/fake-fetch.ts';

// QA probes for T-016（Groq Whisper adapter）。假金鑰刻意是低熵、一看就是假的字串。
const KEY = 'k-qa-secret-qa-secret-qa-secret';
const TIMEOUT = 5000;
const webmBytes = new Uint8Array([9, 8, 7, 6]);
const webm: AudioPayload = { format: 'webm-opus', bytes: webmBytes };
const wav: AudioPayload = { format: 'wav-pcm16-16k-mono', wav: makeWav() };

const make = (...replies: readonly Reply[]) => {
  const f = fakeFetch(...replies);
  return { provider: createGroqProvider({ apiKey: KEY, fetch: f.fetch }), calls: f.calls };
};
type P = ReturnType<typeof make>;
const run = (
  p: P,
  audio: AudioPayload = webm,
  wordTimestamps = true,
  extra: { prompt?: string; timeoutMs?: number } = {},
): Promise<Result<Transcript, ProviderError>> =>
  p.provider.transcribe(audio, {
    language: 'en',
    wordTimestamps,
    timeoutMs: extra.timeoutMs ?? TIMEOUT,
    ...(extra.prompt === undefined ? {} : { prompt: extra.prompt }),
  });
const okBody = (body: unknown): Reply => text(200, typeof body === 'string' ? body : JSON.stringify(body));
const word = (w: string, start: number, end: number) => ({ word: w, start, end });

describe('T-016 QA loadGroqKey', () => {
  it('(QA-1) only GROQ_API_KEY is read; blanks including tabs/newlines are missing; returned value is trimmed and errors never echo it', () => {
    const read: string[] = [];
    const get =
      (value: string | undefined, extras: Record<string, string> = {}) =>
      (name: string): string | undefined => {
        read.push(name);
        if (name in extras) return extras[name];
        return value;
      };
    for (const value of [undefined, '', '   ', '\t', '\n', ' \t\n ']) {
      read.length = 0;
      const e = expectErr(loadGroqKey(get(value, { AZURE_SPEECH_KEY: 'k-1', GEMINI_API_KEY: 'k-2' })));
      expect(e).toEqual({
        kind: 'not_configured',
        provider: 'groq',
        capability: 'stt',
        message: 'missing env GROQ_API_KEY',
      });
      expect(e.message).not.toContain('k-1');
      expect(e.message).not.toContain('k-2');
      expect(read).toEqual(['GROQ_API_KEY']);
    }
    expect(expectOk(loadGroqKey(get('  k-qa-secret-qa-secret-qa-secret \n')))).toBe(KEY);
    expect(expectOk(loadGroqKey(get('\tfoo-bar\r\n')))).toBe('foo-bar');
  });
});

describe('T-016 QA request shape', () => {
  it('(QA-2) FormData fields, file bytes, no Content-Type, redirect manual, empty prompt omitted, key never in the URL', async () => {
    const p = make(okBody({ text: 'hi', words: [word('hi', 0, 0.2)] }));
    expectOk(await run(p, webm, true, { prompt: '' }));
    const call = p.calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(call?.url).not.toContain(KEY);
    expect(call?.redirect).toBe('manual');
    expect(call?.headers.get('Authorization')).toBe(`Bearer ${KEY}`);
    expect(call?.headers.has('Content-Type')).toBe(false);
    expect(call?.headers.has('content-type')).toBe(false);
    const form = call?.body;
    if (!(form instanceof FormData)) throw new Error('body is not FormData');
    const names: string[] = [];
    form.forEach((_value, name) => {
      names.push(name);
    });
    expect(names.sort()).toEqual(['file', 'language', 'model', 'response_format', 'timestamp_granularities[]']);
    expect(form.get('prompt')).toBeNull();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('file is not a File');
    expect(file.type).toBe('audio/webm');
    expect(file.name).toBe('answer.webm');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(webmBytes);

    const q = make(okBody({ text: 'hi' }));
    expectOk(await run(q, wav, false, { prompt: 'keep  this  punct: “hi”' }));
    const form2 = q.calls[0]?.body;
    if (!(form2 instanceof FormData)) throw new Error('body is not FormData');
    expect(form2.get('prompt')).toBe('keep  this  punct: “hi”');
    expect(form2.has('timestamp_granularities[]')).toBe(false);
    expect(form2.has('temperature')).toBe(false);
    expect(form2.has('url')).toBe(false);
  });
});

describe('T-016 QA transcript mapping', () => {
  it('(QA-3) duration prefers the duration field, text/words are trimmed, rounding and inverted times follow §5.5.7', async () => {
    const t = expectOk(
      await run(
        make(
          okBody({
            text: '  Hello there.  ',
            duration: 1,
            words: [word(' Hello ', 0.0004, 0.0005), word('there.', 1.4996, 1.4994), word('   ', 2, 3)],
            segments: [{ start: 0, end: 9 }],
            extra: true,
          }),
        ),
      ),
    );
    expect(t).toEqual({
      text: 'Hello there.',
      language: 'en',
      durationMs: 1000,
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      timing: 'words',
      words: [
        { word: 'Hello', startMs: 0, endMs: 1, confidence: null },
        { word: 'there.', startMs: 1500, endMs: 1500, confidence: null },
      ],
    });
    expect(TranscriptSchema.safeParse(t).success).toBe(true);
    expect(expectOk(await run(make(okBody({ text: 'x', words: [word('x', 0, 2.4)] })))).durationMs).toBe(2400);
  });

  it('(QA-4) whitespace-only text with no words is silence; leftover-empty words with leftover text is invalid_response', async () => {
    const silence = expectOk(await run(make(okBody({ text: '   \n', words: [] }))));
    expect(silence).toMatchObject({ text: '', timing: 'words', words: [] });
    expect(expectErr(await run(make(okBody({ text: 'hi', words: [word('  ', 0, 1)] })))).kind).toBe('invalid_response');
    expect(expectErr(await run(make(okBody({ text: 'hi' })))).kind).toBe('invalid_response');
    expect(expectErr(await run(make(okBody('null')))).kind).toBe('invalid_response');
    expect(expectErr(await run(make(okBody('[]')))).kind).toBe('invalid_response');
    expect(expectErr(await run(make(okBody('')))).kind).toBe('invalid_response');
  });
});

describe('T-016 QA classifyGroqError / daily quota', () => {
  it('(QA-5) table order, remaining-requests, word-boundary abbreviations, and no region_blocked', () => {
    const c = (status: number, bodyText = '', headers: Record<string, string> = {}) =>
      classifyGroqError({ status, headers: new Headers(headers), bodyText });
    expect(c(408, JSON.stringify({ error: { message: 'requests per day' } })).kind).toBe('timeout');
    expect(c(504, JSON.stringify({ error: { message: 'RPD' } })).kind).toBe('timeout');
    expect(c(429, JSON.stringify({ error: { message: 'requests per minute' } }), { 'X-RateLimit-Remaining-Requests': ' 0 ' })).toMatchObject({
      kind: 'quota_exhausted',
    });
    expect(c(429, JSON.stringify({ error: { message: 'requests per minute' } }), { 'x-ratelimit-remaining-requests': '00' }).kind).toBe(
      'rate_limited',
    );
    expect(isGroqDailyQuotaMessage('Limit (ASH): 1')).toBe(true);
    expect(isGroqDailyQuotaMessage('the ASH.')).toBe(true);
    expect(isGroqDailyQuotaMessage('CRASH')).toBe(false);
    expect(isGroqDailyQuotaMessage('RPDs')).toBe(false);
    expect(isGroqDailyQuotaMessage('per  day')).toBe(false);
    expect(isGroqDailyQuotaMessage('Audio  Seconds')).toBe(false);
    expect(c(429, JSON.stringify({ error: { type: 'RPD', message: 'per minute' } })).kind).toBe('rate_limited');
    expect(c(404, '{}').message).toContain('whisper-large-v3-turbo');
    for (const status of [300, 301, 303, 307, 308, 400, 413, 418, 498, 499, 500, 502, 503, 599]) {
      const e = c(status, JSON.stringify({ error: { message: 'x', type: 'invalid_request_error' } }));
      expect(e.kind).toBe('unavailable');
      expect(e.message).toContain(String(status));
      expect(e.provider).toBe('groq');
      expect(e.capability).toBe('stt');
    }
    for (let status = 100; status <= 599; status += 1) expect(c(status, 'blocked region').kind).not.toBe('region_blocked');
  });

  it('(QA-6) Retry-After parsing', () => {
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('1.0001')).toBe(2);
    for (const v of [null, '', ' ', '-1', '1e3', '0x10', 'Wed, 21 Oct 2015 07:28:00 GMT', 'abc', '1,5', 'Infinity', 'NaN']) {
      expect(parseRetryAfter(v)).toBeNull();
    }
  });
});

describe('T-016 QA redaction, single call, timers, redirects', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('(QA-7) the key is redacted before truncation and in every path; no partial key survives', async () => {
    const long = `${'a'.repeat(192)}${KEY}${KEY}`;
    const body = JSON.stringify({ error: { message: long, type: KEY } });
    for (const reply of [text(500, body), text(429, body), text(403, `quota ${long}`), networkError(long)]) {
      const p = make(reply);
      const e = expectErr(await run(p));
      expect(e.message).not.toContain('k-qa-secret');
      expect(e.message).not.toContain('qa-secret');
      expect(p.calls).toHaveLength(1);
    }
    expect(classifyGroqError({ status: 500, headers: new Headers(), bodyText: JSON.stringify({ error: { message: `${'b'.repeat(195)}${KEY}` } }) }, KEY).message).not.toContain(
      'k-qa-',
    );
  });

  it('(QA-8) no retry after 429/5xx, timers cleared, error-body read can time out, late abort stays timeout', async () => {
    for (const status of [429, 500, 503]) {
      const p = make(text(status, 'x'), text(200, 'y'));
      await run(p);
      expect(p.calls).toHaveLength(1);
    }
    const ok1 = make(okBody({ text: '', words: [] }));
    expectOk(await run(ok1));
    expect(vi.getTimerCount()).toBe(0);

    const hangingError: Reply = () => new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 500 });
    const p = make(hangingError);
    const pending = run(p);
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(expectErr(await pending).kind).toBe('timeout');
    expect(p.calls[0]?.signal?.aborted).toBe(true);

    const late: Reply = (signal) =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          setTimeout(() => {
            reject(new DOMException('aborted', 'AbortError'));
          }, 10);
        });
      });
    const q = make(late);
    const pending2 = run(q);
    await vi.advanceTimersByTimeAsync(TIMEOUT + 100);
    expect(expectErr(await pending2).kind).toBe('timeout');

    const early = expectErr(await run(make(networkError('reset'))));
    expect(early.kind).toBe('unavailable');
    expect(early.message).toContain('reset');
    expect(early.message).not.toContain(KEY);
  });

  it('(QA-9) a fetch that throws synchronously is unavailable and called once; 3xx is unavailable and never follows Location', async () => {
    let n = 0;
    const throwing: typeof fetch = () => {
      n += 1;
      throw new TypeError(`sync ${KEY}`);
    };
    const e = expectErr(await createGroqProvider({ apiKey: KEY, fetch: throwing }).transcribe(webm, { language: 'en', wordTimestamps: true, timeoutMs: TIMEOUT }));
    expect(e.kind).toBe('unavailable');
    expect(e.message).not.toContain(KEY);
    expect(n).toBe(1);

    for (const status of [301, 302, 303, 307]) {
      const p = make(text(status, '', { Location: `https://evil.example/steal?k=${KEY}` }));
      const err = expectErr(await run(p));
      expect(err.kind).toBe('unavailable');
      expect(err.message).toContain(String(status));
      expect(p.calls).toHaveLength(1);
      expect(p.calls[0]?.url).not.toContain('evil.example');
      expect(p.calls[0]?.redirect).toBe('manual');
    }
    const opaque = make(opaqueRedirect);
    expect(expectErr(await run(opaque)).kind).toBe('unavailable');
    expect(opaque.calls).toHaveLength(1);

    // status 0 即使 type 不是 opaqueredirect 也要回 unavailable（AC-T16-3）。
    const zeroStatus: Reply = () => {
      const res = new Response('x', { status: 200 });
      Object.defineProperty(res, 'status', { value: 0 });
      return res;
    };
    const z = make(zeroStatus);
    expect(expectErr(await run(z)).kind).toBe('unavailable');
    expect(z.calls).toHaveLength(1);
  });
});

describe('T-016 QA sample contents', () => {
  it('(QA-10) groq/test/ has no key-like strings', () => {
    const dir = new URL('./test/', import.meta.url);
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(new URL(file, dir), 'utf8');
      expect(content).not.toMatch(/[0-9a-f]{32}/);
      expect(content).not.toContain('AIza');
      expect(content).not.toContain('gsk_');
    }
  });
});

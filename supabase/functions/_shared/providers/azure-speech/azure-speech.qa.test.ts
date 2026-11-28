import { PronunciationResultSchema, type ProviderError, type Result } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAzureSpeechConfig } from '../../config/provider-keys.ts';
import { classifyAzureError, parseRetryAfter } from './errors.ts';
import { createAzureSpeechProviders } from './index.ts';
import { buildSsml, escapeSsmlText } from './ssml.ts';
import { bytes, fakeFetch, makeWav, networkError, text, type Reply } from './test/fake-fetch.ts';

// QA probes for T-017 (Azure Speech adapter). 假金鑰刻意是低熵、一看就是假的字串。
const KEY = 'fake-key-for-test';
const REGION = 'japaneast';
const wav = makeWav();

const make = (...replies: readonly Reply[]) => {
  const f = fakeFetch(...replies);
  return { ...createAzureSpeechProviders({ key: KEY, region: REGION, fetch: f.fetch }), calls: f.calls };
};
type P = ReturnType<typeof make>;
const assess = (p: P, ref = 'Good morning.') => p.pronunciation.assess(wav, ref, { timeoutMs: 5000 });
const speak = (p: P, t = 'Hi') => p.tts.synthesize(t, 'azure:en-US-AvaNeural', { timeoutMs: 5000 });
const both: ReadonlyArray<readonly ['pronunciation' | 'tts', (p: P) => Promise<Result<unknown, ProviderError>>]> = [
  ['pronunciation', (p) => assess(p)],
  ['tts', (p) => speak(p)],
];
const env =
  (vars: Record<string, string>) =>
  (name: string): string | undefined =>
    vars[name];
const success = (best: unknown): string => JSON.stringify({ RecognitionStatus: 'Success', NBest: [best] });
const word = (Word: string, Offset: number | string, Duration: number | string) => ({ Word, Offset, Duration });
const headerNames = (headers: Headers | undefined): string[] => {
  const names: string[] = [];
  headers?.forEach((_value, name) => {
    names.push(name);
  });
  return names.sort();
};
const fromBase64Utf8 = (b64: string): string => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe('T-017 QA loadAzureSpeechConfig', () => {
  it('(QA-1) missing/blank vars list only names, region is trimmed+lowercased, invalid regions never echo the value', () => {
    const missingBoth = expectErr(loadAzureSpeechConfig(env({ AZURE_SPEECH_KEY: ' \t', AZURE_SPEECH_REGION: '\n' })));
    expect(missingBoth).toEqual({
      kind: 'not_configured',
      provider: 'azure-speech',
      capability: 'pronunciation',
      message: 'missing env AZURE_SPEECH_KEY, AZURE_SPEECH_REGION',
    });
    const onlyKey = expectErr(loadAzureSpeechConfig(env({ AZURE_SPEECH_REGION: 'japaneast' })));
    expect(onlyKey.message).toBe('missing env AZURE_SPEECH_KEY');
    // 缺 key 時，就算 region 格式錯也只回報缺少的名稱，不帶值。
    const missingKeyBadRegion = expectErr(loadAzureSpeechConfig(env({ AZURE_SPEECH_REGION: 'zz-bad-region' })));
    expect(missingKeyBadRegion.message).not.toContain('zz-bad-region');

    expect(expectOk(loadAzureSpeechConfig(env({ AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: '\tJAPANEAST\n' })))).toEqual({
      key: KEY,
      region: 'japaneast',
    });
    expect(expectOk(loadAzureSpeechConfig(env({ AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: 'westus2' }))).region).toBe('westus2');
    for (const region of ['japan east', 'japaneast.', 'jap/an', 'a@b', 'ｊａｐａｎ', 'japaneast\u0130', 'x:1', 'evil.com#']) {
      const e = expectErr(loadAzureSpeechConfig(env({ AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: region })));
      expect(e.kind).toBe('not_configured');
      expect(e.provider).toBe('azure-speech');
      expect(e.message).toBe('invalid env AZURE_SPEECH_REGION');
      expect(e.message).not.toContain(KEY);
    }
  });
});

describe('T-017 QA pronunciation request', () => {
  it('(QA-2) Pronunciation-Assessment is UTF-8 base64 of exactly the five keys; only the four headers; key never in the URL', async () => {
    const ref = 'He said "hi" \\ — it’s 5°C 😀\nnext';
    const p = make(text(200, success({ PronScore: 50, Display: 'x', Words: [] })));
    expectOk(await assess(p, ref));
    const call = p.calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.url).not.toContain(KEY);
    expect(new URL(call?.url ?? '').host).toBe('japaneast.stt.speech.microsoft.com');
    const header = call?.headers.get('Pronunciation-Assessment') ?? '';
    expect(header).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const decoded: unknown = JSON.parse(fromBase64Utf8(header));
    expect(decoded).toStrictEqual({
      ReferenceText: ref,
      GradingSystem: 'HundredMark',
      Granularity: 'Word',
      Dimension: 'Comprehensive',
      EnableMiscue: false,
    });
    expect(headerNames(call?.headers)).toEqual(
      ['accept', 'content-type', 'ocp-apim-subscription-key', 'pronunciation-assessment'],
    );
    expect(call?.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(call?.body instanceof Uint8Array ? call.body : [])).toEqual(Array.from(wav.bytes));
    expect(call?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('T-017 QA pronunciation response', () => {
  it('(QA-3) rounding, zero durations, NBest[0] only, loose extra fields', async () => {
    const r = expectOk(
      await assess(
        make(
          text(
            200,
            JSON.stringify({
              RecognitionStatus: 'Success',
              Extra: { nested: true },
              NBest: [
                {
                  PronScore: 0,
                  Display: 'A b.',
                  Unknown: 1,
                  Words: [word('a', 5000, 0), word('b', '15000', '0'), word('c', 14999, 10001), word('', 20000, 10000), word('d', 30000, -20000)],
                },
                { PronScore: 99, Display: 'other' },
              ],
            }),
          ),
        ),
      ),
    );
    expect(r).toEqual({
      score0to100: 0,
      recognizedText: 'A b.',
      provider: 'azure-speech',
      words: [
        { word: 'a', startMs: 1, endMs: 1, confidence: null },
        { word: 'b', startMs: 2, endMs: 2, confidence: null },
        { word: 'c', startMs: 1, endMs: 3, confidence: null },
        // §5.5 第 7 點：進位後 endMs < startMs 時 endMs 改成 startMs。
        { word: 'd', startMs: 3, endMs: 3, confidence: null },
      ],
    });
    expect(PronunciationResultSchema.safeParse(r).success).toBe(true);
    expect(expectOk(await assess(make(text(200, success({ PronScore: 100, Display: '', Words: [] }))))).score0to100).toBe(100);
  });

  it('(QA-4) malformed Success payloads → invalid_response, silent statuses ignore NBest contents, status is case-sensitive', async () => {
    const bad = [
      success({ PronScore: '87', Display: 'x' }),
      success({ PronScore: 87, Words: [word('a', '1.5', '2')] }),
      success({ PronScore: 87, Words: [word('a', -10000, 1)] }),
      success({ PronScore: 87, Words: [word('a', '-1', '2')] }),
      success({ PronScore: 87, Words: [{ Word: 'a', Offset: 1 }] }),
      success(null),
      JSON.stringify({ RecognitionStatus: 'Success', NBest: 'x' }),
      JSON.stringify({ RecognitionStatus: 'success', NBest: [{ PronScore: 1 }] }),
      JSON.stringify({ RecognitionStatus: 'nomatch' }),
      JSON.stringify({ RecognitionStatus: 1 }),
      'null',
      '[]',
      '',
    ];
    for (const body of bad) {
      const e = expectErr(await assess(make(text(200, body))));
      expect(e).toMatchObject({ kind: 'invalid_response', provider: 'azure-speech', capability: 'pronunciation' });
    }
    for (const status of ['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout']) {
      for (const body of [
        JSON.stringify({ RecognitionStatus: status, Offset: 0, Duration: 0 }),
        JSON.stringify({ RecognitionStatus: status, NBest: [] }),
        JSON.stringify({ RecognitionStatus: status, NBest: [{ PronScore: 99, Display: 'ignored' }] }),
      ]) {
        expect(expectOk(await assess(make(text(200, body))))).toStrictEqual({
          score0to100: 0,
          recognizedText: '',
          words: [],
          provider: 'azure-speech',
        });
      }
    }
    const errorStatus = expectErr(await assess(make(text(200, JSON.stringify({ RecognitionStatus: 'Error', NBest: [{ PronScore: 1 }] })))));
    expect(errorStatus.kind).toBe('unavailable');
  });
});

describe('T-017 QA TTS', () => {
  it('(QA-5) SSML body escapes the text, audio bytes are returned untouched, duration uses Math.round', async () => {
    const p = make(bytes(200, 3));
    const r = expectOk(await speak(p, `<a href="x">'&'</a>\u0000\u0007\u001f\t\n\r`));
    expect(p.calls[0]?.body).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-AvaNeural">' +
        '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;\t\n\r</voice></speak>',
    );
    expect(p.calls[0]?.url).not.toContain(KEY);
    expect(headerNames(p.calls[0]?.headers)).toEqual(
      ['content-type', 'ocp-apim-subscription-key', 'user-agent', 'x-microsoft-outputformat'],
    );
    expect(r.durationMs).toBe(1); // 3 bytes → 0.5 ms → round 1
    expect(Array.from(r.audio)).toEqual([1, 1, 1]);
    expect(expectOk(await speak(make(bytes(200, 1)))).durationMs).toBe(0);
    expect(expectOk(await speak(make(bytes(200, 30_001)))).durationMs).toBe(5000);
    expect(expectOk(await speak(make(bytes(200, 6)))).durationMs).toBe(1);
    expect(buildSsml('a"b<c', '')).toContain('<voice name="a&quot;b&lt;c"></voice>');
    expect(escapeSsmlText('&lt;')).toBe('&amp;lt;');
    expect(escapeSsmlText('\u0000\u001f\u0020\u007f')).toBe(' \u007f');
    expect(escapeSsmlText('😀é')).toBe('😀é');
  });

  it('(QA-6) a non-azure voice never reaches fetch for either Gemini voice and the timer is not left behind', async () => {
    vi.useFakeTimers();
    try {
      for (const voice of ['gemini:Kore', 'gemini:Puck'] as const) {
        const p = make();
        const e = expectErr(await p.tts.synthesize('Hi', voice, { timeoutMs: 5000 }));
        expect(e).toEqual({
          kind: 'not_configured',
          provider: 'azure-speech',
          capability: 'tts',
          message: `voice not supported by azure-speech: ${voice}`,
        });
        expect(p.calls).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('T-017 QA classifyAzureError / parseRetryAfter', () => {
  const h = (init: Record<string, string> = {}) => new Headers(init);
  it('(QA-7) table order and edge statuses', () => {
    for (const capability of ['pronunciation', 'tts'] as const) {
      const c = (status: number, bodyText = '', headers = h()) => classifyAzureError({ status, headers, bodyText }, capability);
      expect(c(408, 'quota').kind).toBe('timeout');
      expect(c(504, 'QUOTA').kind).toBe('timeout');
      expect(c(403, '{"error":{"message":"Out of call volume QUOTA"}}')).toMatchObject({ kind: 'quota_exhausted', retryAfterSec: null });
      expect(c(403, 'quota', h({ 'Retry-After': '30' }))).toMatchObject({ kind: 'quota_exhausted', retryAfterSec: null });
      expect(c(429, 'quota exceeded', h({ 'retry-after': '2.1' }))).toMatchObject({ kind: 'rate_limited', retryAfterSec: 3 });
      expect(c(401, 'quota').kind).toBe('auth');
      expect(c(403, '').kind).toBe('auth');
      for (const status of [300, 301, 304, 307, 308, 400, 404, 405, 413, 415, 418, 422, 499, 500, 501, 502, 503, 505, 599]) {
        const e = c(status, 'x');
        expect(e.kind).toBe('unavailable');
        expect(e.message).toContain(String(status));
        expect(e.provider).toBe('azure-speech');
        expect(e.capability).toBe(capability);
      }
      for (let status = 100; status <= 599; status += 1) expect(c(status, 'blocked region').kind).not.toBe('region_blocked');
    }
  });

  it('(QA-8) Retry-After parsing', () => {
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('1')).toBe(1);
    expect(parseRetryAfter('1.0001')).toBe(2);
    expect(parseRetryAfter('120')).toBe(120);
    for (const v of [null, '', ' ', '-1', '1e3', '0x10', 'Wed, 21 Oct 2015 07:28:00 GMT', 'abc', '1,5', 'Infinity', 'NaN']) {
      expect(parseRetryAfter(v)).toBeNull();
    }
  });
});

describe('T-017 QA redaction, single call, timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('(QA-9) the key is redacted before truncation and in every path; no partial key survives', async () => {
    const long = `${'a'.repeat(192)}${KEY}${KEY}`;
    for (const [, run] of both) {
      for (const reply of [text(500, long), text(403, `quota ${long}`), text(429, `${KEY}\n${KEY}`), networkError(long)]) {
        const p = make(reply);
        const e = expectErr(await run(p));
        expect(e.message).not.toContain('fake-key');
        expect(e.message).not.toContain('for-test');
        expect(p.calls).toHaveLength(1);
      }
    }
    expect(classifyAzureError({ status: 500, headers: new Headers(), bodyText: `${'b'.repeat(195)}${KEY}` }, 'tts', KEY).message).not.toContain(
      'fake-',
    );
  });

  it('(QA-10) no retry after 5xx/429, timer cleared after success, abort error after timeout stays timeout, error-body read can time out', async () => {
    for (const [, run] of both) {
      for (const status of [429, 500, 503]) {
        const p = make(text(status, 'x'), text(200, 'y'));
        await run(p);
        expect(p.calls).toHaveLength(1);
      }
    }
    const ok1 = make(text(200, success({ PronScore: 10, Display: 'x' })));
    expectOk(await assess(ok1));
    expect(vi.getTimerCount()).toBe(0);
    const ok2 = make(bytes(200, 10));
    expectOk(await speak(ok2));
    expect(vi.getTimerCount()).toBe(0);

    for (const [, run] of both) {
      // 非 2xx 但錯誤內容讀不完 → timeout（§5.5 第 2 點：timeoutMs 算整段）。
      const hangingError: Reply = () =>
        new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 500 });
      const p = make(hangingError);
      const pending = run(p);
      await vi.advanceTimersByTimeAsync(5000);
      expect(expectErr(await pending).kind).toBe('timeout');
      expect(p.calls[0]?.signal?.aborted).toBe(true);

      // 自己中止後 fetch 才 reject（AbortError）→ 仍是 timeout，不是 unavailable。
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
      await vi.advanceTimersByTimeAsync(5100);
      expect(expectErr(await pending2).kind).toBe('timeout');

      // 逾時前就失敗的網路錯誤 → unavailable，不是 timeout。
      const early = expectErr(await run(make(networkError('reset'))));
      expect(early.kind).toBe('unavailable');
      expect(early.message).toContain('reset');
    }
  });

  it('(QA-11) a fetch that throws synchronously is unavailable and called once', async () => {
    for (const [, run] of both) {
      let n = 0;
      const throwing: typeof fetch = () => {
        n += 1;
        throw new TypeError(`sync ${KEY}`);
      };
      const providers = createAzureSpeechProviders({ key: KEY, region: REGION, fetch: throwing });
      const e = expectErr(await run({ ...providers, calls: [] }));
      expect(e.kind).toBe('unavailable');
      expect(e.message).not.toContain(KEY);
      expect(n).toBe(1);
    }
  });
});

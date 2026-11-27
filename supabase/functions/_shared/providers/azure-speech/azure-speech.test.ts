import { readFileSync, readdirSync } from 'node:fs';
import { PronunciationResultSchema, type ProviderError, type Result } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyAzureError, parseRetryAfter } from './errors.ts';
import { createAzureSpeechProviders } from './index.ts';
import { buildSsml, escapeSsmlText } from './ssml.ts';
import * as samples from './test/doc-samples.ts';
import {
  bytes,
  fakeFetch,
  hangBody,
  hangIgnoringSignal,
  hangUntilAborted,
  makeWav,
  networkError,
  text,
  type Reply,
} from './test/fake-fetch.ts';

const KEY = 'fake-key-for-test';
const REGION = 'japaneast';
const wav = makeWav();

const make = (...replies: readonly Reply[]) => {
  const f = fakeFetch(...replies);
  const providers = createAzureSpeechProviders({ key: KEY, region: REGION, fetch: f.fetch });
  return { ...providers, calls: f.calls };
};
const assess = (p: ReturnType<typeof make>) => p.pronunciation.assess(wav, 'Good morning.', { timeoutMs: 5000 });
const speak = (p: ReturnType<typeof make>) => p.tts.synthesize('Hi', 'azure:en-US-AvaNeural', { timeoutMs: 5000 });

describe('工廠', () => {
  it('(AC-T17-2) (TC-3) 兩個 provider 的欄位，建立時不呼叫 fetch', () => {
    const p = make();
    for (const [o, capability] of [
      [p.pronunciation, 'pronunciation'],
      [p.tts, 'tts'],
    ] as const) {
      expect(o.id).toBe('azure-speech');
      expect(o.tier).toBe('free');
      expect(o.displayName).toBe('Azure Speech');
      expect(o.capability).toBe(capability);
    }
    expect(p.calls).toHaveLength(0);
  });
});

describe('發音評估請求與回應', () => {
  it('(AC-T17-3) (TC-4) 網址、標頭、Pronunciation-Assessment 與 body', async () => {
    const p = make(text(200, samples.status('NoMatch')));
    const ref = 'It’s a day — really';
    expectOk(await p.pronunciation.assess(wav, ref, { timeoutMs: 5000 }));
    const call = p.calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe(
      `https://${REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`,
    );
    expect(call?.url).not.toContain(KEY);
    expect(call?.headers.get('Ocp-Apim-Subscription-Key')).toBe(KEY);
    expect(call?.headers.get('Content-Type')).toBe('audio/wav; codecs=audio/pcm; samplerate=16000');
    expect(call?.headers.get('Accept')).toBe('application/json');
    expect(call?.headers.has('Transfer-Encoding')).toBe(false);
    const encoded = call?.headers.get('Pronunciation-Assessment') ?? '';
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
    expect(JSON.parse(decoded)).toEqual({
      ReferenceText: ref,
      GradingSystem: 'HundredMark',
      Granularity: 'Word',
      Dimension: 'Comprehensive',
      EnableMiscue: false,
    });
    expect(decoded).not.toContain('EnableProsodyAssessment');
    expect(call?.body).toEqual(wav.bytes);
  });

  it('(AC-T17-4) (TC-5) 未驗證：Success 樣本對應', async () => {
    const r = expectOk(await assess(make(text(200, samples.successNumeric))));
    expect(r).toEqual({
      score0to100: 87.5,
      recognizedText: 'Good morning.',
      words: [
        { word: 'good', startMs: 50, endMs: 400, confidence: null },
        { word: 'morning', startMs: 410, endMs: 1010, confidence: null },
      ],
      provider: 'azure-speech',
    });
    expect(PronunciationResultSchema.safeParse(r).success).toBe(true);
  });

  it('(AC-T17-4) (TC-6) 未驗證：字串時間、分數夾邊界、空字跳過', async () => {
    const high = expectOk(await assess(make(text(200, samples.successEdge(104)))));
    expect(high.score0to100).toBe(100);
    expect(high.words).toEqual([
      { word: 'hello', startMs: 1230, endMs: 1730, confidence: null },
      { word: 'there', startMs: 1750, endMs: 1750, confidence: null },
    ]);
    expect(expectOk(await assess(make(text(200, samples.successEdge(-3))))).score0to100).toBe(0);
  });

  it('(AC-T17-4) (TC-7) NBest 空、沒有、沒有 PronScore → invalid_response', async () => {
    for (const body of [samples.emptyNBest, samples.noNBest, samples.noPronScore]) {
      expect(expectErr(await assess(make(text(200, body)))).kind).toBe('invalid_response');
    }
  });

  it('(AC-T17-5) (TC-8) 未驗證：沒聽到聲音 → ok 且分數 0', async () => {
    for (const s of ['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout']) {
      expect(expectOk(await assess(make(text(200, samples.status(s)))))).toEqual({
        score0to100: 0,
        recognizedText: '',
        words: [],
        provider: 'azure-speech',
      });
    }
  });

  it('(AC-T17-5) (TC-9) Error → unavailable；未知狀態與非 JSON → invalid_response', async () => {
    expect(expectErr(await assess(make(text(200, samples.status('Error'))))).kind).toBe('unavailable');
    expect(expectErr(await assess(make(text(200, samples.status('Unknown'))))).kind).toBe('invalid_response');
    expect(expectErr(await assess(make(text(200, 'not json')))).kind).toBe('invalid_response');
  });
});

describe('TTS', () => {
  it('(AC-T17-6) (TC-10) 請求網址、標頭、SSML body', async () => {
    const p = make(bytes(200, 100));
    expectOk(await p.tts.synthesize('Hi & bye', 'azure:en-US-AvaNeural', { timeoutMs: 5000 }));
    const call = p.calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`);
    expect(call?.headers.get('Ocp-Apim-Subscription-Key')).toBe(KEY);
    expect(call?.headers.get('Content-Type')).toBe('application/ssml+xml');
    expect(call?.headers.get('X-Microsoft-OutputFormat')).toBe('audio-24khz-48kbitrate-mono-mp3');
    expect(call?.headers.get('User-Agent')).toBe('english-coach');
    expect(call?.body).toBe(buildSsml('en-US-AvaNeural', 'Hi & bye'));
  });

  it('(AC-T17-6) (TC-11) 不支援的語音 → not_configured，不呼叫 fetch', async () => {
    const p = make();
    const e = expectErr(await p.tts.synthesize('Hi', 'gemini:Kore', { timeoutMs: 5000 }));
    expect(e.kind).toBe('not_configured');
    expect(e.message).toBe('voice not supported by azure-speech: gemini:Kore');
    expect(p.calls).toHaveLength(0);
  });

  it('(AC-T17-8) (TC-14) 未驗證：成功 → mp3、長度由位元率換算', async () => {
    const r = expectOk(await speak(make(bytes(200, 30_000))));
    expect(r.mime).toBe('audio/mpeg');
    expect(r.durationMs).toBe(5000);
    expect(r.audio).toHaveLength(30_000);
  });

  it('(AC-T17-8) (TC-15) 空音檔 → invalid_response', async () => {
    expect(expectErr(await speak(make(bytes(200, 0)))).kind).toBe('invalid_response');
  });
});

describe('SSML', () => {
  it('(AC-T17-7) (TC-12) 跳脫順序與控制字元', () => {
    expect(escapeSsmlText(`a & <b> "c" 'd'`)).toBe('a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;');
    expect(escapeSsmlText('&amp;')).toBe('&amp;amp;');
    expect(escapeSsmlText('a\u0001b\u001Fc\td\ne\rf')).toBe('abc\td\ne\rf');
  });

  it('(AC-T17-7) (TC-13) 範本', () => {
    expect(buildSsml('en-US-AvaNeural', 'Hello')).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-AvaNeural">Hello</voice></speak>',
    );
  });
});

describe('錯誤分類', () => {
  const failure = (status: number, bodyText = '', headers: Record<string, string> = {}) => ({
    status,
    headers: new Headers(headers),
    bodyText,
  });

  it('(AC-T17-9) (TC-16) 未驗證：額度與限流', () => {
    const quota = classifyAzureError(failure(403, 'Quota Exceeded'), 'tts');
    expect(quota).toMatchObject({ kind: 'quota_exhausted', retryAfterSec: null });
    expect(classifyAzureError(failure(429, '', { 'Retry-After': '3' }), 'tts')).toMatchObject({
      kind: 'rate_limited',
      retryAfterSec: 3,
    });
    expect(classifyAzureError(failure(429), 'tts')).toMatchObject({ kind: 'rate_limited', retryAfterSec: null });
    expect(parseRetryAfter('2.1')).toBe(3);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
  });

  it('(AC-T17-9) (TC-17) 其他狀態，兩個能力的 capability 跟著變', () => {
    const expected: ReadonlyArray<readonly [number, string, string]> = [
      [401, 'auth', ''],
      [403, 'auth', 'Forbidden'],
      [400, 'unavailable', ''],
      [415, 'unavailable', ''],
      [302, 'unavailable', ''],
      [500, 'unavailable', ''],
      [503, 'unavailable', ''],
      [408, 'timeout', ''],
      [504, 'timeout', ''],
    ];
    for (const capability of ['pronunciation', 'tts'] as const) {
      for (const [status, kind, body] of expected) {
        const e = classifyAzureError(failure(status, body), capability);
        expect(e).toMatchObject({ kind, provider: 'azure-speech', capability });
        if (kind === 'unavailable') expect(e.message).toContain(String(status));
      }
    }
  });
});

describe('逾時、網路錯誤、金鑰遮蔽', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const both: ReadonlyArray<readonly [string, (p: ReturnType<typeof make>) => Promise<Result<unknown, ProviderError>>]> = [
    ['pronunciation', assess],
    ['tts', speak],
  ];

  it('(AC-T17-10) (TC-18) 三種逾時 → timeout；網路錯誤 → unavailable', async () => {
    for (const [, run] of both) {
      for (const reply of [hangUntilAborted, hangIgnoringSignal, hangBody]) {
        const p = make(reply);
        const pending = run(p);
        await vi.advanceTimersByTimeAsync(5000);
        expect(expectErr(await pending).kind).toBe('timeout');
        expect(p.calls).toHaveLength(1);
      }
      const p = make(networkError('socket closed'));
      expect(expectErr(await run(p)).kind).toBe('unavailable');
    }
  });

  it('(AC-T17-10) (TC-19) 錯誤內容與例外含金鑰時都遮蔽，且每個情境 fetch 剛好一次', async () => {
    const leak = `bad key ${KEY} here`;
    const assessOnly: readonly Reply[] = [
      text(200, samples.emptyNBest),
      text(200, samples.noNBest),
      text(200, samples.noPronScore),
      text(200, samples.status('Error')),
      text(200, samples.status(`Unknown ${KEY}`)),
      text(200, `not json ${KEY}`),
    ];
    for (const reply of assessOnly) {
      const p = make(reply);
      expect(expectErr(await assess(p)).message).not.toContain(KEY);
      expect(p.calls).toHaveLength(1);
    }
    const replies: readonly Reply[] = [
      bytes(200, 0),
      text(400, leak),
      text(401, leak),
      text(403, leak),
      text(429, leak),
      text(500, leak),
      networkError(leak),
    ];
    for (const reply of replies) {
      for (const [, run] of both) {
        const p = make(reply);
        const e: ProviderError = expectErr(await run(p));
        expect(e.message).not.toContain(KEY);
        expect(p.calls).toHaveLength(1);
      }
    }
    const withBody = expectErr(await assess(make(text(500, leak))));
    expect(withBody.message).toContain('[redacted]');
    const withThrow = expectErr(await speak(make(networkError(leak))));
    expect(withThrow.message).toContain('[redacted]');
  });
});

describe('樣本內容', () => {
  it('(AC-T17-11) (TC-20) test/ 下沒有金鑰樣子的字串', () => {
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

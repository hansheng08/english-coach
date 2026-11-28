import { err, ok, StoragePathSchema, type TtsResponse } from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createMockApi, MOCK_TTS_URL } from './mock';
import { makeTestApiClient } from './test/fakes';
import { ttsResolver } from './tts-resolve';

const PATH = StoragePathSchema.parse(`00000000-0000-4000-8000-0000000000aa/${'d'.repeat(64)}.mp3`);
const RESPONSE: TtsResponse = {
  audioUrl: 'https://example.supabase.co/storage/v1/object/sign/tts/x.mp3?token=t',
  path: PATH,
  durationMs: 4200,
  cached: false,
  meta: { ttsProvider: 'azure-speech', voice: 'azure:en-US-AvaNeural' },
};

describe('ttsResolver (AC-T21-12)', () => {
  it('(AC-T21-12) (TC-17) a text source calls client.tts and returns the url and duration', async () => {
    const tts = vi.fn(() => Promise.resolve(ok(RESPONSE)));
    const ttsSignedUrl = vi.fn();
    const resolve = ttsResolver(makeTestApiClient({ tts, ttsSignedUrl }));
    expect(await resolve({ kind: 'text', text: 'Hello.' })).toEqual(ok({ url: RESPONSE.audioUrl, durationMs: 4200 }));
    expect(tts).toHaveBeenCalledWith('Hello.');
    expect(ttsSignedUrl).not.toHaveBeenCalled();
  });

  it('(AC-T21-12) (TC-17) a path source calls client.ttsSignedUrl and the duration is null', async () => {
    const tts = vi.fn();
    const ttsSignedUrl = vi.fn(() => Promise.resolve(ok('https://example.supabase.co/sign?token=t')));
    const resolve = ttsResolver(makeTestApiClient({ tts, ttsSignedUrl }));
    expect(await resolve({ kind: 'path', path: PATH })).toEqual(ok({ url: 'https://example.supabase.co/sign?token=t', durationMs: null }));
    expect(ttsSignedUrl).toHaveBeenCalledWith(PATH);
    expect(tts).not.toHaveBeenCalled();
  });

  it('(AC-T21-12) (TC-17) a client error becomes the API error body shape', async () => {
    const resolve = ttsResolver(makeTestApiClient({ tts: () => Promise.resolve(err({ kind: 'unauthenticated', message: 'not signed in' })) }));
    expect(await resolve({ kind: 'text', text: 'Hi.' })).toEqual(err({ kind: 'unauthenticated', message: 'not signed in', retryable: false }));
  });

  it('(AC-T21-12) (TC-17) the mock client sends no network request and returns /mock/tts.wav for both sources', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const resolve = ttsResolver(createMockApi('').client);
    const byText = await resolve({ kind: 'text', text: 'Hi.' });
    const byPath = await resolve({ kind: 'path', path: PATH });
    expect(byText).toMatchObject({ ok: true, value: { url: '/mock/tts.wav' } });
    expect(byPath).toEqual(ok({ url: '/mock/tts.wav', durationMs: null }));
    expect(MOCK_TTS_URL).toBe('/mock/tts.wav');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

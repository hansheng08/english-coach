import { ok, StoragePathSchema, TtsResponseSchema } from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createMockApi } from './mock';
import { createSupabaseApiClient, type AuthLike } from './supabase';
import { ttsResolver } from './tts-resolve';
import { makeTestApiClient } from './test/fakes';

// QA probes for T-021 front-end tts (AC-T21-12, AC-T21-14). Injected fakes only; low-entropy token.
const PATH = StoragePathSchema.parse(`00000000-0000-4000-8000-000000000021/${'e'.repeat(64)}.mp3`);
const OK_BODY = {
  audioUrl: 'https://qa-project.supabase.co/storage/v1/object/sign/tts/x.mp3?token=fake-token',
  path: PATH,
  durationMs: 900,
  cached: false,
  meta: { ttsProvider: 'azure-speech', voice: 'azure:en-US-AvaNeural' },
};

function auth(): AuthLike {
  return {
    getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(response: () => Promise<Response>, token: () => Promise<string | null> = () => Promise.resolve('fake-token')) {
  const fetchImpl = vi.fn<typeof fetch>(() => response());
  const c = createSupabaseApiClient(auth(), { fetch: fetchImpl, getAccessToken: token }, { functionsUrl: 'https://qa-project.supabase.co/functions/v1/api' });
  return { c, fetchImpl };
}

describe('T-021 QA supabase ApiClient tts', () => {
  it('(QA-41) (AC-T21-14) tts posts {text} as JSON to <functionsUrl>/tts with a Bearer token and parses the response', async () => {
    const { c, fetchImpl } = client(() => Promise.resolve(json(200, OK_BODY)));
    const r = await c.tts?.('hi');
    expect(r?.ok).toBe(true);
    expect(r?.ok === true ? r.value : null).toEqual(OK_BODY);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(input).toBe('https://qa-project.supabase.co/functions/v1/api/tts');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fake-token');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({ text: 'hi' });
  });

  it('(QA-42) (AC-T21-14) server error bodies become AppErrors; non-JSON, bad shapes, a throwing fetch and a throwing token source are internal, never thrown', async () => {
    const rate = await client(() => Promise.resolve(json(429, { error: { kind: 'rate_limited', message: 'slow', retryable: true, provider: 'azure-speech', capability: 'tts', retryAfterSec: 5 } }))).c.tts?.('hi');
    expect(rate?.ok === false ? rate.error : null).toMatchObject({ kind: 'rate_limited', retryAfterSec: 5 });
    const unauth = await client(() => Promise.resolve(json(401, { error: { kind: 'unauthenticated', message: 'no', retryable: false } }))).c.tts?.('hi');
    expect(unauth?.ok === false ? unauth.error.kind : null).toBe('unauthenticated');
    for (const response of [
      () => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 })),
      () => Promise.resolve(json(200, { audioUrl: 'not a url' })),
      () => Promise.resolve(json(500, { nope: true })),
      () => Promise.reject(new Error('offline')),
    ]) {
      const r = await client(response).c.tts?.('hi');
      expect(r?.ok === false ? r.error.kind : null).toBe('internal');
    }
    const { c, fetchImpl } = client(() => Promise.resolve(json(200, OK_BODY)), () => Promise.reject(new Error('session store broken')));
    const t = await c.tts?.('hi');
    expect(t?.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('(QA-43) (AC-T21-12) supabase ttsSignedUrl asks the tts bucket for 3600 seconds; a bucket error is storage_failed sign', async () => {
    const createSignedUrl = vi.fn(() => Promise.resolve({ data: { signedUrl: 'https://qa.example/s?token=t' }, error: null }));
    const fetchImpl = vi.fn<typeof fetch>();
    const c = createSupabaseApiClient(auth(), { fetch: fetchImpl, getAccessToken: () => Promise.resolve(null) }, { ttsBucket: { createSignedUrl } });
    const r = await c.ttsSignedUrl?.(PATH);
    expect(r).toEqual({ ok: true, value: 'https://qa.example/s?token=t' });
    expect(createSignedUrl).toHaveBeenCalledWith(PATH, 3600);
    expect(fetchImpl).not.toHaveBeenCalled();
    const bad = createSupabaseApiClient(auth(), { fetch: fetchImpl, getAccessToken: () => Promise.resolve(null) }, {
      ttsBucket: { createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'denied' } }) },
    });
    const e = await bad.ttsSignedUrl?.(PATH);
    expect(e?.ok === false ? e.error : null).toMatchObject({ kind: 'storage_failed', op: 'sign' });
  });

  it('(QA-44) (AC-T21-12) the mock client never fetches and returns /mock/tts.wav for both methods; the resolver maps them', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const { client: mock } = createMockApi('');
    const resolve = ttsResolver(mock);
    expect(await resolve({ kind: 'text', text: 'hi' })).toMatchObject({ ok: true, value: { url: '/mock/tts.wav' } });
    expect(await resolve({ kind: 'path', path: PATH })).toEqual({ ok: true, value: { url: '/mock/tts.wav', durationMs: null } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('(QA-45) (AC-T21-12) the resolver passes durationMs for text, null for path, and turns client errors into player errors', async () => {
    const value = TtsResponseSchema.parse({ ...OK_BODY, durationMs: 777 });
    const tts = vi.fn(() => Promise.resolve(ok(value)));
    const ttsSignedUrl = vi.fn(() => Promise.resolve({ ok: false as const, error: { kind: 'storage_failed' as const, op: 'sign' as const, message: 'createSignedUrl failed' } }));
    const resolve = ttsResolver(makeTestApiClient({ tts, ttsSignedUrl }));
    expect(await resolve({ kind: 'text', text: 'qa text' })).toEqual({ ok: true, value: { url: OK_BODY.audioUrl, durationMs: 777 } });
    expect(tts).toHaveBeenCalledWith('qa text');
    const r = await resolve({ kind: 'path', path: PATH });
    expect(r.ok).toBe(false);
    expect(!r.ok ? r.error : null).toMatchObject({ kind: 'storage_failed', retryable: true });
    expect(ttsSignedUrl).toHaveBeenCalledWith(PATH);
  });
});

import { ok, StoragePathSchema, UserIdSchema } from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { AuthLike } from './supabase';
import { createSupabaseApiClient } from './supabase';
import { makeTestApiClient, makeTestApiRuntime } from './test/fakes';

const USER = { userId: UserIdSchema.parse('00000000-0000-4000-8000-0000000000aa'), email: 'a@example.com' };

const fakeAuth = (): AuthLike => ({
  getSession: () => Promise.resolve({ data: { session: null }, error: null }),
  signInWithPassword: () => Promise.resolve({ data: { session: null }, error: null }),
  signOut: () => Promise.resolve({ error: null }),
});

describe('makeTestApiClient / makeTestApiRuntime (AC-T21-14)', () => {
  it('(AC-T21-14) (TC-19) an un-overridden method returns internal with "not stubbed: <name>", an override is used', async () => {
    const client = makeTestApiClient({ getSession: () => Promise.resolve(ok(USER)) });
    expect(await client.getSession()).toEqual(ok(USER));
    expect(await client.signOut()).toEqual({ ok: false, error: { kind: 'internal', message: 'not stubbed: signOut' } });
  });

  it('(AC-T21-14) (TC-19) the tts methods have defaults that return not stubbed', async () => {
    const client = makeTestApiClient();
    expect(await client.tts?.('hi')).toEqual({ ok: false, error: { kind: 'internal', message: 'not stubbed: tts' } });
    expect(await client.ttsSignedUrl?.(StoragePathSchema.parse(`${USER.userId}/${'f'.repeat(64)}.mp3`))).toMatchObject({ ok: false, error: { kind: 'internal' } });
  });

  it('(AC-T21-14) (TC-19) makeTestApiRuntime({ preview: null }) is valid and the override is applied', async () => {
    const runtime = makeTestApiRuntime({ preview: null, client: { getSession: () => Promise.resolve(ok(null)) } });
    expect(runtime.preview).toBeNull();
    expect(await runtime.client.getSession()).toEqual(ok(null));
  });

  it('(AC-T21-14) (TC-23) the runtime defaults are preview null, an unsigned-in token, and a fetch that fails unless overridden', async () => {
    const runtime = makeTestApiRuntime();
    const global = vi.spyOn(globalThis, 'fetch');
    expect(runtime.preview).toBeNull();
    expect(await runtime.deps.getAccessToken()).toBeNull();
    await expect(runtime.deps.fetch('https://example.test/x')).rejects.toThrow('not stubbed: fetch');
    expect(global).not.toHaveBeenCalled();
    global.mockRestore();
  });
});

describe('createSupabaseApiClient composition (AC-T21-14)', () => {
  it('(AC-T21-14) (TC-20) tts uses the injected fetch and token, and the global fetch is never called', async () => {
    const response = {
      audioUrl: 'https://example.supabase.co/storage/v1/object/sign/tts/x.mp3?token=t',
      path: `${USER.userId}/${'e'.repeat(64)}.mp3`,
      durationMs: 1000,
      cached: true,
      meta: { ttsProvider: 'azure-speech', voice: 'azure:en-US-AvaNeural' },
    };
    const seen: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
    const injected: typeof fetch = (input, init) => {
      seen.push({ url: typeof input === 'string' ? input : 'non-string', init });
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    };
    const global = vi.spyOn(globalThis, 'fetch');
    const client = createSupabaseApiClient(fakeAuth(), { fetch: injected, getAccessToken: () => Promise.resolve('fake-token') });
    const r = await client.tts?.('hi');
    expect(r?.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const init = seen[0]?.init;
    expect(seen[0]?.url).toMatch(/\/tts$/);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fake-token');
    expect(init?.body).toBe(JSON.stringify({ text: 'hi' }));
    expect(global).not.toHaveBeenCalled();
    global.mockRestore();
  });

  it('(AC-T21-14) (TC-23) a null access token gives unauthenticated, does not call fetch and does not throw', async () => {
    const injected = vi.fn();
    const client = createSupabaseApiClient(fakeAuth(), { fetch: injected, getAccessToken: () => Promise.resolve(null) });
    expect(await client.tts?.('hi')).toEqual({ ok: false, error: { kind: 'unauthenticated', message: 'not signed in' } });
    expect(injected).not.toHaveBeenCalled();
  });

  it('(AC-T21-14) (TC-20) a server error body is turned into an AppError with its kind', async () => {
    const body = { error: { kind: 'rate_limited', message: 'slow', retryable: true, provider: 'azure-speech', capability: 'tts', retryAfterSec: 5 } };
    const injected = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 429 })));
    const client = createSupabaseApiClient(fakeAuth(), { fetch: injected, getAccessToken: () => Promise.resolve('t') });
    expect(await client.tts?.('hi')).toMatchObject({ ok: false, error: { kind: 'rate_limited', retryAfterSec: 5 } });
  });
});

import { ok, UserIdSchema } from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseApiClient, type AuthLike } from './supabase';
import type { ApiClient, ApiRuntime, AuthSession } from './client';

// QA probes for T-021 AC-T21-14 / TC-19、TC-20、TC-23 and ARCHITECTURE §9.1.7 (ADR-020 決定 1、ADR-021 決定 4、5):
// makeTestApiClient / makeTestApiRuntime live in apps/web/src/api/test/fakes.ts (not on main yet).
// createSupabaseApiClient receives fetch and getAccessToken. Fake tokens are low-entropy.

const USER: AuthSession = { userId: UserIdSchema.parse('00000000-0000-4000-8000-000000000021'), email: 'qa@example.com' };

type ErrResult = { ok: boolean; error?: { kind?: string; message?: string } };

/** T-021 adds these on ApiClient (temporarily optional until T-020). */
type TtsMethods = {
  tts(text: string): Promise<ErrResult>;
  ttsSignedUrl(path: string): Promise<ErrResult>;
};

type ApiClientDeps = {
  readonly fetch: typeof fetch;
  readonly getAccessToken: () => Promise<string | null>;
};

type TestRuntime = ApiRuntime & { deps: ApiClientDeps };

type Fakes = {
  makeTestApiClient: (overrides?: Partial<ApiClient>) => ApiClient;
  makeTestApiRuntime: (overrides?: { preview?: ApiRuntime['preview'] | null }) => TestRuntime;
};

function expectNotStubbed(r: ErrResult, name: string) {
  expect(r.ok).toBe(false);
  expect(r.error?.kind).toBe('internal');
  expect(r.error?.message).toContain('not stubbed:');
  expect(r.error?.message).toContain(name);
}

function auth(): AuthLike {
  return {
    getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
  };
}

async function loadFakes(): Promise<Fakes> {
  const mod: unknown = await import('./test/fakes');
  return mod as Fakes;
}

function createClientWithDeps(a: AuthLike, deps: ApiClientDeps): ApiClient & TtsMethods {
  // T-021 changes the signature to (auth, deps). The extra argument is required by AC-T21-14.
  const create = createSupabaseApiClient as (auth: AuthLike, ...rest: readonly unknown[]) => ApiClient & TtsMethods;
  return create(a, deps);
}

function requestFromCall(call: unknown): Request {
  const pair: readonly unknown[] = Array.isArray(call) ? call : [];
  const input: unknown = pair[0];
  const init: unknown = pair[1];
  if (input instanceof Request) return input;
  const initObj = init && typeof init === 'object' ? (init as RequestInit) : undefined;
  return new Request(input instanceof URL || typeof input === 'string' ? input : String(input), initObj);
}

async function expectFailsWithoutCallingGlobalFetch(fn: typeof fetch): Promise<void> {
  const spy = vi.spyOn(globalThis, 'fetch');
  let failed = false;
  try {
    await fn('https://example.com/qa-tts');
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
}

describe('T-021 QA ApiClient factory (AC-T21-14)', () => {
  it('(QA-1) (AC-T21-14) (TC-19) an un-overridden makeTestApiClient method returns internal with not stubbed: <name>', async () => {
    const { makeTestApiClient } = await loadFakes();
    const client = makeTestApiClient();
    expectNotStubbed(await client.getSession(), 'getSession');
    expectNotStubbed(await client.signInWithPassword('qa@example.com', 'fake-pass'), 'signInWithPassword');
    expectNotStubbed(await client.signOut(), 'signOut');
  });

  it('(QA-2) (AC-T21-14) (TC-19) an override is used and every other method stays un-stubbed', async () => {
    const { makeTestApiClient } = await loadFakes();
    const client = makeTestApiClient({ getSession: () => Promise.resolve(ok(USER)) });
    expect(await client.getSession()).toEqual(ok(USER));
    expectNotStubbed(await client.signInWithPassword('qa@example.com', 'fake-pass'), 'signInWithPassword');
    expectNotStubbed(await client.signOut(), 'signOut');
  });

  it('(QA-3) (AC-T21-14) (TC-19) makeTestApiRuntime({ preview: null }) applies the override and the client is un-stubbed', async () => {
    const { makeTestApiRuntime } = await loadFakes();
    const runtime = makeTestApiRuntime({ preview: null });
    expect(runtime.preview).toBeNull();
    expectNotStubbed(await runtime.client.getSession(), 'getSession');
  });

  it('(QA-15) (AC-T21-14) (TC-19) makeTestApiClient().tts and ttsSignedUrl have defaults and return not stubbed:', async () => {
    const { makeTestApiClient } = await loadFakes();
    const client = makeTestApiClient() as ApiClient & TtsMethods;
    expect(typeof client.tts).toBe('function');
    expect(typeof client.ttsSignedUrl).toBe('function');
    expectNotStubbed(await client.tts('hi'), 'tts');
    expectNotStubbed(await client.ttsSignedUrl('tts/qa'), 'ttsSignedUrl');
  });

  it('(QA-16) (AC-T21-14) (TC-23) makeTestApiRuntime() defaults are preview null, getAccessToken null, and fetch fails if not overridden', async () => {
    const { makeTestApiRuntime } = await loadFakes();
    const runtime = makeTestApiRuntime();
    expect(runtime.preview).toBeNull();
    expect(await runtime.deps.getAccessToken()).toBeNull();
    expect(typeof runtime.deps.fetch).toBe('function');
    await expectFailsWithoutCallingGlobalFetch(runtime.deps.fetch);
  });
});

describe('T-021 QA ApiClient deps injection (ARCH §9.1.7)', () => {
  it('(QA-6) createSupabaseApiClient accepts fetch and getAccessToken and still serves getSession', async () => {
    const fetchImpl = vi.fn(globalThis.fetch);
    const getAccessToken = vi.fn(() => Promise.resolve('fake-token'));
    const client = createClientWithDeps(auth(), { fetch: fetchImpl, getAccessToken });
    expect(await client.getSession()).toEqual({ ok: true, value: null });
  });

  it('(QA-17) (AC-T21-14) (TC-20) supabase tts uses injected fetch and token, not global fetch', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    const getAccessToken = vi.fn(() => Promise.resolve('fake-token'));
    const client = createClientWithDeps(auth(), { fetch: fetchImpl, getAccessToken });
    expect(typeof client.tts).toBe('function');
    const spy = vi.spyOn(globalThis, 'fetch');
    await Promise.resolve(client.tts('hi')).catch(() => undefined);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(getAccessToken).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalled();
    const call = fetchImpl.mock.calls.at(0);
    expect(call).toBeDefined();
    const req = requestFromCall(call);
    expect(req.method).toBe('POST');
    expect(new URL(req.url, 'https://example.com').pathname).toMatch(/\/tts\/?$/);
    expect(req.headers.get('Authorization')).toContain('fake-token');
  });

  it('(QA-18) (AC-T21-14) (TC-23) a null access token makes tts return unauthenticated, does not call fetch, and does not throw', async () => {
    const fetchImpl = vi.fn();
    const getAccessToken = vi.fn(() => Promise.resolve(null));
    const client = createClientWithDeps(auth(), { fetch: fetchImpl, getAccessToken });
    expect(typeof client.tts).toBe('function');
    const r = await client.tts('hi');
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('unauthenticated');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

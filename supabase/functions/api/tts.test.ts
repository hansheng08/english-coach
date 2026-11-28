import {
  ApiErrorBodySchema,
  err,
  ok,
  StoragePathSchema,
  TtsResponseSchema,
  type ProviderError,
  type TtsProvider,
  type TtsResult,
  type VoiceId,
} from '@english-coach/contracts';
import { expectErr } from '@english-coach/contracts/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TokenClaims } from '../_shared/db/auth.ts';
import type { ProviderCallRecord } from '../_shared/db/provider-call.ts';
import { makeTestTtsStore } from '../_shared/db/test/fakes.ts';
import type { TtsStore } from '../_shared/db/tts-store.ts';
import { createRegistry } from '../_shared/providers/registry.ts';
import { ttsObjectPath } from '../_shared/tts/cache.ts';
import { createRouter } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';
import { UserIdSchema } from '@english-coach/contracts';

const SUB = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';
const GOOD: TokenClaims = { role: 'authenticated', sub: SUB, is_anonymous: false };
const USER = UserIdSchema.parse(SUB);
const AVA: VoiceId = 'azure:en-US-AvaNeural';
const bearer = { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json' };
const SIGNED = 'https://example.supabase.co/storage/v1/object/sign/tts/x.mp3?token=t';
const AUDIO: TtsResult = { audio: new Uint8Array([1, 2, 3]), mime: 'audio/mpeg', durationMs: 4200 };

const providerError = (kind: 'timeout' | 'rate_limited'): ProviderError =>
  kind === 'rate_limited'
    ? { kind, provider: 'azure-speech', capability: 'tts', message: 'slow down', retryAfterSec: 5 }
    : { kind, provider: 'azure-speech', capability: 'tts', message: 'too slow' };

type Opts = {
  readonly store?: Partial<TtsStore>;
  readonly synth?: () => Promise<ReturnType<typeof ok<TtsResult>> | ReturnType<typeof err<ProviderError>>>;
  readonly noProvider?: boolean;
};

function setup(opts: Opts = {}) {
  const synthesize = vi.fn<TtsProvider['synthesize']>(() => (opts.synth === undefined ? Promise.resolve(ok(AUDIO)) : opts.synth()));
  const fake: TtsProvider = { id: 'azure-speech', capability: 'tts', tier: 'free', displayName: 'Fake', synthesize };
  const registry = createRegistry({ providers: opts.noProvider === true ? [] : [fake], env: () => undefined });
  const resolve = vi.spyOn(registry, 'resolve');
  const calls: ProviderCallRecord[] = [];
  const logs: string[] = [];
  const store = makeTestTtsStore({
    readVoice: () => Promise.resolve(ok(AVA)),
    find: () => Promise.resolve(ok(null)),
    upload: () => Promise.resolve(ok(null)),
    signedUrl: () => Promise.resolve(ok(SIGNED)),
    recordCall: (r) => {
      calls.push(r);
      return Promise.resolve(ok(null));
    },
    ...opts.store,
  });
  const readVoice = vi.spyOn(store, 'readVoice');
  const upload = vi.spyOn(store, 'upload');
  let tick = 0;
  const handle = createRouter(
    makeTestRouterDeps({
      auth: ok({ verifyToken: () => Promise.resolve(ok(GOOD)) }),
      routeDeps: ok(
        makeTestRouteDeps({
          now: () => new Date(1_000_000 + 250 * tick++),
          providers: registry,
          ttsStore: () => store,
          log: (line) => logs.push(line),
        }),
      ),
    }),
  );
  const post = (body: string, headers: Record<string, string> = bearer) =>
    handle(new Request('https://example.test/functions/v1/api/tts', { method: 'POST', headers, body }));
  const postJson = (value: unknown) => post(JSON.stringify(value));
  return { post, postJson, synthesize, resolve, readVoice, upload, calls, logs };
}

async function errorOf(res: Response) {
  return ApiErrorBodySchema.parse(await res.json()).error;
}

describe('POST /tts input (AC-T21-3)', () => {
  it('(AC-T21-3) (TC-4) rejects a missing token with 401 and bad bodies with 400 validation, without reading settings or calling a provider', async () => {
    const h = setup();
    expect((await h.post('{"text":"hi"}', { 'Content-Type': 'application/json' })).status).toBe(401);

    const notJson = await h.post('not json');
    expect(notJson.status).toBe(400);
    expect((await errorOf(notJson)).issues?.[0]?.path).toBe('body');

    for (const body of [{ text: '' }, { text: 'a'.repeat(1001) }]) {
      const res = await h.postJson(body);
      expect(res.status).toBe(400);
      const e = await errorOf(res);
      expect(e.kind).toBe('validation');
      expect(e.issues?.[0]?.path).toBe('text');
    }
    const extra = await h.postJson({ text: 'hi', extra: 1 });
    expect(extra.status).toBe(400);
    expect(JSON.stringify((await errorOf(extra)).issues)).toContain('extra');

    expect(h.readVoice).not.toHaveBeenCalled();
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.synthesize).not.toHaveBeenCalled();
  });
});

describe('POST /tts voice (AC-T21-4)', () => {
  it('(AC-T21-4) (TC-5) the voice only comes from readVoice, and a request-supplied voice is rejected', async () => {
    const andrew: VoiceId = 'azure:en-US-AndrewNeural';
    const h = setup({ store: { readVoice: () => Promise.resolve(ok(andrew)) } });
    expect((await h.postJson({ text: 'hi' })).status).toBe(200);
    expect(h.synthesize.mock.calls[0]?.[1]).toBe(andrew);
    expect((await h.postJson({ text: 'hi', voice: AVA })).status).toBe(400);
  });

  it('(AC-T21-4) (TC-5) an invalid tts setting is 500 internal and nothing is synthesized', async () => {
    const h = setup({ store: { readVoice: () => Promise.resolve(err({ kind: 'internal', message: 'profile.settings.tts is invalid' })) } });
    const res = await h.postJson({ text: 'hi' });
    expect(res.status).toBe(500);
    expect((await errorOf(res)).kind).toBe('internal');
    expect(h.synthesize).not.toHaveBeenCalled();
  });
});

describe('POST /tts cache (AC-T21-5, AC-T21-7)', () => {
  it('(AC-T21-5) (TC-6) a cached object skips resolve, synthesize and upload, and the duration comes from its size', async () => {
    const h = setup({ store: { find: () => Promise.resolve(ok({ bytes: 30000 })) } });
    const res = await h.postJson({ text: 'Hello / world' });
    expect(res.status).toBe(200);
    const body = TtsResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ cached: true, durationMs: 5000, meta: { ttsProvider: 'azure-speech', voice: AVA } });
    expect(body.path).toBe(await ttsObjectPath(USER, AVA, 'Hello world'));
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.synthesize).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('(AC-T21-5) (TC-7) a miss synthesizes once and uploads once, also when the upload reports the object already exists', async () => {
    const h = setup();
    const res = await h.postJson({ text: 'Hello world' });
    expect(res.status).toBe(200);
    expect(TtsResponseSchema.parse(await res.json())).toMatchObject({ cached: false, durationMs: 4200, audioUrl: SIGNED });
    expect(h.synthesize).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.upload.mock.calls[0]?.[2]).toBe('audio/mpeg');
    // 「已存在」由 TtsStore.upload 轉成 ok（tts-store.test.ts），所以兩次都是 200。
    expect((await h.postJson({ text: 'Hello world' })).status).toBe(200);
  });

  it('(AC-T21-7) (TC-9) the response passes its schema, uses TTS_TIMEOUT_MS and passes the usage (0 until T-020) to resolve', async () => {
    const h = setup();
    const res = await h.postJson({ text: 'Hello world' });
    const body = TtsResponseSchema.parse(await res.json());
    expect(body.meta).toEqual({ ttsProvider: 'azure-speech', voice: AVA });
    expect(StoragePathSchema.safeParse(body.path).success).toBe(true);
    expect(h.synthesize.mock.calls[0]?.[2]).toEqual({ timeoutMs: 8000 });
    // 過渡：T-020 的 sumPaidUsageThisMonthNtd 還不在 main，第三個參數暫傳 0。
    expect(h.resolve.mock.calls[0]?.[2]).toBe(0);
  });
});

describe('POST /tts errors (AC-T21-6)', () => {
  it('(AC-T21-6) (TC-8) not_configured from resolve is 503 and nothing is uploaded', async () => {
    const h = setup({ noProvider: true });
    const res = await h.postJson({ text: 'hi' });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).kind).toBe('not_configured');
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('(AC-T21-6) (TC-8) timeout and rate_limited from synthesize keep their status and body, with no upload', async () => {
    const slow = setup({ synth: () => Promise.resolve(err(providerError('timeout'))) });
    const r1 = await slow.postJson({ text: 'hi' });
    expect(r1.status).toBe(504);
    expect((await errorOf(r1)).kind).toBe('timeout');
    const busy = setup({ synth: () => Promise.resolve(err(providerError('rate_limited'))) });
    const r2 = await busy.postJson({ text: 'hi' });
    expect(r2.status).toBe(429);
    expect(await errorOf(r2)).toMatchObject({ kind: 'rate_limited', retryAfterSec: 5, retryable: true });
    expect(slow.upload).not.toHaveBeenCalled();
    expect(busy.upload).not.toHaveBeenCalled();
  });

  it('(AC-T21-6) (TC-8) a signedUrl storage error is 502 storage_failed, retryable, with no path or text in the message', async () => {
    const h = setup({
      store: { signedUrl: () => Promise.resolve(err({ kind: 'storage_failed', op: 'sign', message: 'storage sign failed' })) },
    });
    const res = await h.postJson({ text: 'secret sentence' });
    expect(res.status).toBe(502);
    const e = await errorOf(res);
    expect(e).toMatchObject({ kind: 'storage_failed', retryable: true });
    expect(e.message).not.toMatch(/secret|\.mp3/);
  });

  it('(AC-T21-6) a db_failed from the store is 500', async () => {
    const h = setup({ store: { find: () => Promise.resolve(err({ kind: 'db_failed', message: 'x' })) } });
    expect((await h.postJson({ text: 'hi' })).status).toBe(500);
  });
});

describe('POST /tts provider_call (AC-T21-15)', () => {
  it('(AC-T21-15) (TC-21) a miss writes one row on success and one on failure, with no text or path', async () => {
    const okRun = setup();
    await okRun.postJson({ text: 'hi' });
    expect(okRun.calls).toEqual([{ capability: 'tts', provider: 'azure-speech', model: null, tier: 'free', errorKind: null, latencyMs: 250 }]);

    const failRun = setup({ synth: () => Promise.resolve(err(providerError('timeout'))) });
    await failRun.postJson({ text: 'hi' });
    expect(failRun.calls).toHaveLength(1);
    expect(failRun.calls[0]).toMatchObject({ capability: 'tts', errorKind: 'timeout', tier: 'free' });
    expect(JSON.stringify([...okRun.calls, ...failRun.calls])).not.toMatch(/"hi"|\.mp3/);
  });

  it('(AC-T21-15) (TC-21) a cache hit and a failed resolve write nothing', async () => {
    const hit = setup({ store: { find: () => Promise.resolve(ok({ bytes: 100 })) } });
    await hit.postJson({ text: 'hi' });
    expect(hit.calls).toHaveLength(0);
    const none = setup({ noProvider: true });
    await none.postJson({ text: 'hi' });
    expect(none.calls).toHaveLength(0);
  });

  it('(AC-T21-15) (TC-22) a failing recordCall does not change the response, still uploads, and logs one line with only the kind', async () => {
    const h = setup({ store: { recordCall: () => Promise.resolve(err({ kind: 'db_failed', message: 'insert provider_call failed (42)' })) } });
    const res = await h.postJson({ text: 'hi' });
    expect(res.status).toBe(200);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.logs).toEqual(['tts recordCall kind=db_failed']);
  });
});

describe('test factories (AC-T21-8, AC-T21-15)', () => {
  it('(AC-T21-8) (TC-10) un-stubbed TtsStore and RouteDeps.ttsStore methods return not stubbed', async () => {
    const path = StoragePathSchema.parse(`${SUB}/${'a'.repeat(64)}.mp3`);
    expect(expectErr(await makeTestTtsStore().find(path)).message).toContain('not stubbed:');
    const ctx = { userId: USER, accessToken: 'a.b.c' } as Parameters<ReturnType<typeof makeTestRouteDeps>['ttsStore']>[0];
    const e = expectErr(await makeTestRouteDeps().ttsStore(ctx).upload(path, new Uint8Array(), 'audio/mpeg'));
    expect(e.message).toContain('not stubbed:');
  });

  it('(AC-T21-15) (TC-22) makeTestTtsStore().recordCall returns not stubbed', async () => {
    const r = { capability: 'tts', provider: 'azure-speech', model: null, tier: 'free', errorKind: null, latencyMs: 1 } as const;
    expect(expectErr(await makeTestTtsStore().recordCall(r)).message).toContain('not stubbed:');
  });
});

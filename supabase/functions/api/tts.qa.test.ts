import {
  ApiErrorBodySchema,
  DEFAULT_TTS_VOICE,
  err,
  ok,
  StoragePathSchema,
  TtsResponseSchema,
  UserIdSchema,
  type AppError,
  type ProviderError,
  type Result,
  type StoragePath,
  type TtsProvider,
  type TtsResult,
  type VoiceId,
} from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { TokenClaims } from '../_shared/db/auth.ts';
import type { ProviderCallRecord } from '../_shared/db/provider-call.ts';
import { makeTestTtsStore } from '../_shared/db/test/fakes.ts';
import type { TtsStore } from '../_shared/db/tts-store.ts';
import { createRegistry, DEFAULT_SETTINGS } from '../_shared/providers/registry.ts';
import { createRouter } from './router.ts';
import { makeTestRouteDeps, makeTestRouterDeps } from './test/route-deps.ts';
import { TTS_TIMEOUT_MS } from './tts.ts';

// QA probes for T-021 POST /tts (AC-T21-2..7, AC-T21-15). Fakes only; low-entropy ids and tokens.
const SUB = '00000000-0000-4000-8000-000000000021';
const CLAIMS: TokenClaims = { role: 'authenticated', sub: SUB, is_anonymous: false };
const USER = UserIdSchema.parse(SUB);
const ANDREW: VoiceId = 'azure:en-US-AndrewNeural';
const SIGNED = 'https://qa-project.supabase.co/storage/v1/object/sign/tts/x.mp3?token=fake-token';
const AUDIO: TtsResult = { audio: new Uint8Array([7, 7, 7]), mime: 'audio/mpeg', durationMs: 1234 };
const HELLO_AVA = `${USER}/495fdc915cf49dc35810648c1c9aaf7711040dee0610c09209e4ac96b28ced33.mp3`;
const HELLO_ANDREW = `${USER}/450f72a84d8219ae60df0a2ad9f3db5ebe3933b6916216d380be04ff48a5ec26.mp3`;
const HEADERS = { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json' };

type Synth = () => Promise<Result<TtsResult, ProviderError>>;
type Setup = { readonly store?: Partial<TtsStore>; readonly synth?: Synth; readonly tier?: 'free' | 'paid' };

function setup(opts: Setup = {}) {
  const synthesize = vi.fn<TtsProvider['synthesize']>(() => (opts.synth === undefined ? Promise.resolve(ok(AUDIO)) : opts.synth()));
  const provider: TtsProvider = { id: 'azure-speech', capability: 'tts', tier: opts.tier ?? 'free', displayName: 'QA', synthesize };
  const registry = createRegistry({ providers: [provider], env: () => undefined });
  const resolve = vi.spyOn(registry, 'resolve');
  const calls: ProviderCallRecord[] = [];
  const logs: string[] = [];
  const found: StoragePath[] = [];
  const uploads: { path: StoragePath; mime: string; bytes: number }[] = [];
  const signed: StoragePath[] = [];
  const store = makeTestTtsStore({
    readVoice: () => Promise.resolve(ok(DEFAULT_TTS_VOICE)),
    find: (p) => {
      found.push(p);
      return Promise.resolve(ok(null));
    },
    upload: (p, audio, mime) => {
      uploads.push({ path: p, mime, bytes: audio.length });
      return Promise.resolve(ok(null));
    },
    signedUrl: (p) => {
      signed.push(p);
      return Promise.resolve(ok(SIGNED));
    },
    recordCall: (r) => {
      calls.push(r);
      return Promise.resolve(ok(null));
    },
    ...opts.store,
  });
  const readVoice = vi.spyOn(store, 'readVoice');
  const times = [1000, 1250, 9999, 9999];
  let tick = 0;
  const handle = createRouter(
    makeTestRouterDeps({
      auth: ok({ verifyToken: () => Promise.resolve(ok(CLAIMS)) }),
      routeDeps: ok(
        makeTestRouteDeps({
          now: () => new Date(times[Math.min(tick++, times.length - 1)] ?? 0),
          providers: registry,
          ttsStore: () => store,
          log: (line) => logs.push(line),
        }),
      ),
    }),
  );
  const post = (body: string) => handle(new Request('https://example.test/functions/v1/api/tts', { method: 'POST', headers: HEADERS, body }));
  return { post, synthesize, resolve, readVoice, calls, logs, found, uploads, signed };
}

async function errorBody(res: Response) {
  return ApiErrorBodySchema.parse(await res.json()).error;
}

describe('T-021 QA POST /tts route', () => {
  it('(QA-19) (AC-T21-3) JSON that is not an object, a non-string text and whitespace-only text are 400 validation before any read', async () => {
    const s = setup();
    for (const body of ['[]', 'null', '"hi"', '{"text":1}', '{"text":"   /  \\n "}', '{}']) {
      const res = await s.post(body);
      expect(res.status, body).toBe(400);
      expect((await errorBody(res)).kind, body).toBe('validation');
    }
    expect(s.readVoice).not.toHaveBeenCalled();
    expect(s.resolve).not.toHaveBeenCalled();
    expect(s.synthesize).not.toHaveBeenCalled();
  });

  it('(QA-20) (AC-T21-2) (AC-T21-5) text is normalized before hashing and synthesis; the path is <user>/<sha256(voice\\ntext)>.mp3', async () => {
    const s = setup();
    const res = await s.post(JSON.stringify({ text: '  Hello /\n  world  ' }));
    expect(res.status).toBe(200);
    expect(s.found).toEqual([HELLO_AVA]);
    expect(s.synthesize.mock.calls[0]?.[0]).toBe('Hello world');
    expect(s.synthesize.mock.calls[0]?.[1]).toBe(DEFAULT_TTS_VOICE);
    expect(s.synthesize.mock.calls[0]?.[2]).toEqual({ timeoutMs: TTS_TIMEOUT_MS });
    expect(TTS_TIMEOUT_MS).toBe(8000);
    expect(s.uploads).toEqual([{ path: HELLO_AVA, mime: 'audio/mpeg', bytes: 3 }]);
    expect(s.signed).toEqual([HELLO_AVA]);
    const body = TtsResponseSchema.parse(await res.json());
    expect(body).toEqual({ audioUrl: SIGNED, path: HELLO_AVA, durationMs: 1234, cached: false, meta: { ttsProvider: 'azure-speech', voice: DEFAULT_TTS_VOICE } });
  });

  it('(QA-21) (AC-T21-4) (AC-T21-2) a custom voice changes the path, meta.voice and the voice passed to synthesize', async () => {
    const s = setup({ store: { readVoice: () => Promise.resolve(ok(ANDREW)) } });
    const res = await s.post(JSON.stringify({ text: 'Hello world' }));
    expect(res.status).toBe(200);
    expect(s.found).toEqual([HELLO_ANDREW]);
    expect(s.synthesize.mock.calls[0]?.[1]).toBe(ANDREW);
    expect(TtsResponseSchema.parse(await res.json()).meta.voice).toBe(ANDREW);
  });

  it('(QA-22) (AC-T21-5) (AC-T21-15) a cache hit signs the same path, reports the default tts provider, and writes no provider_call', async () => {
    const s = setup({ store: { find: () => Promise.resolve(ok({ bytes: 48 })) } });
    const res = await s.post(JSON.stringify({ text: 'Hello world' }));
    expect(res.status).toBe(200);
    const body = TtsResponseSchema.parse(await res.json());
    expect(body.cached).toBe(true);
    expect(body.durationMs).toBe(8);
    expect(body.meta.ttsProvider).toBe(DEFAULT_SETTINGS.tts.provider);
    expect(s.signed).toEqual([HELLO_AVA]);
    expect(s.resolve).not.toHaveBeenCalled();
    expect(s.synthesize).not.toHaveBeenCalled();
    expect(s.uploads).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  it('(QA-23) (AC-T21-15) a synthesize failure writes one provider_call with tier, errorKind and latency from now(), and no upload', async () => {
    const s = setup({
      synth: () => Promise.resolve(err<ProviderError>({ kind: 'invalid_response', provider: 'azure-speech', capability: 'tts', message: 'bad audio' })),
    });
    const res = await s.post(JSON.stringify({ text: 'Hello world' }));
    expect(res.status).toBe(502);
    expect((await errorBody(res)).kind).toBe('invalid_response');
    expect(s.calls).toEqual([{ capability: 'tts', provider: 'azure-speech', model: null, tier: 'free', errorKind: 'invalid_response', latencyMs: 250 }]);
    expect(s.uploads).toEqual([]);
    expect(s.signed).toEqual([]);
  });

  it('(QA-24) (AC-T21-15) a failed recordCall still returns 200 and logs exactly one line with only the kind', async () => {
    const s = setup({ store: { recordCall: () => Promise.resolve(err<AppError>({ kind: 'db_failed', message: 'insert provider_call failed' })) } });
    const res = await s.post(JSON.stringify({ text: 'Hello world' }));
    expect(res.status).toBe(200);
    expect(s.uploads).toHaveLength(1);
    expect(s.logs).toEqual(['tts recordCall kind=db_failed']);
  });

  it('(QA-25) (AC-T21-6) storage and db failures map to 502 storage_failed / 500 db_failed without the path or the text', async () => {
    const cases: { store: Partial<TtsStore>; status: number; kind: string }[] = [
      { store: { find: () => Promise.resolve(err<AppError>({ kind: 'storage_failed', op: 'download', message: 'storage download failed' })) }, status: 502, kind: 'storage_failed' },
      { store: { upload: () => Promise.resolve(err<AppError>({ kind: 'storage_failed', op: 'upload', message: 'storage upload failed' })) }, status: 502, kind: 'storage_failed' },
      { store: { readVoice: () => Promise.resolve(err<AppError>({ kind: 'db_failed', message: 'select profile failed' })) }, status: 500, kind: 'db_failed' },
      { store: { readVoice: () => Promise.resolve(err<AppError>({ kind: 'internal', message: 'profile.settings.tts is invalid' })) }, status: 500, kind: 'internal' },
    ];
    for (const c of cases) {
      const s = setup({ store: c.store });
      const res = await s.post(JSON.stringify({ text: 'Hello world' }));
      const text = await res.text();
      expect(res.status, c.kind).toBe(c.status);
      expect(ApiErrorBodySchema.parse(JSON.parse(text)).error.kind).toBe(c.kind);
      expect(text).not.toContain('Hello');
      expect(text).not.toContain(SUB);
      expect(text).not.toContain('.mp3');
    }
  });

  it('(QA-26) (AC-T21-5) an upload that collides with an existing object (ok from the store) still signs and returns cached false', async () => {
    const s = setup({ store: { upload: () => Promise.resolve(ok(null)) } });
    const res = await s.post(JSON.stringify({ text: 'Hello world' }));
    expect(res.status).toBe(200);
    expect(TtsResponseSchema.parse(await res.json()).cached).toBe(false);
    expect(StoragePathSchema.safeParse(HELLO_AVA).success).toBe(true);
  });
});

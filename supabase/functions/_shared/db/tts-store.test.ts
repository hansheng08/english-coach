import { StoragePathSchema, UserIdSchema } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DbResponse, TtsDbClient, TtsStorageBucket } from './client.ts';
import { ttsStoreFrom } from './tts-store.ts';

const USER = UserIdSchema.parse('00000000-0000-4000-8000-0000000000aa');
const FILE = `${'b'.repeat(64)}.mp3`;
const PATH = StoragePathSchema.parse(`${USER}/${FILE}`);

type Fake = {
  readonly profile?: DbResponse<Readonly<Record<string, unknown>> | null>;
  readonly list?: Awaited<ReturnType<TtsStorageBucket['list']>>;
  readonly upload?: Awaited<ReturnType<TtsStorageBucket['upload']>>;
  readonly sign?: Awaited<ReturnType<TtsStorageBucket['createSignedUrl']>>;
};

function fakeClient(fake: Fake = {}) {
  const insert = vi.fn<(row: Readonly<Record<string, unknown>>) => PromiseLike<DbResponse<unknown>>>(() =>
    Promise.resolve<DbResponse<unknown>>({ data: null, error: null }),
  );
  const list = vi.fn<TtsStorageBucket['list']>(() => Promise.resolve(fake.list ?? { data: [], error: null }));
  const upload = vi.fn<TtsStorageBucket['upload']>(() => Promise.resolve(fake.upload ?? { error: null }));
  const createSignedUrl = vi.fn<TtsStorageBucket['createSignedUrl']>(() =>
    Promise.resolve(fake.sign ?? { data: { signedUrl: 'https://example.supabase.co/storage/v1/object/sign/tts/x?token=t' }, error: null }),
  );
  const buckets: string[] = [];
  const client: TtsDbClient = {
    from: () => ({
      insert,
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(fake.profile ?? { data: null, error: null }) }) }),
    }),
    storage: {
      from: (bucket) => {
        buckets.push(bucket);
        return { list, upload, createSignedUrl };
      },
    },
  };
  return { client, insert, list, upload, createSignedUrl, buckets };
}

const profile = (settings: unknown): Fake => ({ profile: { data: { settings }, error: null } });

describe('ttsStoreFrom.readVoice (AC-T21-4)', () => {
  it('(AC-T21-4) (TC-5) no profile row or no tts settings gives the default voice', async () => {
    expect(expectOk(await ttsStoreFrom(fakeClient().client, USER).readVoice())).toBe('azure:en-US-AvaNeural');
    expect(expectOk(await ttsStoreFrom(fakeClient(profile({})).client, USER).readVoice())).toBe('azure:en-US-AvaNeural');
  });

  it('(AC-T21-4) (TC-5) a custom voice is used, an invalid tts group is internal, and a read error is db_failed', async () => {
    const custom = fakeClient(profile({ tts: { voice: 'azure:en-US-AndrewNeural' } }));
    expect(expectOk(await ttsStoreFrom(custom.client, USER).readVoice())).toBe('azure:en-US-AndrewNeural');
    const bad = fakeClient(profile({ tts: { voice: 1 } }));
    expect(expectErr(await ttsStoreFrom(bad.client, USER).readVoice()).kind).toBe('internal');
    const down = fakeClient({ profile: { data: null, error: { code: '500', message: 'boom' } } });
    expect(expectErr(await ttsStoreFrom(down.client, USER).readVoice()).kind).toBe('db_failed');
  });
});

describe('ttsStoreFrom storage (AC-T21-5, AC-T21-6)', () => {
  it('(AC-T21-5) (TC-8) find lists the own folder with the file name, and only an exact name counts', async () => {
    const hit = fakeClient({ list: { data: [{ name: FILE, metadata: { size: 30000 } }], error: null } });
    expect(expectOk(await ttsStoreFrom(hit.client, USER).find(PATH))).toEqual({ bytes: 30000 });
    expect(hit.list).toHaveBeenCalledWith(USER, { search: FILE, limit: 1 });
    expect(hit.buckets).toEqual(['tts']);
    const near = fakeClient({ list: { data: [{ name: `x${FILE}`, metadata: { size: 1 } }], error: null } });
    expect(expectOk(await ttsStoreFrom(near.client, USER).find(PATH))).toBeNull();
  });

  it('(AC-T21-6) (TC-8) a storage error is storage_failed with the op and no path in the message', async () => {
    const find = fakeClient({ list: { data: null, error: { message: `boom ${PATH}` } } });
    const e = expectErr(await ttsStoreFrom(find.client, USER).find(PATH));
    expect(e).toMatchObject({ kind: 'storage_failed', op: 'download' });
    expect(e.message).not.toContain(FILE);
    const up = fakeClient({ upload: { error: { message: 'nope' } } });
    expect(expectErr(await ttsStoreFrom(up.client, USER).upload(PATH, new Uint8Array([1]), 'audio/mpeg'))).toMatchObject({ kind: 'storage_failed', op: 'upload' });
    const sign = fakeClient({ sign: { data: null, error: { message: 'nope' } } });
    expect(expectErr(await ttsStoreFrom(sign.client, USER).signedUrl(PATH))).toMatchObject({ kind: 'storage_failed', op: 'sign' });
  });

  it('(AC-T21-5) (TC-8) upload uses upsert false, and "already exists" counts as success', async () => {
    const fresh = fakeClient();
    expectOk(await ttsStoreFrom(fresh.client, USER).upload(PATH, new Uint8Array([1, 2]), 'audio/mpeg'));
    expect(fresh.upload).toHaveBeenCalledWith(PATH, new Uint8Array([1, 2]), { contentType: 'audio/mpeg', upsert: false });
    const dup = fakeClient({ upload: { error: { message: 'The resource already exists', statusCode: '409' } } });
    expectOk(await ttsStoreFrom(dup.client, USER).upload(PATH, new Uint8Array([1]), 'audio/mpeg'));
  });

  it('(AC-T21-7) (TC-8) signedUrl asks for 3600 seconds', async () => {
    const c = fakeClient();
    expect(expectOk(await ttsStoreFrom(c.client, USER).signedUrl(PATH))).toContain('/sign/tts/');
    expect(c.createSignedUrl).toHaveBeenCalledWith(PATH, 3600);
  });
});

describe('ttsStoreFrom.recordCall (AC-T21-15)', () => {
  it('(AC-T21-15) (TC-21) forwards to insertProviderCall without any text or path', async () => {
    const c = fakeClient();
    expectOk(
      await ttsStoreFrom(c.client, USER).recordCall({ capability: 'tts', provider: 'azure-speech', model: null, tier: 'free', errorKind: null, latencyMs: 120 }),
    );
    expect(c.insert).toHaveBeenCalledTimes(1);
    const row = c.insert.mock.calls[0]?.[0];
    expect(row).toMatchObject({ user_id: USER, capability: 'tts', provider: 'azure-speech', tier: 'free', status: 'ok', latency_ms: 120 });
    expect(JSON.stringify(row)).not.toContain(FILE);
  });
});

import { StoragePathSchema, UserIdSchema } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DbResponse, StorageError, TtsDbClient, TtsStorageBucket } from './client.ts';
import { TTS_SIGNED_URL_SECONDS, ttsStoreFrom } from './tts-store.ts';

// QA probes for T-021 TtsStore (AC-T21-4, AC-T21-5, AC-T21-6). Fake Storage client; low-entropy ids.
const USER = UserIdSchema.parse('00000000-0000-4000-8000-000000000021');
const NAME = `${'c'.repeat(64)}.mp3`;
const PATH = StoragePathSchema.parse(`${USER}/${NAME}`);

type Fake = {
  readonly profile?: DbResponse<Readonly<Record<string, unknown>> | null>;
  readonly list?: Awaited<ReturnType<TtsStorageBucket['list']>>;
  readonly upload?: Awaited<ReturnType<TtsStorageBucket['upload']>>;
  readonly sign?: Awaited<ReturnType<TtsStorageBucket['createSignedUrl']>>;
  readonly throwOn?: 'list' | 'upload' | 'sign';
};

function fake(f: Fake = {}) {
  const boom = () => Promise.reject(new Error(`boom ${PATH}`));
  const list = vi.fn<TtsStorageBucket['list']>(() => (f.throwOn === 'list' ? boom() : Promise.resolve(f.list ?? { data: [], error: null })));
  const upload = vi.fn<TtsStorageBucket['upload']>(() => (f.throwOn === 'upload' ? boom() : Promise.resolve(f.upload ?? { error: null })));
  const createSignedUrl = vi.fn<TtsStorageBucket['createSignedUrl']>(() =>
    f.throwOn === 'sign' ? boom() : Promise.resolve(f.sign ?? { data: { signedUrl: 'https://qa.example/s?token=t' }, error: null }),
  );
  const buckets: string[] = [];
  const client: TtsDbClient = {
    from: () => ({
      insert: () => Promise.resolve<DbResponse<unknown>>({ data: null, error: null }),
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(f.profile ?? { data: null, error: null }) }) }),
    }),
    storage: {
      from: (b) => {
        buckets.push(b);
        return { list, upload, createSignedUrl };
      },
    },
  };
  return { store: ttsStoreFrom(client, USER), list, upload, createSignedUrl, buckets };
}

const fileEntry = (name: string, size: unknown) => ({ name, metadata: { size } });
const se = (message: string, statusCode?: string): StorageError => ({ message, statusCode });

describe('T-021 QA TtsStore', () => {
  it('(QA-27) (AC-T21-5) find lists the user folder with search=<file name>, limit 1, in the tts bucket; only an exact name is a hit', async () => {
    const hit = fake({ list: { data: [fileEntry(NAME, 4800)], error: null } });
    expect(expectOk(await hit.store.find(PATH))).toEqual({ bytes: 4800 });
    expect(hit.list).toHaveBeenCalledWith(USER, { search: NAME, limit: 1 });
    expect(hit.buckets).toEqual(['tts']);
    const prefix = fake({ list: { data: [fileEntry(`${NAME}.old`, 10)], error: null } });
    expect(expectOk(await prefix.store.find(PATH))).toBeNull();
    const none = fake({ list: { data: null, error: null } });
    expect(expectOk(await none.store.find(PATH))).toBeNull();
  });

  it('(QA-28) (AC-T21-6) find errors (error object, thrown, missing size) are storage_failed op download without the path', async () => {
    for (const f of [
      fake({ list: { data: null, error: se('denied') } }),
      fake({ throwOn: 'list' }),
      fake({ list: { data: [fileEntry(NAME, '4800')], error: null } }),
    ]) {
      const e = expectErr(await f.store.find(PATH));
      expect(e).toMatchObject({ kind: 'storage_failed', op: 'download' });
      expect(JSON.stringify(e)).not.toContain(USER);
    }
  });

  it('(QA-29) (AC-T21-5) upload uses upsert false with the mime as contentType; 409 or "already exists" counts as success', async () => {
    const f = fake();
    expect(expectOk(await f.store.upload(PATH, new Uint8Array([1]), 'audio/mpeg'))).toBeNull();
    expect(f.upload).toHaveBeenCalledWith(PATH, new Uint8Array([1]), { contentType: 'audio/mpeg', upsert: false });
    for (const e of [se('whatever', '409'), se('The resource already exists'), se('Duplicate key')]) {
      expect((await fake({ upload: { error: e } }).store.upload(PATH, new Uint8Array([1]), 'audio/mpeg')).ok).toBe(true);
    }
  });

  it('(QA-30) (AC-T21-6) other upload errors and throws are storage_failed op upload without the path', async () => {
    for (const f of [fake({ upload: { error: se('payload too large', '413') } }), fake({ throwOn: 'upload' })]) {
      const e = expectErr(await f.store.upload(PATH, new Uint8Array([1]), 'audio/mpeg'));
      expect(e).toMatchObject({ kind: 'storage_failed', op: 'upload' });
      expect(JSON.stringify(e)).not.toContain(NAME);
    }
  });

  it('(QA-31) (AC-T21-6) signedUrl asks for 3600 seconds; an error, a throw or no URL is storage_failed op sign', async () => {
    const f = fake();
    expect(expectOk(await f.store.signedUrl(PATH))).toBe('https://qa.example/s?token=t');
    expect(f.createSignedUrl).toHaveBeenCalledWith(PATH, 3600);
    expect(TTS_SIGNED_URL_SECONDS).toBe(3600);
    for (const g of [fake({ sign: { data: null, error: se('nope') } }), fake({ sign: { data: null, error: null } }), fake({ throwOn: 'sign' })]) {
      const e = expectErr(await g.store.signedUrl(PATH));
      expect(e).toMatchObject({ kind: 'storage_failed', op: 'sign' });
      expect(JSON.stringify(e)).not.toContain(USER);
    }
  });

  it('(QA-32) (AC-T21-4) settings null, settings without tts, and tts {} give the default voice; tts null is internal', async () => {
    for (const settings of [null, { other: 1 }, { tts: {} }]) {
      const f = fake({ profile: { data: { settings }, error: null } });
      expect(expectOk(await f.store.readVoice())).toBe('azure:en-US-AvaNeural');
    }
    const bad = fake({ profile: { data: { settings: { tts: null } }, error: null } });
    expect(expectErr(await bad.store.readVoice()).kind).toBe('internal');
    const badVoice = fake({ profile: { data: { settings: { tts: { voice: 'azure:xx-XX-Nope' } } }, error: null } });
    expect(expectErr(await badVoice.store.readVoice()).kind).toBe('internal');
  });
});

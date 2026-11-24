import { UserIdSchema } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import type { DbClient, DbResponse } from './client.ts';
import { PROVIDER_CALL_COLUMNS, type ProviderCallRecord } from './provider-call.ts';
import { userDbFrom } from './user-db.ts';

const USER = UserIdSchema.parse('3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c');
const CONTENT = 'my secret answer text';

function fakeClient(respond: () => PromiseLike<DbResponse<unknown>>): {
  client: DbClient;
  calls: { table: string; row: Readonly<Record<string, unknown>> }[];
} {
  const calls: { table: string; row: Readonly<Record<string, unknown>> }[] = [];
  const client: DbClient = {
    from: (table) => ({
      insert: (row) => {
        calls.push({ table, row });
        return respond();
      },
    }),
  };
  return { client, calls };
}

const failedRecord: ProviderCallRecord = {
  capability: 'stt',
  provider: 'groq',
  model: null,
  tier: 'free',
  errorKind: 'rate_limited',
  latencyMs: 849.6,
};

describe('insertProviderCall (_shared/db)', () => {
  it('(AC-T7-1) writes exactly the provider_call metadata columns for the AuthContext user; extra fields are dropped', async () => {
    const withContent = { ...failedRecord, prompt: CONTENT, transcript: CONTENT };
    const { client, calls } = fakeClient(() => Promise.resolve({ data: null, error: null }));
    expect(expectOk(await userDbFrom(client, USER).insertProviderCall(withContent))).toBeNull();
    expect(calls).toEqual([
      {
        table: 'provider_call',
        row: {
          user_id: USER,
          capability: 'stt',
          provider: 'groq',
          model: null,
          tier: 'free',
          status: 'error',
          error_kind: 'rate_limited',
          latency_ms: 850,
        },
      },
    ]);
    expect(Object.keys(calls[0]?.row ?? {}).sort()).toEqual([...PROVIDER_CALL_COLUMNS].sort());
  });

  it('(AC-T7-1) a successful call is stored as status ok with no error_kind', async () => {
    const { client, calls } = fakeClient(() => Promise.resolve({ data: null, error: null }));
    const ok: ProviderCallRecord = { ...failedRecord, errorKind: null, model: 'whisper-large-v3' };
    expectOk(await userDbFrom(client, USER).insertProviderCall(ok));
    expect(calls[0]?.row).toMatchObject({ status: 'ok', error_kind: null, model: 'whisper-large-v3' });
  });

  it('(AC-T7-2) a PostgREST error becomes db_failed with only the operation and code, never the DB message', async () => {
    const { client } = fakeClient(() =>
      Promise.resolve({ data: null, error: { code: '42501', message: `row contains ${CONTENT}` } }),
    );
    const e = expectErr(await userDbFrom(client, USER).insertProviderCall(failedRecord));
    expect(e).toEqual({ kind: 'db_failed', message: 'insert provider_call failed (42501)' });
  });

  it('(AC-T7-2) a thrown network error becomes db_failed instead of escaping', async () => {
    const { client } = fakeClient(() => Promise.reject(new Error(`fetch failed ${CONTENT}`)));
    const e = expectErr(await userDbFrom(client, USER).insertProviderCall(failedRecord));
    expect(e).toEqual({ kind: 'db_failed', message: 'insert provider_call failed' });
  });
});

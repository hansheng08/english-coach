import { describe, expect, it } from 'vitest';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { createSupabaseClient } from './index.ts';
import type { SupabaseAuthLike } from './index.ts';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'me@example.com' };

type Calls = { readonly names: string[] };

function fake(
  signIn: SupabaseAuthLike['auth']['signInWithPassword'],
  session: { user: typeof USER } | null = null,
): { sb: SupabaseAuthLike; calls: Calls } {
  const calls: Calls = { names: [] };
  const sb: SupabaseAuthLike = {
    auth: {
      getSession: () => {
        calls.names.push('getSession');
        return Promise.resolve({ data: { session }, error: null });
      },
      signInWithPassword: (c) => {
        calls.names.push('signInWithPassword');
        return signIn(c);
      },
      signOut: () => {
        calls.names.push('signOut');
        return Promise.resolve({ error: null });
      },
    },
  };
  return { sb, calls };
}

describe('supabase ApiClient', () => {
  it('(AC-T18-5) (TC-8) wrong password → unauthenticated', async () => {
    const { sb } = fake(() => Promise.resolve({ data: { session: null }, error: { status: 400, code: 'invalid_credentials' } }));
    const e = expectErr(await createSupabaseClient(sb).signInWithPassword('a@example.com', 'bad'));
    expect(e.kind).toBe('unauthenticated');
  });

  it('(AC-T18-5) (TC-8) network failure (error or thrown) → internal', async () => {
    const down = fake(() => Promise.resolve({ data: { session: null }, error: { status: 0 } }));
    expect(expectErr(await createSupabaseClient(down.sb).signInWithPassword('a@example.com', 'x')).kind).toBe('internal');
    const thrown = fake(() => Promise.reject(new Error('offline')));
    expect(expectErr(await createSupabaseClient(thrown.sb).signInWithPassword('a@example.com', 'x')).kind).toBe('internal');
  });

  it('(AC-T18-5) (TC-8) success → ok with userId and email; sign-up is never called', async () => {
    const { sb, calls } = fake(() => Promise.resolve({ data: { session: { user: USER } }, error: null }), { user: USER });
    const client = createSupabaseClient(sb);
    const s = expectOk(await client.signInWithPassword('me@example.com', 'right'));
    expect(s).toEqual({ userId: USER.id, email: 'me@example.com' });
    expect(expectOk(await client.getSession())).toEqual(s);
    expectOk(await client.signOut());
    expect(calls.names).toEqual(['signInWithPassword', 'getSession', 'signOut']);
    expect(Object.keys(sb.auth).some((k) => /sign.?up/i.test(k))).toBe(false);
  });

  it('(AC-T18-5) (TC-8) no session → ok(null)', async () => {
    const { sb } = fake(() => Promise.resolve({ data: { session: null }, error: null }));
    expect(expectOk(await createSupabaseClient(sb).getSession())).toBeNull();
  });
});

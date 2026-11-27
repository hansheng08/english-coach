import { describe, expect, it, vi } from 'vitest';
import { createSupabaseApiClient } from './index';
import type { AuthLike } from './index';

// QA probes for T-018 AC-T18-5 (docs/tasks/T-018.md 「介面」：帳密錯 → unauthenticated，其他 → internal).
const USER_ID = '00000000-0000-4000-8000-000000000001';
type SignInResult = Awaited<ReturnType<AuthLike['signInWithPassword']>>;

function auth(signIn: () => Promise<SignInResult>, extra: Partial<AuthLike> = {}): AuthLike {
  return {
    getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(signIn),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    ...extra,
  };
}
const fail =
  (error: { message: string; status?: number; code?: string }) => (): Promise<SignInResult> =>
    Promise.resolve({ data: { session: null }, error });

describe('T-018 QA supabase error mapping', () => {
  it('(QA-1) bad credentials are recognised by code alone or by status 400 plus the message', async () => {
    const cases = [
      { message: 'whatever', code: 'invalid_credentials' },
      { message: 'Invalid login credentials', status: 400 },
      { message: 'INVALID LOGIN CREDENTIALS', status: 400 },
    ];
    for (const e of cases) {
      const r = await createSupabaseApiClient(auth(fail(e))).signInWithPassword('a@example.com', 'x');
      expect(!r.ok && r.error.kind).toBe('unauthenticated');
    }
  });

  it('(QA-2) every other failure is internal (rate limit, server error, 400 with another message, missing session)', async () => {
    const others: (() => Promise<SignInResult>)[] = [
      fail({ message: 'Request rate limit reached', status: 429, code: 'over_request_rate_limit' }),
      fail({ message: 'Internal error', status: 500 }),
      fail({ message: 'Email not confirmed', status: 400, code: 'email_not_confirmed' }),
      fail({ message: 'Invalid login credentials', status: 401 }),
      () => Promise.resolve({ data: { session: null }, error: null }),
      () => Promise.resolve({ data: { session: { user: { id: 'nope' } } }, error: null }),
    ];
    for (const f of others) {
      const r = await createSupabaseApiClient(auth(f)).signInWithPassword('a@example.com', 'x');
      expect(!r.ok && r.error.kind).toBe('internal');
    }
  });

  it('(QA-3) getSession and signOut failures (error object or thrown) are internal, never thrown', async () => {
    const thrown = auth(fail({ message: 'x' }), {
      getSession: vi.fn(() => Promise.reject(new Error('offline'))),
      signOut: vi.fn(() => Promise.reject(new Error('offline'))),
    });
    const errored = auth(fail({ message: 'x' }), {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: { message: 'bad jwt', status: 403 } })),
    });
    for (const a of [thrown, errored]) {
      const s = await createSupabaseApiClient(a).getSession();
      expect(!s.ok && s.error.kind).toBe('internal');
    }
    const o = await createSupabaseApiClient(thrown).signOut();
    expect(!o.ok && o.error.kind).toBe('internal');
  });

  it('(QA-4) success keeps the user id and email; error results do not echo the password', async () => {
    const good = await createSupabaseApiClient(
      auth(() => Promise.resolve({ data: { session: { user: { id: USER_ID, email: 'b@example.com' } } }, error: null })),
    ).signInWithPassword('b@example.com', 'pw-probe');
    expect(good).toEqual({ ok: true, value: { userId: USER_ID, email: 'b@example.com' } });
    const bad = await createSupabaseApiClient(auth(fail({ message: 'x', status: 500 }))).signInWithPassword('b@example.com', 'pw-probe');
    expect(JSON.stringify(bad)).not.toContain('pw-probe');
  });
});

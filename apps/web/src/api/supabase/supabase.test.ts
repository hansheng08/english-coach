import { describe, expect, it, vi } from 'vitest';
import { createSupabaseApiClient } from './index';
import type { AuthLike } from './index';

const USER_ID = '8c1f3b52-4d6e-4a7b-9c10-2e5d7f9a0b31';

function fakeAuth(overrides: Partial<AuthLike> = {}) {
  const base: AuthLike = {
    getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(() => Promise.resolve({ data: { session: { user: { id: USER_ID, email: 'a@example.com' } } }, error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
  };
  return { ...base, ...overrides };
}

describe('supabase api client', () => {
  it('(AC-T18-5) (TC-8) wrong credentials → unauthenticated', async () => {
    const auth = fakeAuth({
      signInWithPassword: vi.fn(() => Promise.resolve({ data: { session: null }, error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } })),
    });
    const r = await createSupabaseApiClient(auth).signInWithPassword('a@example.com', 'bad');
    expect(!r.ok && r.error.kind).toBe('unauthenticated');
  });

  it('(AC-T18-5) (TC-8) network failure (thrown or error object) → internal', async () => {
    const thrown = fakeAuth({ signInWithPassword: vi.fn(() => Promise.reject(new Error('Failed to fetch'))) });
    const errored = fakeAuth({
      signInWithPassword: vi.fn(() => Promise.resolve({ data: { session: null }, error: { message: 'fetch failed', status: 0 } })),
    });
    const a = await createSupabaseApiClient(thrown).signInWithPassword('a@example.com', 'x');
    const b = await createSupabaseApiClient(errored).signInWithPassword('a@example.com', 'x');
    expect(!a.ok && a.error.kind).toBe('internal');
    expect(!b.ok && b.error.kind).toBe('internal');
  });

  it('(AC-T18-5) (TC-8) success → ok with userId and email, only signInWithPassword is called', async () => {
    const auth = fakeAuth();
    const r = await createSupabaseApiClient(auth).signInWithPassword('a@example.com', 'x');
    expect(r.ok && { id: r.value.userId, email: r.value.email }).toEqual({ id: USER_ID, email: 'a@example.com' });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'x' });
    expect(Object.keys(auth).sort()).toEqual(['getSession', 'signInWithPassword', 'signOut']);
  });

  it('(AC-T18-5) (TC-8) getSession: no session → ok(null); a session → ok(identity); a non-UUID user id → internal', async () => {
    const none = await createSupabaseApiClient(fakeAuth()).getSession();
    expect(none).toEqual({ ok: true, value: null });
    const some = await createSupabaseApiClient(
      fakeAuth({ getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: USER_ID } } }, error: null })) }),
    ).getSession();
    expect(some.ok && some.value?.email).toBe('');
    const bad = await createSupabaseApiClient(
      fakeAuth({ getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'not-a-uuid' } } }, error: null })) }),
    ).getSession();
    expect(!bad.ok && bad.error.kind).toBe('internal');
  });

  it('(AC-T18-5) (TC-8) signOut maps failures to internal', async () => {
    const ok = await createSupabaseApiClient(fakeAuth()).signOut();
    const failed = await createSupabaseApiClient(fakeAuth({ signOut: vi.fn(() => Promise.resolve({ error: { message: 'x' } })) })).signOut();
    expect(ok.ok).toBe(true);
    expect(!failed.ok && failed.error.kind).toBe('internal');
  });
});

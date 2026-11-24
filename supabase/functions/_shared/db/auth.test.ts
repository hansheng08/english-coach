import { err, ok, type AppError } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { requireUser, type TokenClaims, type VerifyToken } from './auth.ts';

const UUID = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';

function fakeVerifier(result: ReturnType<VerifyToken> extends Promise<infer R> ? R : never): {
  verifyToken: VerifyToken;
  calls: () => number;
  tokens: () => readonly string[];
} {
  const seen: string[] = [];
  return {
    verifyToken: (token) => {
      seen.push(token);
      return Promise.resolve(result);
    },
    calls: () => seen.length,
    tokens: () => seen,
  };
}

const withAuth = (value: string | undefined): Request =>
  new Request('http://localhost/x', value === undefined ? {} : { headers: { Authorization: value } });

const validClaims: TokenClaims = { role: 'authenticated', sub: UUID, is_anonymous: false };

describe('requireUser', () => {
  const badHeaders: readonly (readonly [string, string | undefined])[] = [
    ['no Authorization header', undefined],
    ['Basic scheme', 'Basic abc'],
    ['Bearer without a token', 'Bearer'],
    ['Bearer with two segments', 'Bearer a b'],
  ];
  for (const [label, header] of badHeaders) {
    it(`(AC-T3-4) ${label} → unauthenticated without calling verifyToken`, async () => {
      const v = fakeVerifier(ok(validClaims));
      const e = expectErr(await requireUser(withAuth(header), v));
      expect(e).toEqual({ kind: 'unauthenticated', message: 'missing or invalid jwt' });
      expect(v.calls()).toBe(0);
    });
  }

  it('(AC-T3-4) verifyToken err → unauthenticated', async () => {
    const inner: AppError = { kind: 'internal', message: 'boom with secret-detail' };
    const v = fakeVerifier(err(inner));
    const e = expectErr(await requireUser(withAuth('Bearer a.b.c'), v));
    expect(e).toEqual({ kind: 'unauthenticated', message: 'missing or invalid jwt' });
  });

  const badClaims: readonly (readonly [string, TokenClaims])[] = [
    ['role anon', { role: 'anon', sub: UUID, is_anonymous: false }],
    ['no role', { sub: UUID, is_anonymous: false }],
    ['is_anonymous true', { role: 'authenticated', sub: UUID, is_anonymous: true }],
    ['sub not a uuid', { role: 'authenticated', sub: 'not-a-uuid', is_anonymous: false }],
    ['no sub', { role: 'authenticated', is_anonymous: false }],
  ];
  for (const [label, claims] of badClaims) {
    it(`(AC-T3-4) claims with ${label} → unauthenticated`, async () => {
      const v = fakeVerifier(ok(claims));
      const e = expectErr(await requireUser(withAuth('Bearer a.b.c'), v));
      expect(e).toEqual({ kind: 'unauthenticated', message: 'missing or invalid jwt' });
      expect(v.calls()).toBe(1);
    });
  }

  it('(AC-T3-4) valid claims → ok with userId and accessToken', async () => {
    const v = fakeVerifier(ok(validClaims));
    const ctx = expectOk(await requireUser(withAuth('Bearer a.b.c'), v));
    expect(ctx.userId).toBe(UUID);
    expect(ctx.accessToken).toBe('a.b.c');
    expect(v.tokens()).toEqual(['a.b.c']);
  });

  it('(AC-T3-4) lowercase "bearer" is accepted', async () => {
    const v = fakeVerifier(ok(validClaims));
    const ctx = expectOk(await requireUser(withAuth('bearer a.b.c'), v));
    expect(ctx.accessToken).toBe('a.b.c');
  });
});

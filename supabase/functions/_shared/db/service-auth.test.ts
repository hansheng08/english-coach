import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { requireServiceKey } from './auth.ts';

const env = { url: 'http://fake.local', secretKey: 'k1' };
const withHeaders = (headers: Record<string, string>): Request => new Request('http://localhost/x', { headers });

describe('requireServiceKey (T-046)', () => {
  it('(AC-T46-2) (TC-4) accepts the matching apikey header', () => {
    expectOk(requireServiceKey(withHeaders({ apikey: 'k1' }), env));
  });

  it('(AC-T46-2) (TC-5) rejects missing, different, longer and Authorization-only keys without echoing any key', () => {
    const bad: readonly Record<string, string>[] = [{}, { apikey: 'k2' }, { apikey: 'k1x' }, { Authorization: 'Bearer k1' }];
    for (const headers of bad) {
      const e = expectErr(requireServiceKey(withHeaders(headers), env));
      expect(e.kind).toBe('unauthenticated');
      expect(e.message).not.toContain('k1');
      expect(e.message).not.toContain('k2');
    }
  });
});

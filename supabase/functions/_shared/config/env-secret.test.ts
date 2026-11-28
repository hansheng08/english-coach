import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { loadSupabaseSecretEnv, type EnvGetter } from './env.ts';

const getter =
  (vars: Readonly<Record<string, string>>): EnvGetter =>
  (name) =>
    vars[name];

describe('loadSupabaseSecretEnv (T-046)', () => {
  it('(AC-T46-1) (TC-1) reads the default key of SUPABASE_SECRET_KEYS', () => {
    const r = loadSupabaseSecretEnv(
      getter({ SUPABASE_URL: 'http://fake.local', SUPABASE_SECRET_KEYS: '{"default":"k1"}' }),
    );
    expect(expectOk(r)).toEqual({ url: 'http://fake.local', secretKey: 'k1' });
  });

  it('(AC-T46-1) (TC-2) falls back to SUPABASE_SECRET_KEY when the JSON is broken, has no default or is unset', () => {
    for (const keys of ['{broken', '{"other":"x"}', undefined]) {
      const vars: Record<string, string> = { SUPABASE_URL: 'http://fake.local', SUPABASE_SECRET_KEY: 'k2' };
      if (keys !== undefined) vars['SUPABASE_SECRET_KEYS'] = keys;
      expect(expectOk(loadSupabaseSecretEnv(getter(vars))).secretKey).toBe('k2');
    }
  });

  it('(AC-T46-1) (TC-3) missing URL or both key names is internal and the message holds no provided value', () => {
    const cases: readonly Record<string, string>[] = [
      { SUPABASE_SECRET_KEYS: '{"default":"k1"}' },
      { SUPABASE_URL: 'http://fake.local' },
      { SUPABASE_URL: 'http://fake.local', SUPABASE_SECRET_KEYS: '', SUPABASE_SECRET_KEY: '' },
      { SUPABASE_URL: 'http://fake.local', SUPABASE_SECRET_KEYS: '{"x":"k1"}' },
    ];
    for (const vars of cases) {
      const e = expectErr(loadSupabaseSecretEnv(getter(vars)));
      expect(e.kind).toBe('internal');
      expect(e.message).not.toContain('k1');
      expect(e.message).not.toContain('fake.local');
    }
  });
});

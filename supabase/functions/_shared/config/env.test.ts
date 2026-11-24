import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it } from 'vitest';
import { formatAdr010EnvLine, keyPresence, loadAllowedOrigins, loadSupabaseEnv, type EnvGetter } from './env.ts';

const FAKE_VALUES = ['publishable-test', 'publishable-key-test', 'secret-keys-test', 'secret-key-test', 'anon-test'];

const URL_VALUE = 'http://localhost:54321';
const KEYS_JSON = '{"default":"publishable-test"}';

const getterOf =
  (values: Readonly<Record<string, string>>): EnvGetter =>
  (name) =>
    values[name];

describe('loadSupabaseEnv', () => {
  it('(AC-T3-3) reads the default key from SUPABASE_PUBLISHABLE_KEYS', () => {
    const env = expectOk(loadSupabaseEnv(getterOf({ SUPABASE_URL: URL_VALUE, SUPABASE_PUBLISHABLE_KEYS: KEYS_JSON })));
    expect(env).toEqual({ url: URL_VALUE, publishableKey: 'publishable-test' });
  });

  const fallbackCases: readonly (readonly [string, string])[] = [
    ['JSON without default', '{"other":"x"}'],
    ['empty default', '{"default":""}'],
    ['not JSON', 'not-json'],
  ];
  for (const [label, keys] of fallbackCases) {
    it(`(AC-T3-3) falls back to SUPABASE_PUBLISHABLE_KEY when the JSON is ${label}`, () => {
      const env = expectOk(
        loadSupabaseEnv(
          getterOf({
            SUPABASE_URL: URL_VALUE,
            SUPABASE_PUBLISHABLE_KEYS: keys,
            SUPABASE_PUBLISHABLE_KEY: 'publishable-key-test',
          }),
        ),
      );
      expect(env.publishableKey).toBe('publishable-key-test');
    });
  }

  it('(AC-T3-3) returns internal when neither publishable name works', () => {
    const e = expectErr(loadSupabaseEnv(getterOf({ SUPABASE_URL: URL_VALUE, SUPABASE_PUBLISHABLE_KEYS: '{"other":"x"}' })));
    expect(e.kind).toBe('internal');
    expect(e.message).toBe('missing env SUPABASE_PUBLISHABLE_KEYS (default) or SUPABASE_PUBLISHABLE_KEY');
  });

  for (const [label, values] of [
    ['missing', {}],
    ['empty', { SUPABASE_URL: '' }],
  ] as const) {
    it(`(AC-T3-3) returns internal "missing env SUPABASE_URL" when SUPABASE_URL is ${label}`, () => {
      const e = expectErr(
        loadSupabaseEnv(
          getterOf({ ...values, SUPABASE_PUBLISHABLE_KEYS: KEYS_JSON, SUPABASE_PUBLISHABLE_KEY: 'publishable-key-test' }),
        ),
      );
      expect(e).toEqual({ kind: 'internal', message: 'missing env SUPABASE_URL' });
    });
  }

  it('(AC-T3-3) error results never contain any of the supplied fake values', () => {
    const all = getterOf({
      SUPABASE_PUBLISHABLE_KEYS: KEYS_JSON,
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key-test',
      SUPABASE_SECRET_KEYS: 'secret-keys-test',
      SUPABASE_SECRET_KEY: 'secret-key-test',
      SUPABASE_ANON_KEY: 'anon-test',
    });
    const noUrl = JSON.stringify(expectErr(loadSupabaseEnv(all)));
    const noKey = JSON.stringify(
      expectErr(loadSupabaseEnv(getterOf({ SUPABASE_URL: URL_VALUE, SUPABASE_PUBLISHABLE_KEYS: 'secret-keys-test' }))),
    );
    for (const text of [noUrl, noKey]) {
      for (const fake of FAKE_VALUES) expect(text.includes(fake)).toBe(false);
      expect(text.includes(URL_VALUE)).toBe(false);
    }
  });

  it('(AC-T3-3) never reads SUPABASE_SECRET_KEYS', () => {
    const reads: string[] = [];
    const spy: EnvGetter = (name) => {
      reads.push(name);
      return undefined;
    };
    loadSupabaseEnv(spy);
    loadSupabaseEnv((name) => {
      reads.push(name);
      return name === 'SUPABASE_URL' ? URL_VALUE : name === 'SUPABASE_PUBLISHABLE_KEY' ? 'publishable-key-test' : undefined;
    });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((n) => n.startsWith('SUPABASE_SECRET') || n === 'SUPABASE_SERVICE_ROLE_KEY')).toEqual([]);
  });
});

describe('keyPresence and formatAdr010EnvLine', () => {
  const line = (values: Readonly<Record<string, string>>): string => formatAdr010EnvLine(keyPresence(getterOf(values)));

  it('(AC-T3-3) only the JSON names', () => {
    expect(line({ SUPABASE_URL: URL_VALUE, SUPABASE_PUBLISHABLE_KEYS: KEYS_JSON, SUPABASE_SECRET_KEYS: 'secret-keys-test' })).toBe(
      'adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false',
    );
  });
  it('(AC-T3-3) only the singular names', () => {
    expect(
      line({ SUPABASE_URL: URL_VALUE, SUPABASE_PUBLISHABLE_KEY: 'publishable-key-test', SUPABASE_SECRET_KEY: 'secret-key-test' }),
    ).toBe('adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false');
  });
  it('(AC-T3-3) both kinds of names', () => {
    expect(
      line({
        SUPABASE_URL: URL_VALUE,
        SUPABASE_PUBLISHABLE_KEYS: KEYS_JSON,
        SUPABASE_PUBLISHABLE_KEY: 'publishable-key-test',
        SUPABASE_SECRET_KEYS: 'secret-keys-test',
        SUPABASE_SECRET_KEY: 'secret-key-test',
      }),
    ).toBe('adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false');
  });
  it('(AC-T3-3) all empty strings', () => {
    expect(
      line({
        SUPABASE_URL: '',
        SUPABASE_PUBLISHABLE_KEYS: '',
        SUPABASE_PUBLISHABLE_KEY: '',
        SUPABASE_SECRET_KEYS: '',
        SUPABASE_SECRET_KEY: '',
        SUPABASE_ANON_KEY: '',
      }),
    ).toBe('adr010-env has_supabase_url=false has_publishable=false has_secret=false only_legacy_keys=false');
  });
  it('(AC-T3-3) only SUPABASE_ANON_KEY means only_legacy_keys=true', () => {
    expect(line({ SUPABASE_URL: URL_VALUE, SUPABASE_ANON_KEY: 'anon-test' })).toBe(
      'adr010-env has_supabase_url=true has_publishable=false has_secret=false only_legacy_keys=true',
    );
  });
  it('(AC-T3-3) everything present gives exactly the expected line and leaks no value', () => {
    const text = line({
      SUPABASE_URL: URL_VALUE,
      SUPABASE_PUBLISHABLE_KEYS: KEYS_JSON,
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key-test',
      SUPABASE_SECRET_KEYS: 'secret-keys-test',
      SUPABASE_SECRET_KEY: 'secret-key-test',
      SUPABASE_ANON_KEY: 'anon-test',
    });
    expect(text).toBe('adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false');
    for (const fake of FAKE_VALUES) expect(text.includes(fake)).toBe(false);
    expect(text.includes(URL_VALUE)).toBe(false);
  });
});

describe('loadAllowedOrigins', () => {
  it('(AC-T3-3) splits, trims and drops empty segments', () => {
    expect(loadAllowedOrigins(getterOf({ APP_ALLOWED_ORIGINS: ' http://a , ,http://b ' }))).toEqual(['http://a', 'http://b']);
  });
  it('(AC-T3-3) returns [] when unset', () => {
    expect(loadAllowedOrigins(getterOf({}))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { dataModeOrThrow } from '../vite.data-mode.ts';

const FAKE_URL = 'https://example.invalid';
const FAKE_KEY = 'fake-publishable-value-xyz';

const messageOf = (env: Record<string, unknown>): string => {
  try {
    dataModeOrThrow(env);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '';
};

describe('dataModeOrThrow', () => {
  it('(AC-T18-1) (TC-1) accepts mock alone and supabase with both values', () => {
    expect(dataModeOrThrow({ VITE_DATA_MODE: 'mock' })).toBe('mock');
    expect(
      dataModeOrThrow({ VITE_DATA_MODE: 'supabase', VITE_SUPABASE_URL: FAKE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY }),
    ).toBe('supabase');
  });

  it('(AC-T18-1) (TC-2) missing, empty or wrongly cased modes throw', () => {
    for (const env of [{}, { VITE_DATA_MODE: '' }, { VITE_DATA_MODE: 'MOCK' }, { VITE_DATA_MODE: 'staging' }]) {
      expect(() => dataModeOrThrow(env)).toThrow(Error);
    }
  });

  it('(AC-T18-1) (TC-3) mock with any VITE_SUPABASE_* (even empty) throws, without echoing the value', () => {
    const cases: Record<string, unknown>[] = [
      { VITE_DATA_MODE: 'mock', VITE_SUPABASE_URL: FAKE_URL },
      { VITE_DATA_MODE: 'mock', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
      { VITE_DATA_MODE: 'mock', VITE_SUPABASE_ANON_KEY: ' ' },
    ];
    for (const env of cases) {
      expect(() => dataModeOrThrow(env)).toThrow(Error);
      expect(messageOf(env)).not.toContain('example.invalid');
    }
  });

  it('(AC-T18-1) (TC-4) supabase without a required value, or with a blank one, throws', () => {
    const cases: Record<string, unknown>[] = [
      { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY },
      { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_URL: FAKE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: '  ' },
    ];
    for (const env of cases) {
      expect(() => dataModeOrThrow(env)).toThrow(Error);
      expect(messageOf(env)).not.toContain('example.invalid');
      expect(messageOf(env)).not.toContain(FAKE_KEY);
    }
  });
});

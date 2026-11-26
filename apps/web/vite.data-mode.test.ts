import { describe, expect, it } from 'vitest';
import { dataModeOrThrow } from './vite.data-mode.ts';

const FAKE = 'https://example.invalid';
const SUPABASE_OK = { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_URL: FAKE, VITE_SUPABASE_PUBLISHABLE_KEY: 'fake-publishable' };

describe('dataModeOrThrow', () => {
  it('(AC-T18-1) (TC-1) returns the mode for valid environments', () => {
    expect(dataModeOrThrow({ VITE_DATA_MODE: 'mock' })).toBe('mock');
    expect(dataModeOrThrow({ ...SUPABASE_OK, VITE_SUPABASE_URL: FAKE })).toBe('supabase');
  });

  it('(AC-T18-1) (TC-2) throws for a missing, empty, wrongly cased or unknown mode', () => {
    for (const env of [{}, { VITE_DATA_MODE: '' }, { VITE_DATA_MODE: 'MOCK' }, { VITE_DATA_MODE: 'staging' }]) {
      expect(() => dataModeOrThrow(env)).toThrow(Error);
    }
  });

  it('(AC-T18-1) (TC-3) mock must not carry any VITE_SUPABASE_* (even empty or blank) and the message hides values', () => {
    const cases = [
      { VITE_DATA_MODE: 'mock', VITE_SUPABASE_URL: FAKE },
      { VITE_DATA_MODE: 'mock', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
      { VITE_DATA_MODE: 'mock', VITE_SUPABASE_ANON_KEY: ' ' },
    ];
    for (const env of cases) {
      expect(() => dataModeOrThrow(env)).toThrow(Error);
    }
    try {
      dataModeOrThrow(cases[0] ?? {});
    } catch (e) {
      expect(e instanceof Error ? e.message : '').not.toContain('example.invalid');
    }
  });

  it('(AC-T18-1) (TC-4) supabase needs both non-blank values', () => {
    expect(() => dataModeOrThrow({ VITE_DATA_MODE: 'supabase', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toThrow(Error);
    expect(() => dataModeOrThrow({ ...SUPABASE_OK, VITE_SUPABASE_PUBLISHABLE_KEY: '  ' })).toThrow(Error);
    try {
      dataModeOrThrow({ ...SUPABASE_OK, VITE_SUPABASE_PUBLISHABLE_KEY: '  ' });
    } catch (e) {
      expect(e instanceof Error ? e.message : '').not.toContain('example.invalid');
    }
  });
});

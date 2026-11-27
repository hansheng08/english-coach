import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDataModeEnv } from '../../tooling/data-mode-guard.mjs';
import viteConfig from './vite.config.ts';
import { dataModeOrThrow } from './vite.data-mode.ts';

const FAKE = 'https://example.invalid';
const SUPABASE_OK = { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_URL: FAKE, VITE_SUPABASE_PUBLISHABLE_KEY: 'fake-publishable' };

describe('vite.config.ts data-mode check', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const configFor = (command: 'build' | 'serve', isPreview: boolean) => {
    if (typeof viteConfig !== 'function') throw new Error('vite.config.ts must export a config function');
    return viteConfig({ command, mode: 'production', isPreview });
  };

  it('(AC-T18-29) (TC-52) the check is not relaxed for build or preview, and mock still rejects VITE_SUPABASE_*', () => {
    vi.stubEnv('VITE_DATA_MODE', undefined);
    expect(() => configFor('build', false)).toThrow('VITE_DATA_MODE is not set (no default)');
    expect(() => configFor('serve', true)).toThrow('VITE_DATA_MODE is not set (no default)');
    vi.stubEnv('VITE_DATA_MODE', 'mock');
    vi.stubEnv('VITE_SUPABASE_URL', FAKE);
    expect(() => configFor('build', false)).toThrow('mock mode must not define: VITE_SUPABASE_URL');
  });
});

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

  it('(AC-T18-24) (TC-42) (AC-T18-28) (TC-48) gives the same result as assertDataModeEnv', () => {
    const inputs: Record<string, unknown>[] = [
      {},
      { VITE_DATA_MODE: '' },
      { VITE_DATA_MODE: 'MOCK' },
      { VITE_DATA_MODE: 'mock' },
      { VITE_DATA_MODE: 'mock', VITE_SUPABASE_URL: FAKE },
      { VITE_DATA_MODE: 'mock', VITE_SUPABASE_FOO: '' },
      SUPABASE_OK,
      { ...SUPABASE_OK, VITE_SUPABASE_PUBLISHABLE_KEY: '  ' },
      { VITE_DATA_MODE: 'supabase', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' },
    ];
    for (const env of inputs) {
      const r = assertDataModeEnv(env);
      if (r.ok) {
        expect(dataModeOrThrow(env)).toBe(r.mode);
      } else {
        expect(() => dataModeOrThrow(env)).toThrow(new Error(r.reason));
      }
    }
  });

  it('(AC-T18-24) (TC-43) (AC-T18-28) (TC-49) the rules live only in tooling/data-mode-guard.mjs', async () => {
    const src = readFileSync(new URL('./vite.data-mode.ts', import.meta.url), 'utf8');
    expect(src).toContain('assertDataModeEnv');
    expect(src).not.toContain('VITE_SUPABASE_');
    expect(src).not.toContain('trim(');
    const mod = await import('../../tooling/data-mode-guard.mjs');
    expect(Object.keys(mod)).toEqual(['assertDataModeEnv']);
  });
});

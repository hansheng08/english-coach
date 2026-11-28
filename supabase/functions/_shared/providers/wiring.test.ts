import { NtdSchema } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './registry.ts';
import { createProviders } from './wiring.ts';

const FAKE_KEY = 'test-gemini-key-not-real';
const noFetch = vi.fn(() => Promise.reject(new Error('network is not allowed in tests')));

describe('createProviders (ARCHITECTURE §5.4.1)', () => {
  it('(AC-T25-13) (TC-21) with GEMINI_API_KEY the default llm resolves to the free Gemini adapter', () => {
    const reg = createProviders({ env: (name) => (name === 'GEMINI_API_KEY' ? FAKE_KEY : undefined), fetch: noFetch });
    const llm = expectOk(reg.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0)));
    expect(llm.id).toBe('gemini');
    expect(llm.tier).toBe('free');
    expect(noFetch).not.toHaveBeenCalled();
  });

  it('(AC-T25-13) (TC-21) without the key llm is not_configured, and nothing else is wired (stt)', () => {
    const reg = createProviders({ env: () => undefined, fetch: noFetch });
    expect(expectErr(reg.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0))).kind).toBe('not_configured');
    expect(expectErr(reg.resolve('stt', DEFAULT_SETTINGS, NtdSchema.parse(0))).kind).toBe('not_configured');
  });

  const azureEnv = (vars: Readonly<Record<string, string>>) => (name: string) => vars[name];

  it('(AC-T21-9) (TC-11) with both Azure variables the default tts resolves to the free Azure adapter, and Gemini is unchanged', () => {
    const reg = createProviders({
      env: azureEnv({ AZURE_SPEECH_KEY: 'azure-key-not-real', AZURE_SPEECH_REGION: 'eastasia', GEMINI_API_KEY: FAKE_KEY }),
      fetch: noFetch,
    });
    const tts = expectOk(reg.resolve('tts', DEFAULT_SETTINGS, NtdSchema.parse(0)));
    expect(tts.id).toBe('azure-speech');
    expect(tts.tier).toBe('free');
    expect(expectOk(reg.resolve('pronunciation', DEFAULT_SETTINGS, NtdSchema.parse(0))).id).toBe('azure-speech');
    expect(expectOk(reg.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0))).id).toBe('gemini');
    expect(noFetch).not.toHaveBeenCalled();
  });

  it('(AC-T21-9) (TC-11) a missing Azure region or key makes tts not_configured', () => {
    const noRegion = createProviders({ env: azureEnv({ AZURE_SPEECH_KEY: 'azure-key-not-real' }), fetch: noFetch });
    const noKey = createProviders({ env: azureEnv({ AZURE_SPEECH_REGION: 'eastasia' }), fetch: noFetch });
    expect(expectErr(noRegion.resolve('tts', DEFAULT_SETTINGS, NtdSchema.parse(0))).kind).toBe('not_configured');
    expect(expectErr(noKey.resolve('tts', DEFAULT_SETTINGS, NtdSchema.parse(0))).kind).toBe('not_configured');
  });

  it('(AC-T25-13) (TC-21) a blank key counts as missing and the error message holds no key value', () => {
    const reg = createProviders({ env: (name) => (name === 'GEMINI_API_KEY' ? '   ' : undefined), fetch: noFetch });
    const e = expectErr(reg.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0)));
    expect(e.kind).toBe('not_configured');
    expect(JSON.stringify(e)).not.toContain(FAKE_KEY);
  });
});

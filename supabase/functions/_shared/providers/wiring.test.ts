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

  it('(AC-T25-13) (TC-21) a blank key counts as missing and the error message holds no key value', () => {
    const reg = createProviders({ env: (name) => (name === 'GEMINI_API_KEY' ? '   ' : undefined), fetch: noFetch });
    const e = expectErr(reg.resolve('llm', DEFAULT_SETTINGS, NtdSchema.parse(0)));
    expect(e.kind).toBe('not_configured');
    expect(JSON.stringify(e)).not.toContain(FAKE_KEY);
  });
});

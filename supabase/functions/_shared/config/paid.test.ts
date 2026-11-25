import { err, type LlmProvider, type ProviderError } from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { NtdSchema } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { createRegistry, DEFAULT_SETTINGS, type ProviderSettings } from '../providers/registry.ts';

// ADR-008 #6：dependency-cruiser 規則不允許 registry.ts 以外的檔案（含測試）import paid.ts，
// 所以 loadGeminiPaidKey 經由 registry.resolve 的付費路徑測試（錯誤原樣往上傳）。
const UNAVAILABLE: ProviderError = { kind: 'unavailable', provider: 'gemini-paid', capability: 'llm', message: 'x' };
const paidLlm: LlmProvider = {
  id: 'gemini-paid',
  capability: 'llm',
  tier: 'paid',
  displayName: 'gemini-paid',
  generate: () => Promise.resolve(err(UNAVAILABLE)),
  stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }),
};
const settings: ProviderSettings = {
  ...DEFAULT_SETTINGS,
  llm: { provider: 'gemini-paid', model: 'gemini-3.5-flash-lite' },
  paid_consent_at: '2026-11-01T00:00:00Z',
  monthly_paid_cap_ntd: NtdSchema.parse(1000),
};

describe('loadGeminiPaidKey（NFR-05、ADR-003 第 1 層）', () => {
  const run = (value: string | undefined) => {
    const read: string[] = [];
    const reg = createRegistry({
      providers: [paidLlm],
      env: (name) => {
        read.push(name);
        return value;
      },
    });
    return { result: reg.resolve('llm', settings, NtdSchema.parse(0)), read };
  };

  it('(AC-T14-7) (TC-15) 未設定或空字串 → not_configured，訊息含名稱、不含值', () => {
    for (const value of [undefined, '']) {
      const { result, read } = run(value);
      const e = expectErr(result);
      expect(e.kind).toBe('not_configured');
      expect(e.message).toContain('GEMINI_PAID_API_KEY');
      expect(e.message).not.toContain('k-123');
      expect(read).toEqual(['GEMINI_PAID_API_KEY']);
    }
  });

  it('(AC-T15-1) (TC-2) 只有空白 → not_configured（provider 是 gemini-paid）', () => {
    const { result, read } = run('   ');
    const e = expectErr(result);
    expect(e.kind).toBe('not_configured');
    expect(e.provider).toBe('gemini-paid');
    expect(e.message).toBe('missing env GEMINI_PAID_API_KEY');
    expect(read).toEqual(['GEMINI_PAID_API_KEY']);
  });

  it('(AC-T14-7) (TC-15) 有值 → ok，且只讀過 GEMINI_PAID_API_KEY', () => {
    const { result, read } = run('k-123');
    expect(expectOk(result).id).toBe('gemini-paid');
    expect(read).toEqual(['GEMINI_PAID_API_KEY']);
  });
});

import {
  err,
  NtdSchema,
  PROVIDER_IDS,
  type Capability,
  type LlmProvider,
  type Ntd,
  type PaidConsent,
  type PronunciationProvider,
  type ProviderError,
  type ProviderId,
  type SttProvider,
  type Tier,
} from '@english-coach/contracts';
import { expectErr, expectOk } from '@english-coach/contracts/testing';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EnvGetter } from '../config/env.ts';
import {
  createRegistry,
  DEFAULT_SETTINGS,
  grantPaidConsent,
  PROVIDER_TIERS,
  type AnyProvider,
  type ProviderSettings,
  type Registry,
} from './registry.ts';

const ntd = (n: number): Ntd => NtdSchema.parse(n);
const base = { message: 'fake' } as const;

const ERRORS: readonly ProviderError[] = [
  { ...base, kind: 'quota_exhausted', provider: 'groq', capability: 'stt', retryAfterSec: null },
  { ...base, kind: 'rate_limited', provider: 'groq', capability: 'stt', retryAfterSec: 5 },
  { ...base, kind: 'unavailable', provider: 'groq', capability: 'stt' },
  { ...base, kind: 'timeout', provider: 'groq', capability: 'stt' },
  { ...base, kind: 'auth', provider: 'groq', capability: 'stt' },
  { ...base, kind: 'region_blocked', provider: 'groq', capability: 'stt' },
  { ...base, kind: 'invalid_response', provider: 'groq', capability: 'stt' },
  { ...base, kind: 'not_configured', provider: 'groq', capability: 'stt' },
  { ...base, kind: 'paid_not_allowed', provider: 'groq', capability: 'stt', reason: 'no_consent' },
];

const UNAVAILABLE: ProviderError = { ...base, kind: 'unavailable', provider: 'groq', capability: 'stt' };

type Counted<P> = { readonly provider: P; readonly calls: { n: number } };

function fakeStt(id: ProviderId, opts: { tier?: Tier; error?: ProviderError } = {}): Counted<SttProvider> {
  const calls = { n: 0 };
  const provider: SttProvider = {
    id,
    capability: 'stt',
    tier: opts.tier ?? 'free',
    displayName: id,
    transcribe: () => {
      calls.n += 1;
      return Promise.resolve(err(opts.error ?? UNAVAILABLE));
    },
  };
  return { provider, calls };
}

function fakeLlm(id: ProviderId, tier: Tier = 'free'): Counted<LlmProvider> {
  const calls = { n: 0 };
  const provider: LlmProvider = {
    id,
    capability: 'llm',
    tier,
    displayName: id,
    generate: () => {
      calls.n += 1;
      return Promise.resolve(err(UNAVAILABLE));
    },
    stream: () => {
      calls.n += 1;
      return {
        [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
      };
    },
  };
  return { provider, calls };
}

function fakePronunciation(id: ProviderId): Counted<PronunciationProvider> {
  const calls = { n: 0 };
  const provider: PronunciationProvider = {
    id,
    capability: 'pronunciation',
    tier: 'free',
    displayName: id,
    assess: () => {
      calls.n += 1;
      return Promise.resolve(err(UNAVAILABLE));
    },
  };
  return { provider, calls };
}

const envWith =
  (vars: Record<string, string>): EnvGetter =>
  (name) =>
    vars[name];

const withStt = (provider: ProviderId): ProviderSettings => ({
  ...DEFAULT_SETTINGS,
  stt: { provider, model: 'whisper-large-v3-turbo' },
});
const withLlm = (provider: ProviderId, consent: Partial<ProviderSettings> = {}): ProviderSettings => ({
  ...DEFAULT_SETTINGS,
  llm: { provider, model: 'gemini-3.5-flash-lite' },
  ...consent,
});
const CONSENTED = { paid_consent_at: '2026-11-01T00:00:00Z', monthly_paid_cap_ntd: ntd(1000) } as const;
const KEY = envWith({ GEMINI_PAID_API_KEY: 'k-123' });

describe('registry.resolve（AC-24、NFR-03）', () => {
  it('(AC-T14-1) (TC-1) 只回傳被選中的供應商，型別依 capability 縮小', () => {
    const gemini = fakeLlm('gemini');
    const groq = fakeStt('groq');
    const reg = createRegistry({ providers: [gemini.provider, groq.provider], env: envWith({}) });
    expect(expectOk(reg.resolve('llm', DEFAULT_SETTINGS, ntd(0))).id).toBe('gemini');
    expect(expectOk(reg.resolve('stt', DEFAULT_SETTINGS, ntd(0))).id).toBe('groq');
  });

  it('(AC-T14-1) (TC-2) 切換設定後下一次呼叫立即生效', () => {
    const groq = fakeStt('groq');
    const gemini = fakeStt('gemini');
    const reg = createRegistry({ providers: [groq.provider, gemini.provider], env: envWith({}) });
    expect(expectOk(reg.resolve('stt', withStt('groq'), ntd(0))).id).toBe('groq');
    expect(expectOk(reg.resolve('stt', withStt('gemini'), ntd(0))).id).toBe('gemini');
  });

  it('(AC-T14-1) (TC-3) 沒有註冊 → not_configured，不回其他供應商', () => {
    const reg = createRegistry({ providers: [fakeStt('groq').provider], env: envWith({}) });
    const e = expectErr(reg.resolve('stt', withStt('azure-speech'), ntd(0)));
    expect(e.kind).toBe('not_configured');
    expect(e.provider).toBe('azure-speech');
    expect(e.capability).toBe('stt');
  });

  it('(AC-T14-1) (TC-4) 註冊的能力不同 → not_configured', () => {
    const reg = createRegistry({ providers: [fakeLlm('gemini').provider], env: envWith({}) });
    expect(expectErr(reg.resolve('stt', withStt('gemini'), ntd(0))).kind).toBe('not_configured');
  });
});

describe('沒有備援（AC-25、ADR-003）', () => {
  it('(AC-T14-2) (TC-5) 每種 ProviderErrorKind 都不換家，選中的只呼叫 1 次', async () => {
    for (const error of ERRORS) {
      const chosen = fakeStt('groq', { error });
      const otherA = fakeStt('gemini');
      const otherB = fakeStt('azure-speech');
      const others = [otherA, otherB];
      const reg = createRegistry({
        providers: [otherA.provider, chosen.provider, otherB.provider],
        env: envWith({}),
      });
      const first = expectOk(reg.resolve('stt', DEFAULT_SETTINGS, ntd(0)));
      expect(first.id).toBe('groq');
      const result = await first.transcribe(
        { format: 'webm-opus', bytes: new Uint8Array(0) },
        { language: 'en', wordTimestamps: false, timeoutMs: 1000 },
      );
      expect(expectErr(result).kind).toBe(error.kind);
      expect(expectOk(reg.resolve('stt', DEFAULT_SETTINGS, ntd(0)))).toBe(first);
      expect(chosen.calls.n).toBe(1);
      expect(others.map((o) => o.calls.n)).toEqual([0, 0]);
    }
  });

  it('(AC-T14-2) (TC-6) resolve 不呼叫任何 adapter 方法', () => {
    const all = [fakeLlm('gemini'), fakeStt('groq'), fakePronunciation('azure-speech')];
    const reg = createRegistry({ providers: all.map((a) => a.provider), env: envWith({}) });
    for (let i = 0; i < 3; i += 1) {
      reg.resolve('llm', DEFAULT_SETTINGS, ntd(0));
      reg.resolve('stt', DEFAULT_SETTINGS, ntd(0));
      reg.resolve('pronunciation', DEFAULT_SETTINGS, ntd(0));
    }
    expect(all.map((a) => a.calls.n)).toEqual([0, 0, 0]);
  });
});

describe('DEFAULT_SETTINGS 與 PROVIDER_TIERS（AC-25）', () => {
  it('(AC-T14-3) (TC-7) 預設值全部 free，值同 §5.3，付費同意兩欄為 null', () => {
    const chosen = [
      DEFAULT_SETTINGS.llm.provider,
      DEFAULT_SETTINGS.stt.provider,
      DEFAULT_SETTINGS.pronunciation.provider,
      DEFAULT_SETTINGS.tts.provider,
    ];
    for (const id of chosen) expect(PROVIDER_TIERS[id]).toBe('free');
    expect(DEFAULT_SETTINGS.llm).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash-lite' });
    expect(DEFAULT_SETTINGS.stt).toEqual({ provider: 'groq', model: 'whisper-large-v3-turbo' });
    expect(DEFAULT_SETTINGS.pronunciation).toEqual({ provider: 'azure-speech' });
    expect(DEFAULT_SETTINGS.tts).toEqual({ provider: 'azure-speech' });
    expect(DEFAULT_SETTINGS.paid_consent_at).toBeNull();
    expect(DEFAULT_SETTINGS.monthly_paid_cap_ntd).toBeNull();
  });

  it('(AC-T14-3) (TC-8) 每個 PROVIDER_IDS 都有 tier，-paid 結尾才是 paid', () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_TIERS[id]).toBe(id.endsWith('-paid') ? 'paid' : 'free');
    }
    expect(PROVIDER_TIERS['gemini-paid']).toBe('paid');
    expect(PROVIDER_TIERS['azure-speech-paid']).toBe('paid');
  });
});

describe('付費同意（AC-25）', () => {
  const paidReg = () => {
    const paid = fakeLlm('gemini-paid', 'paid');
    return { paid, reg: createRegistry({ providers: [paid.provider], env: KEY }) };
  };

  it('(AC-T14-4) (TC-9) 沒有 paid_consent_at（null、空字串）→ no_consent，付費 adapter 0 次', () => {
    for (const at of [null, '']) {
      const { paid, reg } = paidReg();
      const s = withLlm('gemini-paid', { paid_consent_at: at, monthly_paid_cap_ntd: ntd(1000) });
      const e = expectErr(reg.resolve('llm', s, ntd(0)));
      expect(e).toMatchObject({ kind: 'paid_not_allowed', reason: 'no_consent' });
      expect(paid.calls.n).toBe(0);
    }
  });

  it('(AC-T14-4) (TC-10) 沒有月上限 → no_consent', () => {
    const { paid, reg } = paidReg();
    const s = withLlm('gemini-paid', { paid_consent_at: '2026-11-01T00:00:00Z', monthly_paid_cap_ntd: null });
    expect(expectErr(reg.resolve('llm', s, ntd(0)))).toMatchObject({ kind: 'paid_not_allowed', reason: 'no_consent' });
    expect(paid.calls.n).toBe(0);
  });

  it('(AC-T14-4) (AC-T14-5) (TC-11) 用量邊界 999／1000／1001', () => {
    const { paid, reg } = paidReg();
    const s = withLlm('gemini-paid', CONSENTED);
    expect(expectOk(reg.resolve('llm', s, ntd(999))).id).toBe('gemini-paid');
    for (const used of [1000, 1001]) {
      expect(expectErr(reg.resolve('llm', s, ntd(used)))).toMatchObject({
        kind: 'paid_not_allowed',
        reason: 'monthly_cap_reached',
      });
    }
    expect(paid.calls.n).toBe(0);
  });

  it('(AC-T14-4) (TC-12) adapter 自稱付費（id 不是 -paid）也被擋', () => {
    const groq = fakeStt('groq', { tier: 'paid' });
    const reg = createRegistry({ providers: [groq.provider], env: KEY });
    expect(expectErr(reg.resolve('stt', withStt('groq'), ntd(0)))).toMatchObject({
      kind: 'paid_not_allowed',
      reason: 'no_consent',
    });
    expect(groq.calls.n).toBe(0);
  });

  it('(AC-T14-5) (TC-13) 金鑰未設定、或選 azure-speech-paid → not_configured', () => {
    const paid = fakeLlm('gemini-paid', 'paid');
    const azure = fakePronunciation('azure-speech-paid');
    const noKey = createRegistry({ providers: [paid.provider, azure.provider], env: envWith({}) });
    expect(expectErr(noKey.resolve('llm', withLlm('gemini-paid', CONSENTED), ntd(0))).kind).toBe('not_configured');
    const s: ProviderSettings = { ...DEFAULT_SETTINGS, ...CONSENTED, pronunciation: { provider: 'azure-speech-paid' } };
    const withKey = createRegistry({ providers: [paid.provider, azure.provider], env: KEY });
    expect(expectErr(withKey.resolve('pronunciation', s, ntd(0))).kind).toBe('not_configured');
    expect(paid.calls.n).toBe(0);
    expect(azure.calls.n).toBe(0);
  });
});

describe('型別（AC-25）', () => {
  it('(AC-T14-6) (TC-14) resolvePaid 一定要帶 PaidConsent；成功值型別正確', () => {
    // 專案規定 @ts-expect-error 只能在 *.test-d.ts；這裡改用 expectTypeOf 鎖定同樣的型別限制。
    expectTypeOf<Parameters<Registry['resolvePaid']>[2]>().toEqualTypeOf<PaidConsent>();
    expectTypeOf<{ grantedAt: string; monthlyCapNtd: Ntd; usedThisMonthNtd: Ntd }>().not.toExtend<PaidConsent>();
    expectTypeOf<Parameters<Registry['resolvePaid']>>().toExtend<[Capability, ProviderSettings, PaidConsent]>();

    const consent = expectOk(grantPaidConsent({ ...DEFAULT_SETTINGS, ...CONSENTED }, ntd(0)));
    expectTypeOf(consent).toEqualTypeOf<PaidConsent>();
    expect(consent).toEqual({ grantedAt: '2026-11-01T00:00:00Z', monthlyCapNtd: 1000, usedThisMonthNtd: 0 });

    const reg = createRegistry({ providers: [fakeStt('groq').provider], env: envWith({}) });
    const stt = expectOk(reg.resolve('stt', DEFAULT_SETTINGS, ntd(0)));
    expectTypeOf(stt).toEqualTypeOf<SttProvider>();
    expectTypeOf<AnyProvider>().toExtend<{ capability: Capability }>();
  });
});

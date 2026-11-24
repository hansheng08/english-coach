import {
  err,
  ok,
  type Capability,
  type LlmModelId,
  type LlmProvider,
  type Ntd,
  type PaidConsent,
  type PronunciationProvider,
  type ProviderError,
  type ProviderId,
  type Result,
  type SttModelId,
  type SttProvider,
  type Tier,
  type TtsProvider,
} from '@english-coach/contracts';
import { loadGeminiPaidKey } from '../config/paid.ts';
import type { EnvGetter } from '../config/env.ts';

export type AnyProvider = LlmProvider | SttProvider | PronunciationProvider | TtsProvider;
export type ProviderFor<C extends Capability> = Extract<AnyProvider, { readonly capability: C }>;

export type ProviderSettings = {
  readonly llm: { readonly provider: ProviderId; readonly model: LlmModelId };
  readonly stt: { readonly provider: ProviderId; readonly model: SttModelId };
  readonly pronunciation: { readonly provider: ProviderId };
  readonly tts: { readonly provider: ProviderId };
  readonly paid_consent_at: string | null;
  readonly monthly_paid_cap_ntd: Ntd | null;
};

export type PaidRefusal = { readonly reason: 'no_consent' | 'monthly_cap_reached' };

/** 付費版是不同的 id（ids.ts）；新增 ProviderId 時這張表會編譯失敗。 */
export const PROVIDER_TIERS: Readonly<Record<ProviderId, Tier>> = {
  gemini: 'free',
  'gemini-paid': 'paid',
  groq: 'free',
  'azure-speech': 'free',
  'azure-speech-paid': 'paid',
  webspeech: 'free',
};

/** ARCHITECTURE §5.3 預設欄：全部 free，付費同意兩欄是 null（AC-25）。 */
export const DEFAULT_SETTINGS: ProviderSettings = {
  llm: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  stt: { provider: 'groq', model: 'whisper-large-v3-turbo' },
  pronunciation: { provider: 'azure-speech' },
  tts: { provider: 'azure-speech' },
  paid_consent_at: null,
  monthly_paid_cap_ntd: null,
};

export interface Registry {
  resolve<C extends Capability>(
    capability: C,
    settings: ProviderSettings,
    usedThisMonthNtd: Ntd,
  ): Result<ProviderFor<C>, ProviderError>;
  resolvePaid<C extends Capability>(
    capability: C,
    settings: ProviderSettings,
    consent: PaidConsent,
  ): Result<ProviderFor<C>, ProviderError>;
}

/** ADR-003 第 2 層：唯一建立 PaidConsent 的地方。用量怎麼算由呼叫端決定。 */
export function grantPaidConsent(settings: ProviderSettings, usedThisMonthNtd: Ntd): Result<PaidConsent, PaidRefusal> {
  const grantedAt = settings.paid_consent_at;
  const cap = settings.monthly_paid_cap_ntd;
  if (grantedAt === null || grantedAt.length === 0 || cap === null) {
    return err({ reason: 'no_consent' });
  }
  if (usedThisMonthNtd >= cap) return err({ reason: 'monthly_cap_reached' });
  return ok({ grantedAt, monthlyCapNtd: cap, usedThisMonthNtd } as PaidConsent);
}

function notConfigured(provider: ProviderId, capability: Capability, message: string): ProviderError {
  return { kind: 'not_configured', provider, capability, message };
}

export function createRegistry(deps: { readonly providers: readonly AnyProvider[]; readonly env: EnvGetter }): Registry {
  const find = <C extends Capability>(
    capability: C,
    id: ProviderId,
  ): Result<ProviderFor<C>, ProviderError> => {
    const isTarget = (p: AnyProvider): p is ProviderFor<C> => p.id === id && p.capability === capability;
    const found = deps.providers.find(isTarget);
    if (found === undefined) {
      return err(notConfigured(id, capability, `provider ${id} is not registered for ${capability}`));
    }
    return ok(found);
  };

  const resolvePaid: Registry['resolvePaid'] = (capability, settings) => {
    const id = settings[capability].provider;
    switch (id) {
      case 'gemini-paid': {
        const key = loadGeminiPaidKey(deps.env);
        if (!key.ok) return err({ ...key.error, capability });
        return find(capability, id);
      }
      case 'azure-speech-paid':
        return err(notConfigured(id, capability, 'azure-speech-paid is not available in the MVP'));
      case 'gemini':
      case 'groq':
      case 'azure-speech':
      case 'webspeech':
        return find(capability, id);
      default: {
        const unreachable: never = id;
        return unreachable;
      }
    }
  };

  const resolve: Registry['resolve'] = (capability, settings, usedThisMonthNtd) => {
    const id = settings[capability].provider;
    const found = find(capability, id);
    if (!found.ok) return found;
    const paid = PROVIDER_TIERS[id] === 'paid' || found.value.tier === 'paid';
    if (!paid) return found;
    const consent = grantPaidConsent(settings, usedThisMonthNtd);
    if (!consent.ok) {
      return err({
        kind: 'paid_not_allowed',
        provider: id,
        capability,
        message: `paid provider ${id} requires consent (${consent.error.reason})`,
        reason: consent.error.reason,
      });
    }
    return resolvePaid(capability, settings, consent.value);
  };

  return { resolve, resolvePaid };
}

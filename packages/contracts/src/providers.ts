import { z } from 'zod';
import type { AudioPayload, Wav16kMono } from './audio.ts';
import type { Brand } from './brand.ts';
import type { LlmModelId, Ntd, ProviderId, VoiceId } from './ids.ts';
import type { Result } from './result.ts';
import type { PronunciationResult, Transcript } from './speech.ts';

export type Tier = 'free' | 'paid';
export type Capability = 'llm' | 'stt' | 'pronunciation' | 'tts';

export type ProviderErrorKind =
  | 'quota_exhausted' | 'rate_limited' | 'unavailable' | 'timeout'
  | 'auth' | 'region_blocked' | 'invalid_response' | 'not_configured' | 'paid_not_allowed';

export const CapabilitySchema = z.enum(['llm', 'stt', 'pronunciation', 'tts']);

type ProviderErrorBase = { provider: ProviderId; capability: Capability; message: string };
/** 供應商層的錯誤（registry 與 adapter 只會回這些）。 */
export type ProviderError =
  | (ProviderErrorBase & { kind: 'quota_exhausted' | 'rate_limited'; retryAfterSec: number | null })
  | (ProviderErrorBase & { kind: 'paid_not_allowed'; reason: 'no_consent' | 'monthly_cap_reached' })
  | (ProviderErrorBase & {
      kind: 'unavailable' | 'timeout' | 'auth' | 'region_blocked' | 'invalid_response' | 'not_configured';
    });

/** 供應商層的串流片段：只有文字增量與結束；解析 JSON 是呼叫端的事。 */
export type StreamChunk =
  | { readonly type: 'delta'; readonly text: string }
  | {
      readonly type: 'done';
      readonly finishReason: 'stop' | 'max_tokens' | 'safety';
      readonly usage: { inputTokens: number; outputTokens: number } | null;
    };

export interface ProviderInfo {
  readonly id: ProviderId;
  readonly capability: Capability;
  readonly tier: Tier;
  readonly displayName: string;
}

export type LlmRequest<T> = {
  model: LlmModelId;
  system: string;
  prompt: string;
  schema: z.ZodType<T>; // 回傳先 JSON.parse（tryCatch）再 safeParse；失敗回 invalid_response
  maxOutputTokens: number;
  timeoutMs: number;
};
export type LlmStreamRequest = Omit<LlmRequest<unknown>, 'schema'>; // 串流不帶 schema，呼叫端逐行用 CardStreamEventSchema 等驗證

export type SttOptions = { language: 'en'; wordTimestamps: boolean; prompt?: string; timeoutMs: number };
export type TtsResult = { audio: Uint8Array; mime: 'audio/mpeg' | 'audio/wav' | 'audio/ogg'; durationMs: number };

export interface LlmProvider extends ProviderInfo {
  readonly capability: 'llm';
  generate<T>(req: LlmRequest<T>): Promise<Result<T, ProviderError>>;
  stream(req: LlmStreamRequest): AsyncIterable<Result<StreamChunk, ProviderError>>; // 出現 err 後不再產生
}
export interface SttProvider extends ProviderInfo {
  readonly capability: 'stt';
  transcribe(audio: AudioPayload, opts: SttOptions): Promise<Result<Transcript, ProviderError>>; // wordTimestamps=true 時保證 timing='words'，否則回 invalid_response
}
export interface PronunciationProvider extends ProviderInfo {
  readonly capability: 'pronunciation';
  assess(
    audio: Wav16kMono,
    referenceText: string,
    opts: { timeoutMs: number },
  ): Promise<Result<PronunciationResult, ProviderError>>;
}
export interface TtsProvider extends ProviderInfo {
  readonly capability: 'tts';
  synthesize(text: string, voice: VoiceId, opts: { timeoutMs: number }): Promise<Result<TtsResult, ProviderError>>;
}

/** ADR-003 第 2 層：只有 _shared/providers/registry.ts 的 grantPaidConsent(settings, usage) 能建立（唯一可以 `as PaidConsent` 的檔案）。 */
export type PaidConsent = Brand<
  { readonly grantedAt: string; readonly monthlyCapNtd: Ntd; readonly usedThisMonthNtd: Ntd },
  'PaidConsent'
>;

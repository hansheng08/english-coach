import { expectTypeOf } from 'vitest';
import type {
  AnswerId,
  AppError,
  AppErrorKind,
  Capability,
  CapabilitySchema,
  CardId,
  Entity,
  HttpErrorStatus,
  LlmModelId,
  LlmProvider,
  NewsCategory,
  Ntd,
  PlanDate,
  PronunciationProvider,
  ProviderError,
  ProviderErrorKind,
  ProviderId,
  SttModelId,
  SttProvider,
  Tier,
  Transcript,
  TtsProvider,
  VoiceId,
} from './index.ts';

// ── 字面值聯集：完整成員 ──
expectTypeOf<Tier>().toEqualTypeOf<'free' | 'paid'>();
expectTypeOf<Capability>().toEqualTypeOf<'llm' | 'stt' | 'pronunciation' | 'tts'>();
expectTypeOf<ProviderErrorKind>().toEqualTypeOf<
  | 'quota_exhausted'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'auth'
  | 'region_blocked'
  | 'invalid_response'
  | 'not_configured'
  | 'paid_not_allowed'
>();
expectTypeOf<ProviderId>().toEqualTypeOf<
  'gemini' | 'gemini-paid' | 'groq' | 'azure-speech' | 'azure-speech-paid' | 'webspeech'
>();
expectTypeOf<LlmModelId>().toEqualTypeOf<'gemini-3.5-flash-lite' | 'gemini-3.8-flash' | 'gemini-3.1-flash-lite'>();
expectTypeOf<SttModelId>().toEqualTypeOf<'whisper-large-v3-turbo' | 'gemini-3.5-transcribe' | 'azure-stt-short'>();
expectTypeOf<VoiceId>().toEqualTypeOf<
  'azure:en-US-AvaNeural' | 'azure:en-US-AndrewNeural' | 'gemini:Kore' | 'gemini:Puck'
>();
expectTypeOf<NewsCategory>().toEqualTypeOf<'ai' | 'software' | 'semiconductor'>();
expectTypeOf<AppErrorKind>().toEqualTypeOf<
  | 'quota_exhausted'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'auth'
  | 'region_blocked'
  | 'invalid_response'
  | 'not_configured'
  | 'paid_not_allowed'
  | 'validation'
  | 'unauthenticated'
  | 'not_found'
  | 'conflict'
  | 'storage_failed'
  | 'db_failed'
  | 'news_unavailable'
  | 'plan_not_ready'
  | 'internal'
>();
expectTypeOf<HttpErrorStatus>().toEqualTypeOf<400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504>();
expectTypeOf<Entity>().toEqualTypeOf<'card' | 'answer' | 'question' | 'plan' | 'resume' | 'article' | 'audio'>();

// ── 互相對應 ──
expectTypeOf<AppErrorKind>().toEqualTypeOf<AppError['kind']>();
expectTypeOf<ProviderErrorKind>().toEqualTypeOf<ProviderError['kind']>();
// z.infer<typeof CapabilitySchema> 等於 schema 的 _output（adr008-02t：測試不得 import zod）
expectTypeOf<(typeof CapabilitySchema)['_output']>().toEqualTypeOf<Capability>();

// ── 品牌型別不能混用 ──
declare const cardId: CardId;
declare const plainString: string;
declare const plainNumber: number;

// @ts-expect-error CardId 不能指定給 AnswerId
export const answerId: AnswerId = cardId;
// @ts-expect-error string 不能指定給 PlanDate
export const planDate: PlanDate = plainString;
// @ts-expect-error number 不能指定給 Ntd
export const ntd: Ntd = plainNumber;

// ── Transcript 要用 timing 縮小才能讀 words ──
declare const transcript: Transcript;
// @ts-expect-error 沒用 timing 縮小就讀 words
export type NoNarrowing = Transcript['words'];
if (transcript.timing === 'words') {
  expectTypeOf(transcript.words).not.toBeAny();
}

// ── 四種介面固定 capability ──
expectTypeOf<LlmProvider['capability']>().toEqualTypeOf<'llm'>();
expectTypeOf<SttProvider['capability']>().toEqualTypeOf<'stt'>();
expectTypeOf<PronunciationProvider['capability']>().toEqualTypeOf<'pronunciation'>();
expectTypeOf<TtsProvider['capability']>().toEqualTypeOf<'tts'>();

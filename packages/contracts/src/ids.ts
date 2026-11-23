import { z } from 'zod';

export const UserIdSchema = z.uuid().brand<'UserId'>();
export const CardIdSchema = z.uuid().brand<'CardId'>();
export const AnswerIdSchema = z.uuid().brand<'AnswerId'>();
export const QuestionIdSchema = z.uuid().brand<'QuestionId'>();
export const ArticleIdSchema = z.uuid().brand<'ArticleId'>();
/** 台北日期 YYYY-MM-DD（§4 plan_date）；只能由 domain 的台北日期函式或 schema 產生。 */
export const PlanDateSchema = z.iso.date().brand<'PlanDate'>();
/** Storage 物件路徑，格式 `<user_id>/<bucket 內路徑>`。 */
export const StoragePathSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}\/[\w./-]+$/)
  .brand<'StoragePath'>();
/** 新台幣整數元（付費月上限、用量）。 */
export const NtdSchema = z.number().int().nonnegative().brand<'Ntd'>();

export type UserId = z.infer<typeof UserIdSchema>;
export type CardId = z.infer<typeof CardIdSchema>;
export type AnswerId = z.infer<typeof AnswerIdSchema>;
export type QuestionId = z.infer<typeof QuestionIdSchema>;
export type ArticleId = z.infer<typeof ArticleIdSchema>;
export type PlanDate = z.infer<typeof PlanDateSchema>;
export type StoragePath = z.infer<typeof StoragePathSchema>;
export type Ntd = z.infer<typeof NtdSchema>;

/** 金額運算後要回到 Ntd 只能經過這兩個函式（本檔是唯一可以 `as Ntd` 的地方）。 */
export function addNtd(a: Ntd, b: Ntd): Ntd {
  return (a + b) as Ntd;
}

/** 結果小於 0 時回 0。 */
export function subNtdFloor0(a: Ntd, b: Ntd): Ntd {
  return Math.max(0, a - b) as Ntd;
}
// PlanDate 由 domain 的台北日期函式（packages/domain/src/taipei-date.ts，唯一可以 `as PlanDate` 的正式程式檔）或 PlanDateSchema 產生。
// db 讀出的列一律先用 zod 的列 schema 驗證，ID 因此自然帶品牌，不需要 `as`。

/** 新聞類別（§11）；T-049 的 NewsSettingsSchema 用它。 */
export const NEWS_CATEGORIES = ['ai', 'software', 'semiconductor'] as const;
export const NewsCategorySchema = z.enum(NEWS_CATEGORIES);
export type NewsCategory = z.infer<typeof NewsCategorySchema>;

/** 供應商（不是品牌型別：字面值聯集就夠，新增時 switch 會編譯失敗）。付費版是不同的 id，因為金鑰不同（ADR-003 第 1 層）。 */
export const PROVIDER_IDS = [
  'gemini',
  'gemini-paid',
  'groq',
  'azure-speech',
  'azure-speech-paid',
  'webspeech',
] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderIdSchema>;
// 'webspeech' 是瀏覽器內建 TTS，只出現在 meta 與設定，後端沒有它的 adapter。

/** 模型 ID 以 §5.3 為準；新增模型＝改這裡＋設定頁選項（AC-24），不改其他程式。 */
export const LLM_MODEL_IDS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'] as const;
export const LlmModelIdSchema = z.enum(LLM_MODEL_IDS);
export type LlmModelId = z.infer<typeof LlmModelIdSchema>;

export const STT_MODEL_IDS = ['whisper-large-v3-turbo', 'gemini-3.5-transcribe', 'azure-stt-short'] as const;
export const SttModelIdSchema = z.enum(STT_MODEL_IDS);
export type SttModelId = z.infer<typeof SttModelIdSchema>;

/** 語音 ID 帶供應商前綴，adapter 可以用 Extract<VoiceId, `azure:${string}`> 只接受自家語音。語音名稱未驗證，由 TTS adapter 單驗證後才能改。 */
export const VOICE_IDS = ['azure:en-US-AvaNeural', 'azure:en-US-AndrewNeural', 'gemini:Kore', 'gemini:Puck'] as const;
export const VoiceIdSchema = z.enum(VOICE_IDS);
export type VoiceId = z.infer<typeof VoiceIdSchema>;

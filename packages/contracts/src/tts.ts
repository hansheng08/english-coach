// POST /tts 的契約（ARCHITECTURE §4.19）：文字正規化、請求與回應。
import { z } from 'zod';
import { ProviderIdSchema, StoragePathSchema, VoiceIdSchema, type VoiceId } from './ids.ts';
import { stripBreaks } from './news.ts';

/** 一次最多 1,000 字元（§4.19；超過回 400 validation）。 */
export const TTS_TEXT_MAX_CHARS = 1000;

/** 預設語音：全專案只寫這一次；`settings.tts.voice` 的預設值用它（§4.19，PM 可以改）。語音名稱未驗證（A-004）。 */
export const DEFAULT_TTS_VOICE: VoiceId = 'azure:en-US-AvaNeural';

/** 快取鍵與請求共用：去掉「/」→ NFC → 連續空白（含換行）換成一個空白 → trim。 */
export function normalizeTtsText(text: string): string {
  return stripBreaks(text).normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** 請求不帶 `voice`：語音只從設定讀，前端與 daily-prep 才會命中同一個快取（§4.19）。 */
export const TtsRequestSchema = z
  .object({
    text: z.string().transform(normalizeTtsText).pipe(z.string().min(1).max(TTS_TEXT_MAX_CHARS)),
  })
  .strict();
export type TtsRequest = z.infer<typeof TtsRequestSchema>;

export const TtsResponseSchema = z.object({
  /** signed URL，3600 秒（§4.12.1）。 */
  audioUrl: z.url(),
  /** 物件路徑；前端可以存起來，下次直接要 signed URL。 */
  path: StoragePathSchema,
  durationMs: z.number().int().positive(),
  cached: z.boolean(),
  meta: z.object({ ttsProvider: ProviderIdSchema, voice: VoiceIdSchema }),
});
export type TtsResponse = z.infer<typeof TtsResponseSchema>;

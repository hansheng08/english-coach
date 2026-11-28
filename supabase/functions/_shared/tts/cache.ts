// TTS 快取鍵與長度換算（ARCHITECTURE §4.19、§4.12.1、§5.6.3）。`/tts` 與 daily-prep（T-025b）都只經過這裡算路徑。
import { StoragePathSchema, type StoragePath, type UserId, type VoiceId } from '@english-coach/contracts';

const encoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `<user_id>/<sha256(voice + "\n" + ttsText) 小寫 hex>.mp3`。`ttsText` 必須已經過 `normalizeTtsText`。
 * user_id 轉小寫：Storage policy 比對的是 `auth.uid()::text`（小寫）。
 */
export async function ttsObjectPath(userId: UserId, voice: VoiceId, ttsText: string): Promise<StoragePath> {
  const hash = await sha256Hex(`${voice}\n${ttsText}`);
  return StoragePathSchema.parse(`${userId.toLowerCase()}/${hash}.mp3`);
}

/** §5.6.3 的位元率換算（48 kbps mp3）：Azure adapter 與快取命中用同一個公式。 */
export function mp3DurationMs(bytes: number): number {
  return Math.round((bytes * 8) / 48);
}

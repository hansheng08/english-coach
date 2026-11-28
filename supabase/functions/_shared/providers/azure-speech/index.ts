import type { PronunciationProvider, TtsProvider } from '@english-coach/contracts';
import { createPronunciation } from './pronunciation.ts';
import { createTts } from './tts.ts';

export type AzureSpeechDeps = { readonly key: string; readonly region: string; readonly fetch: typeof fetch };
export type AzureSpeechProviders = { readonly pronunciation: PronunciationProvider; readonly tts: TtsProvider };

/** ARCHITECTURE §5.6.1：一個工廠兩個 provider；建立時不發請求、不讀環境變數。 */
export function createAzureSpeechProviders(deps: AzureSpeechDeps): AzureSpeechProviders {
  const transport = { fetch: deps.fetch, key: deps.key };
  return {
    pronunciation: createPronunciation(transport, deps.region),
    tts: createTts(transport, deps.region),
  };
}

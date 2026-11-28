// 供應商接線（ARCHITECTURE §5.4.1；ADR-008 修訂 5 第 19 條）：只有這裡能 import config/provider-keys.ts。
// 免費供應商：Gemini（T-025a）、Azure Speech 的 tts 與 pronunciation（T-021）；沒有金鑰時不放進清單，registry.resolve 自然回 not_configured。
import type { EnvGetter } from '../config/env.ts';
import { loadAzureSpeechConfig, loadGeminiKey } from '../config/provider-keys.ts';
import { createAzureSpeechProviders } from './azure-speech/index.ts';
import { createGeminiProvider } from './gemini/index.ts';
import { createRegistry, type AnyProvider, type Registry } from './registry.ts';

/**
 * 真的 fetch（ESLint 只允許 providers／news／web api 碰 `fetch`，ADR-008 #8）：各函式的 index.ts 從這裡拿，
 * 注入給供應商、新聞與 RouteDeps；其他程式一律收參數。
 */
export const realFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => fetch(input, init);

export function createProviders(deps: { readonly env: EnvGetter; readonly fetch: typeof fetch }): Registry {
  const key = loadGeminiKey(deps.env);
  const azure = loadAzureSpeechConfig(deps.env);
  const gemini: readonly AnyProvider[] = key.ok ? [createGeminiProvider({ id: 'gemini', apiKey: key.value, fetch: deps.fetch })] : [];
  // 缺金鑰或 region 就不放進清單，resolve 自然回 not_configured（ARCHITECTURE §5.4.1）。
  const speech: readonly AnyProvider[] = azure.ok
    ? Object.values(createAzureSpeechProviders({ key: azure.value.key, region: azure.value.region, fetch: deps.fetch }))
    : [];
  return createRegistry({ providers: [...gemini, ...speech], env: deps.env });
}

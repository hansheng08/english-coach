import type { LlmProvider, Tier } from '@english-coach/contracts';
import { runGenerate } from './generate.ts';
import { runStream } from './stream.ts';
import type { GeminiDeps } from './transport.ts';

export type { GeminiDeps } from './transport.ts';

/** Gemini LLM adapter（ARCHITECTURE §5.4；ADR-012）。建立時不呼叫 fetch、不驗證金鑰。 */
export function createGeminiProvider(deps: GeminiDeps): LlmProvider {
  const paid = deps.id === 'gemini-paid';
  const tier: Tier = paid ? 'paid' : 'free';
  return {
    id: deps.id,
    capability: 'llm',
    tier,
    displayName: paid ? 'Gemini（付費）' : 'Gemini',
    generate: (req) => runGenerate(deps, req),
    stream: (req) => runStream(deps, req),
  };
}

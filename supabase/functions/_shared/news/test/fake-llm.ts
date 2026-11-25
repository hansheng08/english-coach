// Fake LlmProvider for T-023 tests: records every request, validates the raw reply with the request's own schema
// (like an adapter, but without the retry) and can also return a given ProviderError.
import { err, ok, type LlmProvider, type LlmRequest, type ProviderError, type Result } from '@english-coach/contracts';

export type FakeReply = { readonly raw: unknown } | { readonly error: ProviderError };

export type FakeLlm = {
  readonly llm: LlmProvider;
  readonly requests: LlmRequest<unknown>[];
  readonly calls: () => number;
};

export const providerError = (kind: 'timeout' | 'invalid_response' | 'unavailable' | 'auth' | 'region_blocked' | 'not_configured'): ProviderError => ({
  kind,
  provider: 'gemini',
  capability: 'llm',
  message: `fake ${kind}`,
});

export const rateLimited = (): ProviderError => ({
  kind: 'rate_limited',
  provider: 'gemini',
  capability: 'llm',
  message: 'fake rate_limited',
  retryAfterSec: 30,
});

export const quotaExhausted = (): ProviderError => ({
  kind: 'quota_exhausted',
  provider: 'gemini',
  capability: 'llm',
  message: 'fake quota_exhausted',
  retryAfterSec: null,
});

export function createFakeLlm(reply: FakeReply): FakeLlm {
  const requests: LlmRequest<unknown>[] = [];
  const llm: LlmProvider = {
    id: 'gemini',
    capability: 'llm',
    tier: 'free',
    displayName: 'Fake LLM',
    generate<T>(req: LlmRequest<T>): Promise<Result<T, ProviderError>> {
      requests.push(req);
      if ('error' in reply) return Promise.resolve(err(reply.error));
      const parsed = req.schema.safeParse(reply.raw);
      if (parsed.success) return Promise.resolve(ok(parsed.data));
      return Promise.resolve(err(providerError('invalid_response')));
    },
    stream: () => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }),
    }),
  };
  return { llm, requests, calls: () => requests.length };
}

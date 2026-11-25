import { err, ok, type LlmRequest, type ProviderError, type Result } from '@english-coach/contracts';
import { classifyGeminiError } from './errors.ts';
import { interpretGenerate, type GenerateFailure } from './response.ts';
import { buildBody, generateUrl, openCall, type GeminiDeps } from './transport.ts';

/**
 * ARCHITECTURE §5.4.3、§5.4.4：自動重試只有一種（STOP 但 JSON／zod 失敗，同模型 1 次），所以最多呼叫 fetch 2 次；
 * timeoutMs 是兩次合計的整段時間。
 */
export async function runGenerate<T>(deps: GeminiDeps, req: LlmRequest<T>): Promise<Result<T, ProviderError>> {
  const ctx = { id: deps.id, apiKey: deps.apiKey, model: req.model };
  const call = openCall(deps, req.timeoutMs);
  const body = buildBody(req, true);
  const failure = (error: ProviderError): Result<T, GenerateFailure> => err({ error, retry: false });

  const once = async (): Promise<Result<T, GenerateFailure>> => {
    const sent = await call.send(generateUrl(req.model), body);
    if (!sent.ok) return failure(sent.error);
    const text = await call.wait(sent.value.text());
    if (!text.ok) return failure(text.error);
    if (!sent.value.ok) return failure(classifyGeminiError({ status: sent.value.status, body: text.value, ...ctx }));
    return interpretGenerate(text.value, req.schema, ctx);
  };

  try {
    let result = await once();
    if (!result.ok && result.error.retry) result = await once();
    return result.ok ? ok(result.value) : err(result.error.error);
  } finally {
    call.finish();
  }
}

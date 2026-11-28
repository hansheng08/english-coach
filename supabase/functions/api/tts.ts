import {
  httpStatusOf,
  normalizeTtsText,
  NtdSchema,
  toApiErrorBody,
  TtsRequestSchema,
  TtsResponseSchema,
  type AppError,
} from '@english-coach/contracts';
import type { AuthContext } from '../_shared/db/auth.ts';
import type { ProviderCallRecord } from '../_shared/db/provider-call.ts';
import type { TtsStore } from '../_shared/db/tts-store.ts';
import { DEFAULT_SETTINGS, type Registry } from '../_shared/providers/registry.ts';
import { mp3DurationMs, ttsObjectPath } from '../_shared/tts/cache.ts';

/** router.ts 的 `RouteDeps`／`Route` 的結構子集；不從 router 匯入，避免循環相依（adr008-10-no-circular）。 */
type TtsRouteDeps = {
  readonly now: () => Date;
  readonly ttsStore: (ctx: AuthContext) => TtsStore;
  readonly providers: Registry;
  /** 記帳失敗只留一行 log（§4.19）。 */
  readonly log: (line: string) => void;
};
type TtsRoute = (req: Request, ctx: AuthContext, deps: TtsRouteDeps) => Promise<Response>;

/** synthesize 的逾時（§6 第 6 點；/tts 目標 ≤ 3 s）。 */
export const TTS_TIMEOUT_MS = 8000;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function failure(e: AppError): Response {
  return new Response(JSON.stringify(toApiErrorBody(e)), { status: httpStatusOf(e), headers: JSON_HEADERS });
}

async function readJson(req: Request): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  try {
    return { ok: true, value: (await req.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * POST /tts（ARCHITECTURE §4.19、§4.12.1）：語音只從設定讀；物件已在就直接發 signed URL，不在才呼叫供應商、上傳、再發。
 * 只有真的呼叫了 synthesize 才寫 provider_call（成功與失敗各一筆）。
 */
export const postTts: TtsRoute = async (req, ctx, deps) => {
  const body = await readJson(req);
  if (!body.ok) {
    return failure({ kind: 'validation', message: 'invalid request', issues: [{ path: 'body', message: 'body must be JSON' }] });
  }
  const parsed = TtsRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return failure({
      kind: 'validation',
      message: 'invalid request',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.map(String).join('.'),
        message: i.code === 'unrecognized_keys' ? `unrecognized keys: ${i.keys.join(', ')}` : i.message,
      })),
    });
  }
  const text = normalizeTtsText(parsed.data.text);

  const store = deps.ttsStore(ctx);
  const voice = await store.readVoice();
  if (!voice.ok) return failure(voice.error);
  const path = await ttsObjectPath(ctx.userId, voice.value, text);

  const found = await store.find(path);
  if (!found.ok) return failure(found.error);

  let cached: boolean;
  let durationMs: number;
  let ttsProvider = DEFAULT_SETTINGS.tts.provider;
  if (found.value !== null) {
    cached = true;
    durationMs = mp3DurationMs(found.value.bytes);
  } else {
    // T-020 的 sumPaidUsageThisMonthNtd 還不在 main：暫傳 0（ARCHITECTURE §4.19 過渡），T-020 的用量接線改接；本檔唯一的呼叫點。
    const provider = deps.providers.resolve('tts', DEFAULT_SETTINGS, NtdSchema.parse(0));
    if (!provider.ok) return failure(provider.error);

    const startedAt = deps.now().getTime();
    const audio = await provider.value.synthesize(text, voice.value, { timeoutMs: TTS_TIMEOUT_MS });
    const latencyMs = deps.now().getTime() - startedAt;
    const record: ProviderCallRecord = {
      capability: 'tts',
      provider: provider.value.id,
      model: null,
      tier: provider.value.tier,
      errorKind: audio.ok ? null : audio.error.kind,
      latencyMs,
    };
    const recorded = await store.recordCall(record);
    if (!recorded.ok) deps.log(`tts recordCall kind=${recorded.error.kind}`);
    if (!audio.ok) return failure(audio.error);

    const uploaded = await store.upload(path, audio.value.audio, audio.value.mime);
    if (!uploaded.ok) return failure(uploaded.error);
    cached = false;
    durationMs = audio.value.durationMs;
    ttsProvider = provider.value.id;
  }

  const signed = await store.signedUrl(path);
  if (!signed.ok) return failure(signed.error);

  const response = TtsResponseSchema.safeParse({
    audioUrl: signed.value,
    path,
    durationMs,
    cached,
    meta: { ttsProvider, voice: voice.value },
  });
  if (!response.success) return failure({ kind: 'internal', message: 'tts response failed its own schema' });
  return new Response(JSON.stringify(response.data), { status: 200, headers: JSON_HEADERS });
};

import { err, type AudioPayload, type ProviderError, type Result, type SttProvider, type Transcript } from '@english-coach/contracts';
import { GROQ_MODEL } from './errors.ts';
import { mapTranscript } from './response.ts';
import { withCall } from './transport.ts';

export type GroqDeps = { readonly apiKey: string; readonly fetch: typeof fetch };

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

type Options = Parameters<SttProvider['transcribe']>[1];

function buildForm(audio: AudioPayload, opts: Options): FormData {
  const form = new FormData();
  const file =
    audio.format === 'webm-opus'
      ? { bytes: audio.bytes, type: 'audio/webm', name: 'answer.webm' }
      : { bytes: audio.wav.bytes, type: 'audio/wav', name: 'audio.wav' };
  form.append('file', new Blob([file.bytes.slice()], { type: file.type }), file.name);
  form.append('model', GROQ_MODEL);
  form.append('language', opts.language);
  form.append('response_format', 'verbose_json');
  if (opts.wordTimestamps) form.append('timestamp_granularities[]', 'word');
  if (opts.prompt !== undefined && opts.prompt.length > 0) form.append('prompt', opts.prompt);
  return form;
}

/** ARCHITECTURE §5.7.1：建立時不發請求、不驗證金鑰；每次 transcribe 最多呼叫 fetch 一次，不重試。 */
export function createGroqProvider(deps: GroqDeps): SttProvider {
  const transport = { fetch: deps.fetch, apiKey: deps.apiKey };
  return {
    id: 'groq',
    tier: 'free',
    displayName: 'Groq Whisper',
    capability: 'stt',
    transcribe: (audio, opts): Promise<Result<Transcript, ProviderError>> =>
      withCall(transport, opts.timeoutMs, async (call) => {
        const sent = await call.send(ENDPOINT, buildForm(audio, opts));
        if (!sent.ok) return sent;
        const res = sent.value;
        // status 0 ＝ opaqueredirect（瀏覽器式的 redirect: 'manual'）；3xx 由 failure 分類。
        if (res.type === 'opaqueredirect' || res.status === 0) {
          return err(call.fail('unavailable', 'redirect response was not followed'));
        }
        if (res.status < 200 || res.status >= 300) return err(await call.failure(res));
        const text = await call.wait(res.text());
        if (!text.ok) return text;
        return mapTranscript(text.value, opts.wordTimestamps, deps.apiKey);
      }),
  };
}

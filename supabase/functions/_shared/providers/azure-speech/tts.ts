import { err, ok, type TtsProvider } from '@english-coach/contracts';
import { buildSsml } from './ssml.ts';
import { type AzureTransport, withCall } from './transport.ts';

const VOICE_PREFIX = 'azure:';

export function createTts(t: AzureTransport, region: string): TtsProvider {
  return {
    id: 'azure-speech',
    capability: 'tts',
    tier: 'free',
    displayName: 'Azure Speech',
    synthesize: (text, voice, opts) =>
      withCall(t, 'tts', opts.timeoutMs, async (call) => {
        if (!voice.startsWith(VOICE_PREFIX)) {
          return err(call.fail('not_configured', `voice not supported by azure-speech: ${voice}`));
        }
        const sent = await call.send(
          `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
          {
            'Ocp-Apim-Subscription-Key': t.key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'english-coach',
          },
          buildSsml(voice.slice(VOICE_PREFIX.length), text),
        );
        if (!sent.ok) return sent;
        if (!sent.value.ok) return err(await call.failure(sent.value));
        const buffer = await call.wait(sent.value.arrayBuffer());
        if (!buffer.ok) return buffer;
        const audio = new Uint8Array(buffer.value);
        if (audio.length === 0) return err(call.fail('invalid_response', 'empty audio'));
        return ok({ audio, mime: 'audio/mpeg', durationMs: Math.round((audio.length * 8) / 48) });
      }),
  };
}

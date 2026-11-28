import { err, ok, toApiErrorBody } from '@english-coach/contracts';
import type { PlayerDeps } from '../audio/player';
import type { ApiClient } from './client';

/**
 * 把 `ApiClient` 的 tts／ttsSignedUrl 接成播放器要的 `resolve`（ARCHITECTURE §4.19）：
 * `{kind:'text'}` 走 `/tts`（有 durationMs）；`{kind:'path'}` 只要 signed URL（durationMs 是 null）。
 */
export function ttsResolver(client: ApiClient): PlayerDeps['resolve'] {
  return async (source) => {
    switch (source.kind) {
      case 'text': {
        if (client.tts === undefined) return err(toApiErrorBody({ kind: 'internal', message: 'tts is not available' }).error);
        const r = await client.tts(source.text);
        return r.ok ? ok({ url: r.value.audioUrl, durationMs: r.value.durationMs }) : err(toApiErrorBody(r.error).error);
      }
      case 'path': {
        if (client.ttsSignedUrl === undefined) return err(toApiErrorBody({ kind: 'internal', message: 'ttsSignedUrl is not available' }).error);
        const r = await client.ttsSignedUrl(source.path);
        return r.ok ? ok({ url: r.value, durationMs: null }) : err(toApiErrorBody(r.error).error);
      }
      default: {
        const unreachable: never = source;
        return unreachable;
      }
    }
  };
}

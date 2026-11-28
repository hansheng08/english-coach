// 音訊播放器（ARCHITECTURE §4.19）：同一時間只播一個來源；可重複與排隊播放。
// `audio/` 不直接連網、不 import `api/`：拿網址的函式由呼叫端注入（PlayerDeps.resolve）。
import { err, ok, tryCatchAsync } from '@english-coach/contracts';
import type { ApiErrorBody, Result, StoragePath } from '@english-coach/contracts';

type PlayerError = ApiErrorBody['error'];

export type PlaySource =
  | { readonly kind: 'text'; readonly text: string } // 呼叫 /tts
  | { readonly kind: 'path'; readonly path: StoragePath }; // 已有物件，只要 signed URL

export type PlayerState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly source: PlaySource }
  | { readonly kind: 'playing'; readonly source: PlaySource; readonly repeat: { readonly index: number; readonly total: number } }
  | { readonly kind: 'error'; readonly source: PlaySource; readonly error: PlayerError };

export type PlayerDeps = {
  readonly resolve: (source: PlaySource) => Promise<Result<{ readonly url: string; readonly durationMs: number | null }, PlayerError>>;
  readonly createAudio: () => HTMLAudioElement;
};

export interface AudioPlayer {
  /** 播 1 次或 repeat 次（每個來源各 repeat 次）；傳多個來源就依序播。新的 play 會先停掉正在播的（舊的回 `ok('stopped')`）。 */
  play(sources: PlaySource | readonly PlaySource[], opts?: { readonly repeat?: number }): Promise<Result<'ended' | 'stopped', PlayerError>>;
  stop(): void;
  getState(): PlayerState;
  /** 回傳取消訂閱的函式。 */
  subscribe(listener: (state: PlayerState) => void): () => void;
}

/** 一次 `play` 的控制代碼：取消時停掉 `<audio>` 並喚醒正在等待的那一步。 */
type Run = { cancelled: boolean; onCancel: (() => void) | null };

/** `await` 之間別的呼叫會改 `cancelled`；經函式讀取，避免被當成不變的值。 */
const isCancelled = (run: Run): boolean => run.cancelled;

const isList =(s: PlaySource | readonly PlaySource[]): s is readonly PlaySource[] => Array.isArray(s);

const audioFailed = (): PlayerError => ({ kind: 'internal', message: 'audio playback failed', retryable: true });

export function createAudioPlayer(deps: PlayerDeps): AudioPlayer {
  let state: PlayerState = { kind: 'idle' };
  const listeners = new Set<(s: PlayerState) => void>();
  let element: HTMLAudioElement | null = null;
  let active: Run | null = null;

  const setState = (next: PlayerState): void => {
    state = next;
    for (const listener of [...listeners]) listener(next);
  };
  /** 已被取消的 run 不再改狀態（新的 play 或 stop 已接手）。 */
  const emit = (run: Run, next: PlayerState): void => {
    if (!run.cancelled) setState(next);
  };
  const cancel = (run: Run): void => {
    run.cancelled = true;
    element?.pause();
    run.onCancel?.();
  };

  /** 同一個 `<audio>` 重複使用，所以同一時間一定只有一個在播。 */
  const audio = (): HTMLAudioElement => {
    element ??= deps.createAudio();
    return element;
  };

  function playOnce(url: string, run: Run): Promise<'ended' | 'error' | 'stopped'> {
    const el = audio();
    return new Promise((resolve) => {
      const finish = (outcome: 'ended' | 'error' | 'stopped'): void => {
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('error', onError);
        run.onCancel = null;
        resolve(outcome);
      };
      const onEnded = (): void => {
        finish('ended');
      };
      const onError = (): void => {
        finish('error');
      };
      run.onCancel = () => {
        finish('stopped');
      };
      el.addEventListener('ended', onEnded);
      el.addEventListener('error', onError);
      el.src = url;
      el.play().catch(() => {
        finish('error');
      });
    });
  }

  async function playAll(list: readonly PlaySource[], total: number, run: Run): Promise<Result<'ended' | 'stopped', PlayerError>> {
    for (const source of list) {
      emit(run, { kind: 'loading', source });
      const attempt = await tryCatchAsync(
        async () => await deps.resolve(source),
        (): PlayerError => audioFailed(),
      );
      if (run.cancelled) return ok('stopped');
      const resolved = attempt.ok ? attempt.value : attempt;
      if (!resolved.ok) {
        emit(run, { kind: 'error', source, error: resolved.error });
        active = active === run ? null : active;
        return err(resolved.error);
      }
      for (let index = 0; index < total; index++) {
        emit(run, { kind: 'playing', source, repeat: { index, total } });
        const outcome = await playOnce(resolved.value.url, run);
        if (outcome === 'stopped' || isCancelled(run)) return ok('stopped');
        if (outcome === 'error') {
          const error = audioFailed();
          emit(run, { kind: 'error', source, error });
          active = active === run ? null : active;
          return err(error);
        }
      }
    }
    emit(run, { kind: 'idle' });
    active = active === run ? null : active;
    return ok('ended');
  }

  return {
    play(sources, opts) {
      const list = isList(sources) ? sources : [sources];
      const total = Math.max(1, Math.floor(opts?.repeat ?? 1));
      if (active !== null) cancel(active);
      const run: Run = { cancelled: false, onCancel: null };
      active = run;
      return playAll(list, total, run);
    },
    stop() {
      if (active !== null) cancel(active);
      active = null;
      if (state.kind !== 'idle') setState({ kind: 'idle' });
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

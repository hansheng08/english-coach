import type { RegisterSW } from './update';

/*
 * Service Worker 註冊。不用 virtual:pwa-register：它需要 workbox-window，而任務單不准加 workbox 相關依賴
 * （CLAUDE.md §5 第 5 條）。generateSW 產生的 sw.js 收到 { type: 'SKIP_WAITING' } 訊息就會接手（registerType: 'prompt'）。
 * 下面的 *Like 型別只列用到的成員，真的 ServiceWorkerContainer／Registration／ServiceWorker 都符合。
 */
export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface RegistrationLike {
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

export interface ContainerLike {
  readonly controller: unknown;
  register(scriptUrl: string, options?: { scope?: string }): Promise<RegistrationLike>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export const SW_URL = '/sw.js';

/**
 * 註冊 SW。已經有 SW 在控制這個頁面（controller 不是 null）、又有新的 SW 裝好在等待時，呼叫 onNeedRefresh；
 * 第一次安裝（沒有 controller）不算新版。回傳的函式把等待中的 SW 叫起來（SKIP_WAITING），接手後重新載入頁面一次。
 */
export function registerWith(options: { onNeedRefresh?: () => void }, container: ContainerLike | undefined, reload: () => void): ReturnType<RegisterSW> {
  if (container === undefined) return () => Promise.resolve();
  let registration: RegistrationLike | undefined;

  const waitingNotice = (reg: RegistrationLike) => {
    if (reg.waiting !== null && container.controller !== null) options.onNeedRefresh?.();
  };

  container.register(SW_URL, { scope: '/' }).then(
    (reg) => {
      registration = reg;
      waitingNotice(reg);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') waitingNotice(reg);
        });
      });
    },
    () => {
      // 註冊失敗（例如瀏覽器不允許）就當沒有 SW，App 照常用網路。
    },
  );

  return () => {
    const waiting = registration?.waiting ?? null;
    if (waiting === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let reloaded = false;
      container.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        reload();
        resolve();
      });
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  };
}

export const registerServiceWorker: RegisterSW = (options) =>
  registerWith(
    options,
    'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    () => {
      window.location.reload();
    },
  );

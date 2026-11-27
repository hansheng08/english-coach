import { registerServiceWorker } from './register';
import type { RegisterSW } from './register';

export type { RegisterSW };

/**
 * 「要不要現在顯示新版卡片」的唯一判斷點。本單恆為顯示；之後若加錄音中暫緩之類的條件，只改這裡。
 */
export function shouldShowUpdatePrompt(): boolean {
  return true;
}

/**
 * 有新版（SW 等待中）時呼叫 onNeedUpdate，並交出 apply（重新載入成新版）。不自動重整。
 * register 沒傳就用 register.ts 的 registerServiceWorker（不支援 SW 的環境它什麼都不做）。
 */
export function watchForUpdate(onNeedUpdate: (apply: () => Promise<void>) => void, register: RegisterSW = registerServiceWorker): void {
  const updateSW = register({
    onNeedRefresh() {
      if (shouldShowUpdatePrompt()) {
        onNeedUpdate(() => updateSW(true));
      }
    },
  });
}

/**
 * 只給預覽（mock）建置用：網址帶 ?pwa=update 時，一註冊就當成有新版，讓 E2E 與截圖不用真的換 SW 就能看到卡片。
 * apply 不做事（沒有真的新版可換）。
 */
export const previewUpdateRegister: RegisterSW = (options) => {
  options.onNeedRefresh?.();
  return () => Promise.resolve();
};

/** 只有預覽（mock）建置且網址帶 ?pwa=update 才用 previewUpdateRegister；其餘（含正式建置）一律真的註冊 SW。 */
export function chooseRegister(previewActive: boolean, search: string): RegisterSW {
  return previewActive && new URLSearchParams(search).get('pwa') === 'update' ? previewUpdateRegister : registerServiceWorker;
}

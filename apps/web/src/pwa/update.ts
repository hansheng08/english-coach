/** registerSW 的形狀（和 virtual:pwa-register 的相同；實作在 register.ts，不用那個虛擬模組，原因見該檔）。 */
export type RegisterSW = (options: { onNeedRefresh?: () => void }) => (reloadPage?: boolean) => Promise<void>;

/**
 * 「要不要現在顯示新版卡片」的唯一判斷點。本單恆為顯示；之後若加錄音中暫緩之類的條件，只改這裡。
 */
export function shouldShowUpdatePrompt(): boolean {
  return true;
}

/**
 * 有新版（SW 等待中）時呼叫 onNeedUpdate，並交出 apply（重新載入成新版）。不自動重整。
 * register 由呼叫端傳入（main.tsx 傳 register.ts 的 registerServiceWorker）；沒傳就什麼都不註冊。
 */
export function watchForUpdate(onNeedUpdate: (apply: () => Promise<void>) => void, register?: RegisterSW): void {
  if (register === undefined) return;
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

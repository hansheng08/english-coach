import type { ReactNode } from 'react';
import styles from './SysBars.module.css';

/** 頁面頂端的系統提示容器（pwa.md §3.1）：sticky、z-index 45；由上到下是預覽條、斷線條，推開內容。 */
export function SysBars({ children }: { readonly children: ReactNode }) {
  return <div className={styles['sysbars']}>{children}</div>;
}

/** 內容區。手機上新版卡片出現時，底部內距加大到 184px，最後一段內容不被卡片蓋住（pwa.md §3.3）。 */
export function ContentArea({ updateShown, children }: { readonly updateShown: boolean; readonly children: ReactNode }) {
  return <div className={updateShown ? styles['withUpdate'] : undefined}>{children}</div>;
}

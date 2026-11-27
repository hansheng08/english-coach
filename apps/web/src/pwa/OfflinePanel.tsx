import styles from './OfflinePanel.module.css';
import { OfflineIcon } from './icons';

/** 離線時開啟 App（外殼來自 precache）的內容區面板（pwa.md §3.2）。 */
export function OfflinePanel({ onReload }: { readonly onReload: () => void }) {
  return (
    <main className={styles['panel']}>
      <span className={styles['icon']}>
        <OfflineIcon size={32} />
      </span>
      <h1 className={styles['title']}>今天的課表要連網才能載入</h1>
      <p className={styles['body']}>App 外殼已經開好，但課表、字卡和紀錄都在雲端，不存在這台裝置。連上網路後按「重新載入」。</p>
      <button type="button" className={styles['reload']} onClick={onReload}>
        重新載入
      </button>
    </main>
  );
}

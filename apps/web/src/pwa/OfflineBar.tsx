import styles from './OfflineBar.module.css';
import { OfflineIcon } from './icons';

/** 離線時頁面頂端的整條提示（pwa.md §3.2）：不能關閉、沒有按鈕。 */
export function OfflineBar() {
  return (
    <div role="status" className={styles['bar']}>
      <span className={styles['icon']}>
        <OfflineIcon />
      </span>
      <strong className={styles['title']}>需要連網</strong>
      <span className={styles['detail']}>目前沒有網路，連上後再繼續。</span>
    </div>
  );
}

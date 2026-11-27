import { useState } from 'react';
import styles from './UpdateCard.module.css';
import { UpdateIcon } from './icons';

/**
 * 有新版時的浮動卡片（pwa.md §3.3）：沒有「稍後」也沒有關閉鈕，留到按下「更新」；不搶焦點；
 * 按下後呼叫 apply 一次，處理中按鈕 disabled。
 */
export function UpdateCard({ apply }: { readonly apply: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const onUpdate = () => {
    if (busy) return;
    setBusy(true);
    apply().then(
      () => {
        setBusy(false);
      },
      () => {
        setBusy(false);
      },
    );
  };

  return (
    <div role="status" className={styles['card']}>
      <span className={styles['icon']}>
        <UpdateIcon />
      </span>
      <div className={styles['text']}>
        <strong className={styles['title']}>有新版本</strong>
        <span className={styles['detail']}>按更新會重新載入頁面。</span>
      </div>
      <button type="button" className={styles['update']} disabled={busy} onClick={onUpdate}>
        更新
      </button>
    </div>
  );
}

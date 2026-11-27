import styles from './PreviewBanner.module.css';
import { BeakerIcon } from './icons';

/** 預覽（mock）才顯示，不能關閉（ARCHITECTURE §9.1.1、pwa.md §3.4）。 */
export function PreviewBanner({ marker, unknownScenario }: { readonly marker: string; readonly unknownScenario: string | null }) {
  return (
    <div role="note" className={styles['bar']} data-mock={marker}>
      <span className={styles['icon']}>
        <BeakerIcon />
      </span>
      <strong className={styles['title']}>預覽：假資料</strong>
      {unknownScenario === null ? (
        <span className={styles['detail']}>資料只在這個分頁，重新整理就回到初始狀態。</span>
      ) : (
        <span className={styles['unknown']}>{`未知情境「${unknownScenario}」，改用 default`}</span>
      )}
    </div>
  );
}

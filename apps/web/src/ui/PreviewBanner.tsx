import styles from './PreviewBanner.module.css';

/** mock 模式每頁頂端的標示（ARCHITECTURE §9.1.1）。名稱當純文字顯示，不當 HTML。 */
export function PreviewBanner({ unknownScenario }: { readonly unknownScenario: string | null }) {
  return (
    <div className={styles.banner} role="status">
      <strong className={styles.label}>預覽：假資料</strong>
      {unknownScenario !== null && <span>{`未知情境「${unknownScenario}」，改用 default`}</span>}
    </div>
  );
}

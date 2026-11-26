import { AccountMenu } from '../../ui/index.ts';
import styles from './HomePage.module.css';

// 本單只有頁面外殼：右上頭像（主題切換入口）。今日任務內容是 T-026。
export function HomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <h1 className={styles.title}>今天</h1>
        <AccountMenu />
      </header>
      <main className={styles.main}>
        <p className={styles.hint}>今天的練習之後會出現在這裡。</p>
      </main>
    </div>
  );
}

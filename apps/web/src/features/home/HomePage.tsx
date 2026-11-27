import { AccountMenu } from '../../ui/AccountMenu';
import styles from './HomePage.module.css';

/** 本單只有頁面外殼：右上頭像（主題切換入口）。今日任務內容是 T-026。 */
export function HomePage() {
  return (
    <div className={styles['page']}>
      <header className={styles['top']}>
        <span className={styles['brand']}>English Coach</span>
        <AccountMenu />
      </header>
      <main className={styles['main']}>
        <h1 className={styles['title']}>今天</h1>
        <p className={styles['hint']}>今日任務會顯示在這裡。</p>
      </main>
    </div>
  );
}

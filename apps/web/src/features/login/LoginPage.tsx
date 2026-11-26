import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/index.ts';
import styles from './LoginPage.module.css';

const PORTIONS = ['1 篇科技新聞', '5 句跟讀', '25 張字卡', '1 題面試題'] as const;

export function LoginPage() {
  const { client } = useApi();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  const submit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    const r = await client.signInWithPassword(email, password);
    setBusy(false);
    if (r.ok) {
      setFailed(false);
      void navigate('/', { replace: true });
    } else {
      setFailed(true);
    }
  };

  return (
    <main className={styles.page}>
      <aside className={styles.focus} aria-label="今天的份量">
        <p className={styles.eyebrow}>English Coach</p>
        <h2 className={styles.promise}>每天 80 分鐘，把英文講得像 Senior。</h2>
        <ul className={styles.portions}>
          {PORTIONS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </aside>
      <section className={styles.formSide}>
        <form
          className={styles.form}
          noValidate
          onSubmit={(e) => {
            void submit(e);
          }}
        >
          <header className={styles.brand}>
            <p className={styles.name}>English Coach</p>
            <h1 className={styles.title}>登入</h1>
            <p className={styles.sub}>登入後開始今天的練習。</p>
          </header>
          <div className={styles.field}>
            <label htmlFor="login-email" className={styles.label}>
              Email
            </label>
            <input
              id="login-email"
              type="email"
              name="email"
              autoComplete="username"
              className={styles.input}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="login-password" className={styles.label}>
              密碼
            </label>
            <input
              id="login-password"
              type="password"
              name="password"
              autoComplete="current-password"
              className={failed ? [styles.input, styles.invalid].join(' ') : styles.input}
              aria-invalid={failed ? 'true' : undefined}
              aria-describedby={failed ? errorId : undefined}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
            {failed && (
              <p id={errorId} className={styles.error}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v6M12 16.5v.5" />
                </svg>
                <span>Email 或密碼不對，再試一次。</span>
              </p>
            )}
          </div>
          <button type="submit" className={styles.submit} disabled={busy}>
            登入
          </button>
          <p className={styles.note}>連線加密。履歷與錄音只供你自己練習。</p>
        </form>
      </section>
    </main>
  );
}

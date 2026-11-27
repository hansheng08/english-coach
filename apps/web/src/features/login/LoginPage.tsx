import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../api';
import { AlertIcon } from '../../ui/icons';
import styles from './LoginPage.module.css';
import { validateLogin } from './validate';

const PORTIONS = ['1 篇科技新聞', '5 句跟讀', '25 張字卡', '1 題面試題'] as const;

type FormNotice = 'offline' | 'service' | null;
type FormState = { readonly email: string | null; readonly password: string | null; readonly notice: FormNotice };
const CLEAN: FormState = { email: null, password: null, notice: null };

const NOTICES = {
  offline: { title: '需要連網才能登入', body: '目前沒有網路。連上網路後再按一次「登入」。' },
  service: { title: '現在登不進去', body: '登入服務沒有回應或暫時出錯。輸入的內容已保留，稍後再按一次「登入」。' },
} as const;

/** 登入頁（login.md）。不放註冊、社群登入、忘記密碼。 */
export function LoginPage() {
  const { client } = useApi();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problems, setProblems] = useState<FormState>(CLEAN);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  // 表單訊息出現、按鈕恢復可按之後，焦點才能移到「登入」（disabled 的按鈕不能取得焦點）。
  useEffect(() => {
    if (problems.notice !== null && !busy) submitRef.current?.focus();
  }, [problems.notice, busy]);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const found = validateLogin(email, password);
    if (found.email !== null || found.password !== null) {
      setProblems({ ...found, notice: null });
      (found.email === null ? passwordRef : emailRef).current?.focus();
      return;
    }
    setProblems(CLEAN);
    if (!navigator.onLine) {
      setProblems({ ...CLEAN, notice: 'offline' });
      submitRef.current?.focus();
      return;
    }
    setBusy(true);
    void client.signInWithPassword(email.trim(), password).then((result) => {
      setBusy(false);
      if (result.ok) {
        void navigate('/', { replace: true });
      } else if (result.error.kind === 'unauthenticated') {
        setProblems({ email: null, password: 'Email 或密碼不對，再試一次。', notice: null });
      } else {
        setProblems({ email: null, password: null, notice: navigator.onLine ? 'service' : 'offline' });
      }
    });
  };

  const notice = problems.notice === null ? null : NOTICES[problems.notice];

  return (
    <div className={styles['page']}>
      <aside className={styles['hero']}>
        <p className={styles['heroLabel']}>English Coach</p>
        <p className={styles['heroTitle']}>每天 80 分鐘，把英文講得像 Senior。</p>
        <p className={styles['heroSub']}>今天的份量</p>
        <ul className={styles['portions']}>
          {PORTIONS.map((portion) => (
            <li key={portion}>{portion}</li>
          ))}
        </ul>
      </aside>
      <main className={styles['side']}>
        <form className={styles['form']} noValidate onSubmit={submit}>
          <p className={styles['brand']}>English Coach</p>
          <h1 className={styles['title']}>登入</h1>
          <p className={styles['lead']}>登入後開始今天的練習。</p>

          {notice === null ? null : (
            <div role="alert" className={styles['alert']}>
              <span className={styles['alertIcon']}>
                <AlertIcon />
              </span>
              <div>
                <strong className={styles['alertTitle']}>{notice.title}</strong>
                <p className={styles['alertBody']}>{notice.body}</p>
              </div>
            </div>
          )}

          <div className={styles['field']}>
            <label htmlFor="login-email" className={styles['label']}>
              Email
            </label>
            <input
              ref={emailRef}
              id="login-email"
              type="email"
              autoComplete="username"
              className={styles['input']}
              value={email}
              aria-invalid={problems.email === null ? undefined : true}
              aria-describedby={problems.email === null ? undefined : 'login-email-error'}
              onChange={(e) => {
                setEmail(e.target.value);
                setProblems((p) => ({ ...p, email: null }));
              }}
            />
            {problems.email === null ? null : (
              <p id="login-email-error" className={styles['hintError']}>
                <AlertIcon />
                {problems.email}
              </p>
            )}
          </div>

          <div className={styles['field']}>
            <label htmlFor="login-password" className={styles['label']}>
              密碼
            </label>
            <input
              ref={passwordRef}
              id="login-password"
              type="password"
              autoComplete="current-password"
              className={styles['input']}
              value={password}
              aria-invalid={problems.password === null ? undefined : true}
              aria-describedby={problems.password === null ? undefined : 'login-password-error'}
              onChange={(e) => {
                setPassword(e.target.value);
                setProblems((p) => ({ ...p, password: null }));
              }}
            />
            {problems.password === null ? null : (
              <p id="login-password-error" className={styles['hintError']}>
                <AlertIcon />
                {problems.password}
              </p>
            )}
          </div>

          <button ref={submitRef} type="submit" className={styles['submit']} disabled={busy} aria-busy={busy}>
            {busy ? '登入中…' : '登入'}
          </button>
          <p className={styles['footnote']}>連線加密。履歷與錄音只供你自己練習。</p>
        </form>
      </main>
    </div>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { ThemeControl } from './ThemeControl.tsx';
import styles from './AccountMenu.module.css';

/** 右上頭像 →「帳號與外觀」：<900px 底部 sheet，≥900px 右上 popover（同一個元素，版面由 CSS 切換）。 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const selectedRadioRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    selectedRadioRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        avatarRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.wrap}>
      <button
        ref={avatarRef}
        type="button"
        className={styles.avatar}
        aria-label="帳號與外觀"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      </button>
      {open && (
        <>
          <button
            type="button"
            className={styles.scrim}
            aria-label="關閉"
            tabIndex={-1}
            onClick={() => {
              setOpen(false);
            }}
          />
          <div role="dialog" aria-labelledby={titleId} className={styles.panel}>
            <div className={styles.handle} aria-hidden="true" />
            <h2 id={titleId} className={styles.title}>
              帳號與外觀
            </h2>
            <ThemeControl firstRadioRef={selectedRadioRef} />
          </div>
        </>
      )}
    </div>
  );
}

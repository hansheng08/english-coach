import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './AccountMenu.module.css';
import { CloseIcon, HalfIcon, MoonIcon, PersonIcon, SunIcon } from './icons';
import { readThemePreference, setThemePreference } from './theme';
import type { ThemePreference } from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 作業系統目前是不是深色；系統設定改變時（不用重新載入）跟著變（AC-27）。 */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const sync = () => {
      setDark(query.matches);
    };
    sync();
    query.addEventListener('change', sync);
    return () => {
      query.removeEventListener('change', sync);
    };
  }, []);
  return dark;
}

const OPTIONS: readonly { readonly value: ThemePreference; readonly label: string; readonly icon: ReactNode }[] = [
  { value: 'light', label: '淺色', icon: <SunIcon /> },
  { value: 'dark', label: '深色', icon: <MoonIcon /> },
  { value: 'system', label: '跟隨系統', icon: <HalfIcon /> },
];

function describeTheme(pref: ThemePreference, systemDark: boolean): string {
  const now = systemDark ? '深色' : '淺色';
  switch (pref) {
    case 'system':
      return `跟隨系統，現在是${now}。只存在這台裝置。`;
    case 'light':
      return '現在是淺色。只存在這台裝置。';
    case 'dark':
      return '現在是深色。只存在這台裝置。';
    default: {
      const unreachable: never = pref;
      return unreachable;
    }
  }
}

/** 右上頭像：手機開底部 sheet、電腦開右上 popover（切換由 CSS 的 900px 斷點決定）。 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useState<ThemePreference>(() => readThemePreference());
  const systemDark = useSystemDark();
  const titleId = useId();
  const avatarRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const checked = panelRef.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    checked?.focus();
    const avatar = avatarRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      avatar?.focus();
    };
  }, [open]);

  const choose = (value: ThemePreference) => {
    setPref(value);
    setThemePreference(value);
  };

  return (
    <div className={styles['anchor']}>
      <button
        ref={avatarRef}
        type="button"
        className={styles['avatar']}
        aria-label="帳號與外觀"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <PersonIcon />
      </button>
      {open ? (
        <>
          <div
            className={styles['scrim']}
            aria-hidden="true"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div ref={panelRef} role="dialog" aria-labelledby={titleId} className={styles['panel']}>
            <div className={styles['grip']} aria-hidden="true" />
            <div className={styles['head']}>
              <h2 id={titleId} className={styles['title']}>
                帳號與外觀
              </h2>
              <button
                type="button"
                className={styles['close']}
                aria-label="關閉"
                onClick={() => {
                  setOpen(false);
                }}
              >
                <CloseIcon />
              </button>
            </div>
            <div role="radiogroup" aria-label="外觀" className={styles['seg']}>
              {OPTIONS.map((option) => (
                <label key={option.value} className={styles['item']}>
                  <input
                    type="radio"
                    name="ec-theme-choice"
                    className={styles['input']}
                    value={option.value}
                    checked={pref === option.value}
                    onChange={() => {
                      choose(option.value);
                    }}
                  />
                  <span className={styles['face']}>
                    {option.icon}
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
            <p className={styles['note']} aria-live="polite">
              {describeTheme(pref, systemDark)}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

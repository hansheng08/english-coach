import { useEffect, useState } from 'react';
import type { Ref } from 'react';
import { readThemePreference, setThemePreference } from './theme.ts';
import type { ThemePreference } from './theme.ts';
import styles from './ThemeControl.module.css';

const DARK_QUERY = '(prefers-color-scheme: dark)';

// 順序：淺色（太陽）／深色（月亮）／跟隨系統（半圓）
const OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'light', label: '淺色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟隨系統' },
];

function Icon({ value }: { readonly value: ThemePreference }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true } as const;
  switch (value) {
    case 'light':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case 'dark':
      return (
        <svg {...common}>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </svg>
      );
    case 'system':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
        </svg>
      );
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/** 系統目前是不是深色；作業系統改變時不重新載入就更新。 */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (): void => {
      setDark(mql.matches);
    };
    setDark(mql.matches);
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, []);
  return dark;
}

export function describeTheme(pref: ThemePreference, systemDark: boolean): string {
  const now = (pref === 'system' ? systemDark : pref === 'dark') ? '深色' : '淺色';
  return pref === 'system' ? `跟隨系統，現在是${now}。只存在這台裝置。` : `現在是${now}。只存在這台裝置。`;
}

export function ThemeControl({ firstRadioRef }: { readonly firstRadioRef?: Ref<HTMLInputElement> }) {
  const [pref, setPref] = useState<ThemePreference>(() => readThemePreference());
  const systemDark = useSystemDark();

  return (
    <div className={styles.root}>
      <div role="radiogroup" aria-label="外觀" className={styles.seg}>
        {OPTIONS.map((o) => (
          <label key={o.value} className={styles.cell}>
            <input
              type="radio"
              name="ec-theme"
              value={o.value}
              checked={pref === o.value}
              ref={pref === o.value ? firstRadioRef : undefined}
              onChange={() => {
                setThemePreference(o.value);
                setPref(o.value);
              }}
              className={styles.input}
            />
            <span className={styles.face}>
              <Icon value={o.value} />
              <span>{o.label}</span>
            </span>
          </label>
        ))}
      </div>
      <p className={styles.note} aria-live="polite">
        {describeTheme(pref, systemDark)}
      </p>
    </div>
  );
}

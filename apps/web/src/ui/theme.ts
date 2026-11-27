export type ThemePreference = 'system' | 'light' | 'dark';

/** 與 index.html 的 inline script 用同一個字串（測試會讀 index.html 比對）。 */
export const THEME_STORAGE_KEY = 'ec-theme';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const isPreference = (v: unknown): v is ThemePreference => v === 'system' || v === 'light' || v === 'dark';

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 沒有值、值不合法、或 getItem 丟例外，都當 system（ARCHITECTURE §9.1.4）。 */
export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  const source = storage ?? defaultStorage();
  if (source === null) return 'system';
  try {
    const value = source.getItem(THEME_STORAGE_KEY);
    return isPreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** 寫入 ec-theme（system 也寫），light／dark 設 <html data-theme>，system 移除。setItem 丟例外時 data-theme 照樣更新。 */
export function setThemePreference(pref: ThemePreference, storage?: Pick<Storage, 'setItem'>, root?: HTMLElement): void {
  const target = root ?? document.documentElement;
  const sink = storage ?? defaultStorage();
  if (sink !== null) {
    try {
      sink.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // 儲存失敗（私密模式、容量滿）不影響這次的畫面。
    }
  }
  if (pref === 'system') delete target.dataset['theme'];
  else target.dataset['theme'] = pref;
}

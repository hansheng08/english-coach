// ARCHITECTURE §9.1.4、ADR-014：偏好只存在這台裝置的 localStorage['ec-theme']，只透過這個檔案讀寫。
// key 字串要和 index.html 的 inline script 一致（測試會讀 index.html 檢查）。

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'ec-theme';

const isPreference = (v: unknown): v is ThemePreference => v === 'system' || v === 'light' || v === 'dark';

/** 沒有值、值不合法或 getItem 丟例外，都當 system。 */
export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    const value = (storage ?? window.localStorage).getItem(THEME_STORAGE_KEY);
    return isPreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** 先套用（light／dark 設 data-theme，system 移除），再寫入；setItem 丟例外時不往外丟，data-theme 照樣更新。 */
export function setThemePreference(
  pref: ThemePreference,
  storage?: Pick<Storage, 'setItem'>,
  root?: HTMLElement,
): void {
  const target = root ?? document.documentElement;
  if (pref === 'system') target.removeAttribute('data-theme');
  else target.setAttribute('data-theme', pref);
  try {
    (storage ?? window.localStorage).setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // 儲存不可用（無痕模式、被封鎖）：這次工作階段仍然套用
  }
}

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
  // data-theme 設好後，讀 --color-theme-bar 的計算值給 theme-color（ADR-014 決定 4）。
  if (root === undefined) syncThemeColor(pref);
}

const THEME_COLOR_LIGHT = '(prefers-color-scheme: light)';
const THEME_COLOR_DARK = '(prefers-color-scheme: dark)';

/** index.html 的兩個 theme-color 值；system 時恢復它們（值由測試對照 tokens.json 的 color.theme-bar）。 */
const SYSTEM_THEME_COLORS: readonly { readonly media: string; readonly content: string }[] = [
  { media: THEME_COLOR_LIGHT, content: '#F4F5F7' },
  { media: THEME_COLOR_DARK, content: '#0A1420' },
];

/**
 * theme-color meta：system → 兩個帶 media 的 meta；light／dark → 只留一個不帶 media 的 meta，值是傳入的 color。
 * 重複呼叫不會多出 meta。
 */
export function applyThemeColor(pref: ThemePreference, color: string, head?: HTMLHeadElement): void {
  const target = head ?? document.head;
  const existing = [...target.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const make = (content: string, media: string | null): HTMLMetaElement => {
    const meta = target.ownerDocument.createElement('meta');
    meta.name = 'theme-color';
    if (media !== null) meta.setAttribute('media', media);
    meta.content = content;
    return meta;
  };
  const wanted = pref === 'system' ? SYSTEM_THEME_COLORS.map((c) => make(c.content, c.media)) : [make(color, null)];
  // 新的 meta 放在舊的第一個的位置（維持 index.html 的順序），再移除舊的。
  const reference = existing[0] ?? null;
  for (const meta of wanted) target.insertBefore(meta, reference);
  for (const meta of existing) meta.remove();
}

/** 啟動時（main.tsx）與 setThemePreference 之後呼叫：依目前偏好與 data-theme 設好 theme-color。 */
export function syncThemeColor(pref: ThemePreference = readThemePreference()): void {
  const color = currentThemeBarColor();
  if (pref !== 'system' && color === '') return; // 讀不到 token（例如測試環境沒有樣式）時保持原樣
  applyThemeColor(pref, color);
}

function currentThemeBarColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-theme-bar').trim();
}

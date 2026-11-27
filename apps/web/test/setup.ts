import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

type Entry = { readonly query: string; readonly listener: EventListener };

const DARK = '(prefers-color-scheme: dark)';
const LIGHT = '(prefers-color-scheme: light)';

let systemDark = false;
const entries = new Set<Entry>();

const matchesNow = (query: string): boolean => (query === DARK ? systemDark : query === LIGHT ? !systemDark : false);

/** 測試用：改變「作業系統是深色」並通知所有 change 監聽者（元件測試用 import { setSystemDark } from '../test/setup'）。 */
export function setSystemDark(dark: boolean): void {
  systemDark = dark;
  for (const entry of [...entries]) entry.listener(new Event('change'));
}

/** 只實作 App 用到的 MediaQueryList 成員（matches、media、addEventListener、removeEventListener）。 */
function stubMatchMedia(query: string) {
  return {
    media: query,
    get matches() {
      return matchesNow(query);
    },
    onchange: null,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      if (type === 'change' && typeof listener === 'function') entries.add({ query, listener });
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      if (type !== 'change') return;
      for (const entry of entries) {
        if (entry.query === query && entry.listener === listener) entries.delete(entry);
      }
    },
    dispatchEvent: () => false,
  };
}

beforeEach(() => {
  systemDark = false;
  entries.clear();
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: stubMatchMedia });
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset['theme'];
  window.localStorage.clear();
});

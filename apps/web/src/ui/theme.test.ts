// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import '../../test/setup';
import html from '../../index.html?raw';
import tokensRaw from '../../../../docs/design/tokens.json?raw';
import { THEME_STORAGE_KEY, applyThemeColor, readThemePreference, setThemePreference } from './theme';

const LIGHT_BAR = '#F4F5F7';
const DARK_BAR = '#0A1420';

function headWithSystemMetas(): HTMLHeadElement {
  const head = document.createElement('head');
  head.innerHTML = `<meta name="color-scheme" content="light dark" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${LIGHT_BAR}" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${DARK_BAR}" />
<script></script>`;
  return head;
}

const themeMetas = (head: HTMLHeadElement) =>
  [...head.querySelectorAll('meta[name="theme-color"]')].map((m) => ({ media: m.getAttribute('media'), content: m.getAttribute('content') }));

function themeBarTokens(): { light: string; dark: string } {
  const parsed: unknown = JSON.parse(tokensRaw);
  const bar = (parsed as { color: { 'theme-bar': { light: string; dark: string } } }).color['theme-bar'];
  return bar;
}

describe('theme-color (T-019)', () => {
  it('(AC-T19-11) (TC-15) index.html has the light then dark theme-color metas between color-scheme and the inline script, equal to tokens color.theme-bar', () => {
    const tokens = themeBarTokens();
    expect(tokens.light).toBe(LIGHT_BAR);
    expect(tokens.dark).toBe(DARK_BAR);
    const lightMeta = `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${tokens.light}" />`;
    const darkMeta = `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${tokens.dark}" />`;
    const at = (needle: string) => html.indexOf(needle);
    const order = [at('name="color-scheme"'), at(lightMeta), at(darkMeta), at('<script>')];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/name="theme-color"/g)).toHaveLength(2);
  });

  it('(AC-T19-12) (TC-16) a manual choice leaves one theme-color without media, with the given value', () => {
    const head = headWithSystemMetas();
    applyThemeColor('dark', DARK_BAR, head);
    expect(themeMetas(head)).toEqual([{ media: null, content: DARK_BAR }]);
    applyThemeColor('light', LIGHT_BAR, head);
    expect(themeMetas(head)).toEqual([{ media: null, content: LIGHT_BAR }]);
    expect(head.firstElementChild?.getAttribute('name')).toBe('color-scheme');
    expect(head.lastElementChild?.tagName).toBe('SCRIPT');
  });

  it('(AC-T19-12) (TC-17) back to system restores both media metas, and repeated calls never add metas', () => {
    const head = headWithSystemMetas();
    applyThemeColor('dark', DARK_BAR, head);
    applyThemeColor('system', LIGHT_BAR, head);
    expect(themeMetas(head)).toEqual([
      { media: '(prefers-color-scheme: light)', content: LIGHT_BAR },
      { media: '(prefers-color-scheme: dark)', content: DARK_BAR },
    ]);
    applyThemeColor('dark', DARK_BAR, head);
    applyThemeColor('dark', DARK_BAR, head);
    expect(themeMetas(head)).toHaveLength(1);
    applyThemeColor('system', DARK_BAR, head);
    applyThemeColor('system', DARK_BAR, head);
    expect(themeMetas(head)).toHaveLength(2);
  });

  it('(AC-T19-12) (TC-16) with no theme-color at all, one is added to the given head', () => {
    const head = document.createElement('head');
    applyThemeColor('light', LIGHT_BAR, head);
    expect(themeMetas(head)).toEqual([{ media: null, content: LIGHT_BAR }]);
  });
});

const storageWith = (value: string | null) => ({ getItem: () => value });
const throwingGet = {
  getItem: () => {
    throw new Error('denied');
  },
};

describe('theme.ts', () => {
  it('(AC-T18-10) (TC-17) reads the preference, falling back to system', () => {
    expect(readThemePreference(storageWith(null))).toBe('system');
    expect(readThemePreference(storageWith('dark'))).toBe('dark');
    expect(readThemePreference(storageWith('light'))).toBe('light');
    expect(readThemePreference(storageWith('DARK'))).toBe('system');
    expect(readThemePreference(throwingGet)).toBe('system');
  });

  it('(AC-T18-10) (TC-18) writes ec-theme and sets or removes data-theme', () => {
    const root = document.createElement('div');
    const setItem = vi.fn();
    setThemePreference('dark', { setItem }, root);
    expect(setItem).toHaveBeenCalledWith('ec-theme', 'dark');
    expect(root.dataset['theme']).toBe('dark');
    setThemePreference('system', { setItem }, root);
    expect(setItem).toHaveBeenLastCalledWith('ec-theme', 'system');
    expect(root.dataset['theme']).toBeUndefined();
  });

  it('(AC-T18-10) (TC-18) a throwing setItem is swallowed and data-theme is still updated', () => {
    const root = document.createElement('div');
    const setItem = () => {
      throw new Error('quota');
    };
    expect(() => {
      setThemePreference('light', { setItem }, root);
    }).not.toThrow();
    expect(root.dataset['theme']).toBe('light');
  });

  it('(AC-T18-10) (TC-18) defaults to localStorage and document.documentElement', () => {
    setThemePreference('dark');
    expect(window.localStorage.getItem('ec-theme')).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(readThemePreference()).toBe('dark');
  });

  it('(AC-T18-10) (TC-19) the key in index.html matches THEME_STORAGE_KEY', () => {
    expect(THEME_STORAGE_KEY).toBe('ec-theme');
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  it('(AC-T18-12) (TC-23) <head> order: charset, viewport, color-scheme, inline script, then the module script', () => {
    const at = (needle: string) => html.indexOf(needle);
    const order = [at('<meta charset'), at('name="viewport"'), at('name="color-scheme" content="light dark"'), at('<script>'), at('<script type="module"')];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).toMatch(/<html lang="zh-Hant-TW">/);
  });
});

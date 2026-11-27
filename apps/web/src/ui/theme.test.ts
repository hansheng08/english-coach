// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import '../../test/setup';
import html from '../../index.html?raw';
import { THEME_STORAGE_KEY, readThemePreference, setThemePreference } from './theme';

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

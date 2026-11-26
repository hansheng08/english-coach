// @vitest-environment jsdom
import '../../test/setup.ts';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, readThemePreference, setThemePreference } from './theme.ts';

const storageWith = (value: string | null) => ({ getItem: () => value });

describe('theme preference', () => {
  it('(AC-T18-10) (TC-17) reads the stored value; missing, invalid or throwing storage → system', () => {
    expect(readThemePreference(storageWith(null))).toBe('system');
    expect(readThemePreference(storageWith('dark'))).toBe('dark');
    expect(readThemePreference(storageWith('light'))).toBe('light');
    expect(readThemePreference(storageWith('DARK'))).toBe('system');
    expect(
      readThemePreference({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('system');
  });

  it('(AC-T18-10) (TC-18) writes ec-theme and sets / removes data-theme; a throwing setItem is swallowed', () => {
    const root = document.createElement('html');
    const written = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void written.set(k, v) };

    setThemePreference('dark', storage, root);
    expect(written.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');

    setThemePreference('system', storage, root);
    expect(written.get(THEME_STORAGE_KEY)).toBe('system');
    expect(root.hasAttribute('data-theme')).toBe(false);

    const broken = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => {
      setThemePreference('light', broken, root);
    }).not.toThrow();
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('(AC-T18-10) (TC-18) the key is ec-theme', () => {
    expect(THEME_STORAGE_KEY).toBe('ec-theme');
  });
});

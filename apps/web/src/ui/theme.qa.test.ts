// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, readThemePreference, setThemePreference } from './theme';

// QA probes for T-018 AC-T18-10.
afterEach(() => {
  delete document.documentElement.dataset['theme'];
  window.localStorage.clear();
});

describe('T-018 QA theme', () => {
  it('(QA-7) only exact light/dark/system are accepted', () => {
    const cases = [
      ['system', 'system'],
      ['light', 'light'],
      ['dark', 'dark'],
      ['Light', 'system'],
      [' dark', 'system'],
      ['', 'system'],
      ['blue', 'system'],
    ] as const;
    for (const [stored, want] of cases) expect(readThemePreference({ getItem: () => stored })).toBe(want);
  });

  it('(QA-8) system is written to storage too, and switching back removes data-theme', () => {
    const writes: [string, string][] = [];
    const sink = {
      setItem: (k: string, v: string) => {
        writes.push([k, v]);
      },
    };
    const root = document.createElement('div');
    setThemePreference('dark', sink, root);
    expect(root.dataset['theme']).toBe('dark');
    setThemePreference('system', sink, root);
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(writes).toEqual([
      [THEME_STORAGE_KEY, 'dark'],
      [THEME_STORAGE_KEY, 'system'],
    ]);
  });

  it('(QA-9) the default storage round-trips through localStorage', () => {
    setThemePreference('light');
    expect(window.localStorage.getItem('ec-theme')).toBe('light');
    expect(readThemePreference()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});

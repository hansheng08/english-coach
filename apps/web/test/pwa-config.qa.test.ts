import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ICONS, createManifest, createPwaOptions, emitIcons, heroLightColor, loadIcons } from '../vite.pwa.ts';

// QA probes for T-019 AC-T19-1～3、AC-T19-14（pwa.md §1、§2，ARCHITECTURE §9）。
const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const TOKENS = { color: { hero: { light: '#111111', dark: '#222222' } } };
const message = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '';
};

describe('T-019 QA manifest and service worker options', () => {
  it('(QA-7) the manifest has exactly the pwa.md §1 keys (no orientation, no extra keys) and colors from the input only', () => {
    const m = createManifest(TOKENS);
    expect(Object.keys(m).sort()).toEqual(
      ['background_color', 'description', 'dir', 'display', 'icons', 'lang', 'name', 'scope', 'short_name', 'start_url', 'theme_color'].sort(),
    );
    expect(m.theme_color).toBe('#111111');
    expect(m.background_color).toBe('#111111');
    expect(m.icons.map((i) => i.src)).toEqual(ICONS.map((i) => `/icons/${i.file}`));
    expect(m.icons.every((i) => i.type === 'image/png' && !i.purpose.includes(' '))).toBe(true);
  });

  it('(QA-8) hero light must be a string: dark only, a number or a missing group all fail', () => {
    for (const bad of [{ color: { hero: { dark: '#000' } } }, { color: { hero: { light: 1 } } }, { color: {} }, null, []]) {
      expect(message(() => heroLightColor(bad))).toContain('color.hero.light');
    }
  });

  it('(QA-9) precache is shell only: no runtime caching, no catch-all glob, no json, images only under icons/', () => {
    const options = createPwaOptions(TOKENS);
    const workbox = options.workbox ?? {};
    expect(workbox.runtimeCaching).toBeUndefined();
    const globs = workbox.globPatterns ?? [];
    expect(globs).not.toContain('**/*');
    for (const g of globs) {
      expect(g).not.toMatch(/[{,.](json|mp3|wav|m4a|webm|ogg)(?=[},]|$)/);
      if (/png|jpe?g|webp|svg/.test(g)) expect(g.startsWith('icons/')).toBe(true);
    }
    expect(options.registerType).toBe('prompt');
    expect(options.injectRegister).toBe(false);
  });

  it('(QA-10) two missing icons are both named, the present ones are not, and nothing is emitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ec-qa-icons-'));
    temp.push(dir);
    writeFileSync(join(dir, 'icon-192.png'), 'a');
    writeFileSync(join(dir, 'icon-maskable-192.png'), 'b');
    const emitted: string[] = [];
    const text = message(() => {
      emitIcons(dir, (f) => emitted.push(f.fileName));
    });
    expect(text).toContain('icon-512.png');
    expect(text).toContain('icon-maskable-512.png');
    expect(text).not.toContain('icon-192.png、');
    expect(text.split('（')[0]).not.toMatch(/icon-192\.png|icon-maskable-192\.png/);
    expect(emitted).toEqual([]);
    const one = mkdtempSync(join(tmpdir(), 'ec-qa-icons-'));
    temp.push(one);
    for (const icon of ICONS.slice(0, 3)) writeFileSync(join(one, icon.file), 'c');
    expect(message(() => loadIcons(one))).toMatch(/^PWA 圖示來源缺少：icon-maskable-512\.png（/);
  });

  it('(QA-11) with all four present the bytes are copied as-is under icons/ in manifest order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ec-qa-icons-'));
    temp.push(dir);
    ICONS.forEach((icon, i) => {
      writeFileSync(join(dir, icon.file), new Uint8Array([i, 255, 0]));
    });
    const files = loadIcons(dir);
    expect(files.map((f) => f.fileName)).toEqual(ICONS.map((i) => `icons/${i.file}`));
    expect(files.map((f) => [...f.source])).toEqual([
      [0, 255, 0],
      [1, 255, 0],
      [2, 255, 0],
      [3, 255, 0],
    ]);
  });
});

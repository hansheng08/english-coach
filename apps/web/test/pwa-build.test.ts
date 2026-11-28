import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ICON_SOURCE, ICONS, createManifest, createPwaOptions, emitIcons, readTokens } from '../vite.pwa.ts';
import type { IconFile } from '../vite.pwa.ts';

const ICON_FILES = ['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png'];
const temp: string[] = [];

afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ec-icons-'));
  temp.push(dir);
  return dir;
}

function emitAll(sourceDir: string): IconFile[] {
  const out: IconFile[] = [];
  emitIcons(sourceDir, (file) => {
    out.push(file);
  });
  return out;
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

describe('manifest', () => {
  const manifest = createManifest(readTokens());

  it('(AC-T19-1) (TC-1) has the fields and values of pwa.md §1, and no orientation', () => {
    expect(manifest).toMatchObject({
      name: 'english-coach',
      short_name: 'EN Coach',
      description: '每天 80 分鐘，把英文講得像 Senior。',
      lang: 'zh-Hant-TW',
      dir: 'ltr',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect('orientation' in manifest).toBe(false);
  });

  it('(AC-T19-1) (TC-1) theme_color and background_color equal color.hero.light of tokens.json', () => {
    expect(manifest.theme_color).toBe('#0F2236');
    expect(manifest.background_color).toBe('#0F2236');
  });

  it('(AC-T19-1) (TC-3) the colors come from the tokens input, not a second copy', () => {
    const changed = createManifest({ color: { hero: { light: '#123456', dark: '#000000' } } });
    expect(changed.theme_color).toBe('#123456');
    expect(changed.background_color).toBe('#123456');
  });

  it('(AC-T19-1) (TC-3) a tokens input without color.hero.light fails the build', () => {
    expect(() => createManifest({ color: {} })).toThrow('color.hero.light');
    expect(() => createManifest(null)).toThrow('color.hero.light');
  });

  it('(AC-T19-2) (TC-2) icons are exactly four: 192 and 512, each one any and one maskable, no combined purpose', () => {
    expect(manifest.icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    for (const icon of manifest.icons) expect(icon.purpose).not.toContain(' ');
    expect(ICONS.map((i) => i.file)).toEqual(ICON_FILES);
  });
});

describe('icon output', () => {
  it('(AC-T19-2) (TC-2) writes four files under icons/ whose names match the manifest src and whose bytes equal the source', () => {
    const manifest = createManifest(readTokens());
    const files = emitAll(DEFAULT_ICON_SOURCE);
    expect(files.map((f) => `/${f.fileName}`)).toEqual(manifest.icons.map((i) => i.src));
    for (const file of files) {
      const original = readFileSync(join(DEFAULT_ICON_SOURCE, file.fileName.replace('icons/', '')));
      expect([...file.source]).toEqual([...original]);
      expect(file.source.length).toBeGreaterThan(0);
    }
  });

  it('(AC-T19-14) (TC-20) one missing icon fails with that file name only, and nothing is emitted', () => {
    const dir = tempDir();
    for (const name of ICON_FILES.slice(0, 3)) writeFileSync(join(dir, name), 'x');
    const out: IconFile[] = [];
    const message = messageOf(() => {
      emitIcons(dir, (file) => {
        out.push(file);
      });
    });
    expect(message).toContain('icon-maskable-512.png');
    for (const present of ICON_FILES.slice(0, 3)) expect(message).not.toContain(present);
    expect(out).toEqual([]);
  });

  it('(AC-T19-14) (TC-21) a source folder that does not exist fails naming all four files, and nothing is emitted', () => {
    const missing = join(tempDir(), 'does-not-exist');
    expect(existsSync(missing)).toBe(false);
    const out: IconFile[] = [];
    const message = messageOf(() => {
      emitIcons(missing, (file) => {
        out.push(file);
      });
    });
    for (const name of ICON_FILES) expect(message).toContain(name);
    expect(out).toEqual([]);
  });

  it('(AC-T19-14) (TC-20) the real icon sources are untouched by these tests', () => {
    for (const name of ICON_FILES) expect(existsSync(join(DEFAULT_ICON_SOURCE, name))).toBe(true);
  });
});

describe('service worker options', () => {
  const options = createPwaOptions(readTokens());

  it('(AC-T19-3) (TC-4) prompt registration and generateSW', () => {
    expect(options.registerType).toBe('prompt');
    expect(options.strategies).toBe('generateSW');
  });

  it('(AC-T21-13) (TC-18) runtime caching is exactly one cache-first rule for tts signed URLs (ignoreSearch, 50 entries, 7 days)', () => {
    const rules = options.workbox?.runtimeCaching ?? [];
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule?.handler).toBe('CacheFirst');
    expect(rule?.urlPattern).toBeInstanceOf(RegExp);
    const pattern = rule?.urlPattern instanceof RegExp ? rule.urlPattern : /$^/;
    const host = 'https://example.supabase.co';
    expect(pattern.test(`${host}/storage/v1/object/sign/tts/u/h.mp3?token=a`)).toBe(true);
    expect(pattern.test(`${host}/functions/v1/tts`)).toBe(false);
    expect(rule?.options?.matchOptions?.ignoreSearch).toBe(true);
    expect(rule?.options?.expiration).toEqual({ maxEntries: 50, maxAgeSeconds: 604800 });
  });

  it('(AC-T19-3) (TC-4) precache patterns are only shell extensions and icons/*.png', () => {
    expect(options.workbox?.globPatterns).toEqual(['**/*.{html,js,css,webmanifest}', 'icons/*.png']);
  });

  it('(AC-T19-1) (TC-1) the plugin gets the same manifest', () => {
    expect(options.manifest).toEqual(createManifest(readTokens()));
  });
});

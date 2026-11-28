import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ICONS, createManifest, createPwaOptions, emitIcons, heroLightColor, loadIcons } from '../vite.pwa.ts';

// QA probes for T-019 AC-T19-1～3、AC-T19-14（pwa.md §1、§2，ARCHITECTURE §9）。
// T-021 AC-T21-13：QA-9 的 runtimeCaching 斷言改為剛好一條 TTS cache-first；細節見 QA-12～QA-14。
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

/** Workbox runtimeCaching 一條規則（vite-plugin-pwa generateSW 設定）。 */
type RuntimeCacheRule = {
  readonly urlPattern?: unknown;
  readonly handler?: unknown;
  readonly options?: {
    readonly matchOptions?: { readonly ignoreSearch?: boolean };
    readonly expiration?: { readonly maxEntries?: number; readonly maxAgeSeconds?: number };
  };
};

const TTS_PATH = '/storage/v1/object/sign/tts/';
const TTS_OBJECT = '00000000-0000-4000-8000-000000000021/' + 'a'.repeat(64) + '.mp3';
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

function describeUnknown(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(length ${String(value.length)})`;
  return typeof value;
}

function runtimeRules(): readonly RuntimeCacheRule[] {
  const rules = createPwaOptions(TOKENS).workbox?.runtimeCaching;
  expect(Array.isArray(rules), `runtimeCaching should be an array, got ${describeUnknown(rules)}`).toBe(true);
  return Array.isArray(rules) ? rules : [];
}

function matchesUrl(urlPattern: unknown, href: string): boolean {
  const url = new URL(href);
  if (typeof urlPattern === 'string') {
    if (href.includes(urlPattern) || url.pathname.includes(urlPattern)) return true;
    try {
      return new RegExp(urlPattern).test(href);
    } catch {
      return false;
    }
  }
  if (urlPattern instanceof RegExp) return urlPattern.test(href);
  if (typeof urlPattern === 'function') {
    const fn = urlPattern as (ctx: { url: URL; request: Request; sameOrigin: boolean; event: Event }) => unknown;
    return Boolean(fn({ url, request: new Request(href), sameOrigin: false, event: new Event('fetch') }));
  }
  return false;
}

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

  it('(QA-9) precache is shell only: no catch-all glob, no json, images only under icons/; runtime caching is exactly one TTS rule', () => {
    const options = createPwaOptions(TOKENS);
    const workbox = options.workbox ?? {};
    // T-021 AC-T21-13 / ARCH §4.12.1、§9：runtimeCaching 剛好一條 TTS cache-first（不再是 undefined）。
    expect(Array.isArray(workbox.runtimeCaching), `runtimeCaching should be an array of length 1, got ${describeUnknown(workbox.runtimeCaching)}`).toBe(true);
    expect(workbox.runtimeCaching).toHaveLength(1);
    const globs = workbox.globPatterns ?? [];
    expect(globs).toEqual(['**/*.{html,js,css,webmanifest}', 'icons/*.png']);
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

describe('T-021 QA SW TTS runtime caching (AC-T21-13)', () => {
  it('(QA-12) (AC-T21-13) runtimeCaching is exactly one CacheFirst rule for tts signed URLs, ignoreSearch true, globPatterns unchanged', () => {
    const rules = runtimeRules();
    expect(rules).toHaveLength(1);
    const rule = rules[0];
    expect(rule?.handler).toBe('CacheFirst');
    expect(rule?.options?.matchOptions?.ignoreSearch).toBe(true);
    expect(createPwaOptions(TOKENS).workbox?.globPatterns).toEqual([
      '**/*.{html,js,css,webmanifest}',
      'icons/*.png',
    ]);

    const pattern = rule?.urlPattern;
    const signed = `https://qa-project.supabase.co${TTS_PATH}${TTS_OBJECT}?token=fake-token`;
    const signedOtherQuery = `https://qa-project.supabase.co${TTS_PATH}${TTS_OBJECT}?token=fake-token-other`;
    const signedNoQuery = `https://qa-project.supabase.co${TTS_PATH}${TTS_OBJECT}`;
    expect(matchesUrl(pattern, signed)).toBe(true);
    expect(matchesUrl(pattern, signedOtherQuery)).toBe(true);
    expect(matchesUrl(pattern, signedNoQuery)).toBe(true);
  });

  it('(QA-13) (AC-T21-13) /functions/v1/ and other buckets are not covered by the TTS rule', () => {
    const rules = runtimeRules();
    expect(rules).toHaveLength(1);
    const pattern = rules[0]?.urlPattern;
    const host = 'https://qa-project.supabase.co';
    expect(matchesUrl(pattern, `${host}/functions/v1/api`)).toBe(false);
    expect(matchesUrl(pattern, `${host}/functions/v1/plan/today`)).toBe(false);
    expect(matchesUrl(pattern, `${host}/storage/v1/object/sign/audio/${TTS_OBJECT}?token=fake-token`)).toBe(false);
    expect(matchesUrl(pattern, `${host}/storage/v1/object/sign/resume/x.pdf?token=fake-token`)).toBe(false);
    expect(matchesUrl(pattern, `${host}/storage/v1/object/public/tts/${TTS_OBJECT}`)).toBe(false);
  });

  it('(QA-14) (AC-T21-13) the TTS cache keeps at most 50 entries for 7 days (604800 seconds)', () => {
    // AC-T21-13 與 ARCH §9 都要求 ExpirationPlugin：maxEntries 50、maxAgeSeconds 7 天。
    const rules = runtimeRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.options?.expiration).toEqual({ maxEntries: 50, maxAgeSeconds: SEVEN_DAYS_SEC });
  });
});

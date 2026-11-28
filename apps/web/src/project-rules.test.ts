import { readFileSync } from 'node:fs';
import { ok } from '@english-coach/contracts';
import { DOMAIN_PACKAGE_NAME, toTaipeiPlanDate } from '@english-coach/domain';
import { describe, expect, it } from 'vitest';
import depCruiser from '../../../.dependency-cruiser.cjs?raw';
import rootPackage from '../../../package.json?raw';
import viteConfig from '../vite.config.ts?raw';
import viteDataMode from '../vite.data-mode.ts?raw';

// Vite 的 ?raw 不給讀 .env* 檔（server.fs.deny），所以這個檔用 node:fs 讀。
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

const sources = import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
const TEST_FILE = /(^|\/)test\/|\.test\.tsx?$|\.test-d\.ts$/;
const production = Object.entries(sources).filter(([path]) => !TEST_FILE.test(path));

// HTML 不經過 Vite 的 ?raw，和 .env.example 一樣用 node:fs 讀。
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vitePwa = readFileSync(new URL('../vite.pwa.ts', import.meta.url), 'utf8');
const playwrightConfig = readFileSync(new URL('../../../playwright.config.ts', import.meta.url), 'utf8');
const viteEnvDts = readFileSync(new URL('./vite-env.d.ts', import.meta.url), 'utf8');

const ALLOWED_VITE_NAMES = ['VITE_DATA_MODE', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const;

/** 名稱：前面不是英數字或底線的 VITE_，後接大寫英文、數字、底線，且結尾是大寫英文或數字。 */
function viteNames(text: string): string[] {
  const runs = text.match(/(?<![A-Za-z0-9_])VITE_[A-Z0-9_]*/g) ?? [];
  return runs.filter((n) => !n.endsWith('_'));
}

/** text 裡每一個 VITE_ 名稱中不在 ALLOWED_VITE_NAMES 的，依出現順序、不去重。 */
function viteNamesOutsideAllowList(text: string): string[] {
  const allowed: readonly string[] = ALLOWED_VITE_NAMES;
  return viteNames(text).filter((n) => !allowed.includes(n));
}

describe('apps/web project rules', () => {
  it('(AC-T54-1) (TC-1) allow-listed names return []', () => {
    expect(viteNamesOutsideAllowList('VITE_DATA_MODE=mock')).toEqual([]);
    expect(viteNamesOutsideAllowList('import.meta.env.VITE_SUPABASE_URL')).toEqual([]);
    expect(viteNamesOutsideAllowList('VITE_SUPABASE_PUBLISHABLE_KEY=')).toEqual([]);
  });

  it('(AC-T54-1) (TC-2) names outside the allow-list are returned in order, not de-duplicated', () => {
    for (const name of ['VITE_API_TOKEN', 'VITE_FOO_SECRET', 'VITE_SUPABASE_ANON_KEY', 'VITE_PUBLIC_FLAG', 'VITE_DATA_MODES', 'VITE_SUPABASE_URL2']) {
      expect(viteNamesOutsideAllowList(`${name}=`)).toEqual([name]);
    }
    expect(viteNamesOutsideAllowList('VITE_X VITE_DATA_MODE VITE_X')).toEqual(['VITE_X', 'VITE_X']);
  });

  it('(AC-T54-1) (TC-3) prefixes and boundaries are not names', () => {
    for (const text of ['VITE_SUPABASE_', 'VITE_SUPABASE_*', '所有 VITE_ 變數', 'XVITE_FOO', 'vite_foo']) {
      expect(viteNamesOutsideAllowList(text), text).toEqual([]);
    }
  });

  it('(AC-T54-1) (TC-4) HTML %VITE_…% placeholders count as names', () => {
    expect(viteNamesOutsideAllowList('<title>%VITE_APP_TITLE%</title>')).toEqual(['VITE_APP_TITLE']);
    expect(viteNamesOutsideAllowList('%VITE_DATA_MODE%')).toEqual([]);
  });

  it('(AC-T18-2) (TC-5) (AC-T54-2) (TC-5) every scanned file uses only allow-listed VITE_ names', () => {
    expect(production.length).toBeGreaterThan(5);
    for (const [path, text] of production) expect(viteNamesOutsideAllowList(text), path).toEqual([]);
    for (const text of [indexHtml, vitePwa, playwrightConfig]) expect(text.length).toBeGreaterThan(0);
    const named = { viteConfig, viteDataMode, envExample, indexHtml, vitePwa, playwrightConfig };
    for (const [name, text] of Object.entries(named)) expect(viteNamesOutsideAllowList(text), name).toEqual([]);
  });

  it('(AC-T54-3) (TC-6) vite-env.d.ts and .env.example list exactly the allow-list', () => {
    const expected = [...ALLOWED_VITE_NAMES].sort();
    expect([...new Set(viteNames(viteEnvDts))].sort()).toEqual(expected);
    const envLines = envExample.split('\n').flatMap((line) => /^(VITE_[A-Z0-9_]*[A-Z0-9])=/.exec(line)?.[1] ?? []);
    expect([...new Set(envLines)].sort()).toEqual(expected);
  });

  it('(AC-T18-3) (TC-6) @supabase/* is imported only under api/supabase/', () => {
    const importing = production.filter(([, text]) => /from\s+['"]@supabase\/|import\(\s*['"]@supabase\//.test(text)).map(([p]) => p);
    expect(importing.length).toBeGreaterThan(0);
    for (const path of importing) expect(path.startsWith('./api/supabase/'), path).toBe(true);
  });

  it('(AC-T18-3) (TC-6) MOCK_MARKER is defined once, in api/mock/index.ts', () => {
    const defining = production.filter(([, text]) => /export const MOCK_MARKER\b/.test(text)).map(([p]) => p);
    expect(defining).toEqual(['./api/mock/index.ts']);
    const literal = production.filter(([, text]) => text.includes('__EC_MOCK__')).map(([p]) => p);
    expect(literal).toEqual(['./api/mock/index.ts']);
  });

  it('(AC-T18-3) (TC-6) screens never import api/mock or read the data mode', () => {
    for (const [path, text] of production) {
      if (path.startsWith('./api/') || path.endsWith('.d.ts')) continue;
      expect(text, path).not.toMatch(/api\/mock/);
      expect(text, path).not.toMatch(/VITE_DATA_MODE/);
    }
  });

  it('(AC-T18-3) (TC-6) dependency-cruiser forbids jsdom and @testing-library in production code', () => {
    expect(depCruiser).toContain('jsdom');
    expect(depCruiser).toContain('@testing-library');
    expect(depCruiser).toContain('apps/web/src');
  });

  it('(AC-T18-20) (TC-37) both workspace packages resolve by name, without an alias', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(DOMAIN_PACKAGE_NAME).toBe('@english-coach/domain');
    const date = toTaipeiPlanDate(new Date('2026-11-26T20:00:00Z'));
    expect(date.ok && date.value).toBe('2026-11-27');
    expect(viteConfig).not.toMatch(/\balias\b/);
  });

  it('(AC-T18-20) (TC-37) root engines.node matches jsdom', () => {
    const pkg = JSON.parse(rootPackage) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe('^22.22.2 || ^24.15.0 || >=26.0.0');
  });
});

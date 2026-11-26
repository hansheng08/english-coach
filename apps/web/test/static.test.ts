import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMAIN_PACKAGE_NAME } from '@english-coach/domain';
import { err, isErr } from '@english-coach/contracts';
import cruiserRules from '../../../.dependency-cruiser.cjs?raw';
import indexHtml from '../index.html?raw';
import rootPackageJson from '../../../package.json?raw';
import viteConfig from '../vite.config.ts?raw';
import webPackageJson from '../package.json?raw';

const TEST_FILE = /(^|\/)test\/|\.test\.tsx?$|\.test-d\.ts$/;
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const allSources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
// 鍵改成 /src/... 開頭，和 test/ 資料夾外的路徑寫法一致
const sources = Object.entries(allSources)
  .map(([path, text]): [string, string] => [path.replace(/^\.\./, ''), text])
  .filter(([path]) => !TEST_FILE.test(path));

const viteNames = (text: string): string[] => text.match(/VITE_[A-Z0-9_]+/g) ?? [];
const violates = (name: string): boolean => /KEY|SECRET|TOKEN/.test(name) && name !== 'VITE_SUPABASE_PUBLISHABLE_KEY';

describe('static rules', () => {
  it('(AC-T18-2) (TC-5) no VITE_ name contains KEY / SECRET / TOKEN except the publishable key', () => {
    const names = [...sources.flatMap(([, text]) => viteNames(text)), ...viteNames(viteConfig), ...viteNames(envExample)];
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter(violates)).toEqual([]);
    expect(violates('VITE_API_TOKEN')).toBe(true);
    expect(violates('VITE_FOO_SECRET')).toBe(true);
    expect(violates('VITE_SUPABASE_PUBLISHABLE_KEY')).toBe(false);
  });

  it('(AC-T18-3) (TC-6) @supabase/* only under api/supabase/, MOCK_MARKER defined once, test libs blocked', () => {
    expect(sources.length).toBeGreaterThan(5);
    const importers = sources.filter(([, text]) => /['"]@supabase\//.test(text)).map(([path]) => path);
    expect(importers.length).toBeGreaterThan(0);
    for (const path of importers) expect(path.startsWith('/src/api/supabase/')).toBe(true);

    const definitions = sources.filter(([, text]) => /export const MOCK_MARKER\b/.test(text)).map(([path]) => path);
    expect(definitions).toEqual(['/src/api/mock/index.ts']);
    const mentions = sources.filter(([, text]) => text.includes('__EC_MOCK__')).map(([path]) => path);
    expect(mentions).toEqual(['/src/api/mock/index.ts']);

    expect(cruiserRules).toContain('jsdom');
    expect(cruiserRules).toContain('@testing-library/');
  });

  it('(AC-T18-10) (TC-19) the inline script in index.html uses the same key as theme.ts', async () => {
    const { THEME_STORAGE_KEY } = await import('../src/ui/theme.ts');
    expect(indexHtml).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  it('(AC-T18-12) (TC-23) head order: charset, viewport, color-scheme, inline script, then stylesheet / module script; lang', () => {
    expect(indexHtml).toContain('<html lang="zh-Hant-TW">');
    const at = (needle: RegExp): number => indexHtml.search(needle);
    const order = [
      at(/<meta charset=/),
      at(/<meta name="viewport"/),
      at(/<meta name="color-scheme" content="light dark"/),
      at(/<script>\s/),
      at(/<link rel="stylesheet"|<script type="module"/),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(indexHtml.indexOf('<link rel="stylesheet"')).toBe(-1);
    expect(indexHtml.indexOf('<script>')).toBeLessThan(indexHtml.indexOf('type="module"'));
  });

  it('(AC-T18-20) (TC-37) workspace packages work without an alias; dependencies and engines.node as specified', () => {
    expect(DOMAIN_PACKAGE_NAME).toEqual(expect.any(String));
    expect(isErr(err('x'))).toBe(true);
    expect(viteConfig).not.toMatch(/alias/);
    expect(webPackageJson).toContain('"@english-coach/contracts": "workspace:*"');
    expect(webPackageJson).toContain('"@english-coach/domain": "workspace:*"');
    expect(rootPackageJson).toContain('"node": "^22.22.2 || ^24.15.0 || >=26.0.0"');
    expect(rootPackageJson).toContain('"@playwright/test"');
  });
});

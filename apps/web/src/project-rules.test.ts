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

/** AC-T18-2：VITE_ 名稱不得含 KEY、SECRET、TOKEN，唯一例外是 VITE_SUPABASE_PUBLISHABLE_KEY。 */
function badViteNames(text: string): string[] {
  const names = text.match(/VITE_[A-Z0-9_]+/g) ?? [];
  return names.filter((n) => /KEY|SECRET|TOKEN/.test(n) && n !== 'VITE_SUPABASE_PUBLISHABLE_KEY');
}

describe('apps/web project rules', () => {
  it('(AC-T18-2) (TC-5) no VITE_ name carries KEY, SECRET or TOKEN (except the publishable key)', () => {
    expect(production.length).toBeGreaterThan(5);
    for (const [path, text] of production) expect(badViteNames(text), path).toEqual([]);
    for (const text of [viteConfig, viteDataMode, envExample]) expect(badViteNames(text)).toEqual([]);
    expect(badViteNames('VITE_API_TOKEN=')).toEqual(['VITE_API_TOKEN']);
    expect(badViteNames('VITE_FOO_SECRET=')).toEqual(['VITE_FOO_SECRET']);
    expect(badViteNames('VITE_SUPABASE_PUBLISHABLE_KEY=')).toEqual([]);
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

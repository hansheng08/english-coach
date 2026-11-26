import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SCRIPT = join(here, 'tokens-css.mjs');
const IN = 'docs/design/tokens.json';
const OUT = 'apps/web/src/ui/tokens.css';

const MIN = {
  color: { ink: { light: '#0F2236', dark: '#F3F5F8' } },
  space: { 4: '16px' },
  radius: { card: '20px' },
  font: { sans: '-apple-system, sans-serif' },
  shadow: { card: { light: '0 1px 2px #000', dark: 'none' } },
  motion: { 'duration-short': '160ms', 'ease-out': 'cubic-bezier(.2,.8,.2,1)' },
};

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't018-tokens-'));
  mkdirSync(join(dir, 'docs/design'), { recursive: true });
  mkdirSync(join(dir, 'apps/web/src/ui'), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const put = (json) => writeFileSync(join(dir, IN), typeof json === 'string' ? json : JSON.stringify(json));
const run = (args = [], cwd = dir) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
const out = () => readFileSync(join(dir, OUT), 'utf8');
const gen = (json) => {
  put(json);
  return run();
};

const sections = (css) => {
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media'));
  const mediaBlock = css.slice(css.indexOf('@media'), css.indexOf(':root[data-theme="dark"]'));
  const manualBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));
  return { rootBlock, mediaBlock, manualBlock };
};

describe('tokens-css generator', () => {
  it('(AC-T18-13) (TC-25) minimal shape: :root has light + shared values, dark sections only the dark values', () => {
    const r = gen(MIN);
    expect(r.status).toBe(0);
    const { rootBlock, mediaBlock, manualBlock } = sections(out());
    expect(rootBlock).toContain('--color-ink: #0F2236;');
    expect(rootBlock).toContain('--space-4: 16px;');
    expect(mediaBlock).toContain('--color-ink: #F3F5F8;');
    expect(manualBlock).toContain('--color-ink: #F3F5F8;');
    expect(mediaBlock).not.toContain('--space-4');
    expect(manualBlock).not.toContain('--space-4');
  });

  it('(AC-T18-13) (TC-26) parse rules 1-7', () => {
    const base = structuredClone(MIN);
    // 1. $ keys at any level are skipped
    expect(gen({ $meta: { a: 1 }, ...base, color: { ink: { $description: 'x', light: '#111', dark: '#222' } } }).status).toBe(0);
    expect(gen({ ...base, color: { ink: { $description: 'x', light: '#111', dark: '#222' }, $note: 5 } }).status).toBe(0);
    // 2. unknown top-level group
    const r2 = gen({ ...base, colors: {} });
    expect(r2.status).toBe(1);
    expect(r2.stdout).toBe('');
    // 4. nested sub-category equals the flat name; both together → duplicate
    expect(gen({ ...base, font: { size: { 'title-1': '1.75rem' } } }).status).toBe(0);
    expect(out()).toContain('--font-size-title-1: 1.75rem;');
    expect(gen({ ...base, font: { size: { 'title-1': '1.75rem' }, 'size-title-1': '2rem' } }).status).toBe(1);
    // names: lower-case alnum and "-" only
    expect(gen({ ...base, color: { Ink: '#111' } }).status).toBe(1);
    expect(gen({ ...base, color: { ink_2: '#111' } }).status).toBe(1);
    // 5. non-string leaves
    expect(gen({ ...base, space: { 4: 16 } }).status).toBe(1);
    expect(gen({ ...base, space: { 4: null } }).status).toBe(1);
    expect(gen({ ...base, space: { 4: ['16px'] } }).status).toBe(1);
    // 7. output order follows the key order
    expect(gen({ color: { b: '#222', a: '#111' } }).status).toBe(0);
    const css = out();
    expect(css.indexOf('--color-b')).toBeGreaterThan(-1);
    expect(css.indexOf('--color-b')).toBeLessThan(css.indexOf('--color-a'));
  });

  it('(AC-T18-13) (TC-27) an object with only light (or a non-string dark) fails with empty stdout', () => {
    for (const x of [{ light: '#FFFFFF' }, { light: '#FFFFFF', dark: 1 }, { dark: '#000000' }]) {
      const r = gen({ ...MIN, color: { x } });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).not.toBe('');
    }
  });

  it('(AC-T18-13) (TC-28) structure, header, color-scheme and reproducible bytes', () => {
    gen(MIN);
    const first = out();
    gen(MIN);
    expect(out()).toBe(first);
    expect(first).toContain('自動產生，不要手改');
    const { rootBlock, mediaBlock, manualBlock } = sections(first);
    expect(rootBlock).toContain('color-scheme: light;');
    expect(mediaBlock).toContain('@media (prefers-color-scheme: dark) {');
    expect(mediaBlock).toContain(':root:not([data-theme="light"]) {');
    expect(mediaBlock).toContain('color-scheme: dark;');
    expect(manualBlock).toContain(':root[data-theme="dark"] {');
    expect(manualBlock).toContain('color-scheme: dark;');
    gen({ space: { 4: '16px' } });
    const shared = sections(out());
    expect(shared.mediaBlock.match(/--/g)).toBeNull();
    expect(shared.manualBlock.match(/--/g)).toBeNull();
    expect(shared.mediaBlock).toContain('color-scheme: dark;');
  });

  it('(AC-T18-14) (TC-29) --check: same → 0 and untouched; changed / missing → 1 and untouched; broken json → 1 with empty stdout', () => {
    gen(MIN);
    const before = out();
    expect(run(['--check']).status).toBe(0);
    expect(out()).toBe(before);

    writeFileSync(join(dir, OUT), before.replace('16px', '17px'));
    const changed = out();
    expect(run(['--check']).status).toBe(1);
    expect(out()).toBe(changed);

    rmSync(join(dir, OUT));
    expect(run(['--check']).status).toBe(1);
    expect(existsSync(join(dir, OUT))).toBe(false);

    put('{ not json');
    const broken = run(['--check']);
    expect(broken.status).toBe(1);
    expect(broken.stdout).toBe('');
  });

  it('(AC-T18-14) (TC-30) the committed tokens.css matches the merged tokens.json', () => {
    const check = run(['--check'], root);
    expect(check.status).toBe(0);
    const css = readFileSync(join(root, OUT), 'utf8');
    const { rootBlock, mediaBlock, manualBlock } = sections(css);
    const count = (block) => (block.match(/^\s+--[a-z0-9-]+:/gm) ?? []).length;
    expect(count(rootBlock)).toBe(82);
    expect(count(mediaBlock)).toBe(29);
    expect(count(manualBlock)).toBe(29);
    expect(rootBlock).toContain('--color-theme-bar: #F4F5F7;');
    expect(rootBlock).toContain('--color-on-hero: #FFFFFF;');
    expect(mediaBlock).toContain('--color-theme-bar: #0A1420;');
    expect(manualBlock).toContain('--color-theme-bar: #0A1420;');
    expect(mediaBlock).toContain('--shadow-seg: none;');
    expect(manualBlock).toContain('--shadow-seg: none;');
    const main = readFileSync(join(root, 'apps/web/src/main.tsx'), 'utf8');
    const firstImport = main.split('\n').find((l) => l.startsWith('import'));
    expect(firstImport).toMatch(/['"]\.\/ui\/tokens\.css['"]/);
  });
});

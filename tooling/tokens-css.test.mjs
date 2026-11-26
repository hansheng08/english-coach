import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'tooling/tokens-css.mjs');
const MINIMAL = readFileSync(join(REPO, 'tooling/fixtures/t018/minimal-tokens.json'), 'utf8');

function workdir(tokensText) {
  const dir = mkdtempSync(join(tmpdir(), 'tokens-css-'));
  mkdirSync(join(dir, 'docs/design'), { recursive: true });
  if (tokensText !== null) writeFileSync(join(dir, 'docs/design/tokens.json'), tokensText);
  return dir;
}
const run = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
const outPath = (dir) => join(dir, 'apps/web/src/ui/tokens.css');
const generate = (tokens) => {
  const dir = workdir(typeof tokens === 'string' ? tokens : JSON.stringify(tokens));
  const r = run(dir);
  return { dir, r, css: r.status === 0 ? readFileSync(outPath(dir), 'utf8') : null };
};
const section = (css, start) => {
  const i = css.indexOf(start);
  return i < 0 ? '' : css.slice(i, css.indexOf('\n}', i));
};
const rootBlock = (css) => section(css, ':root {');
const mediaBlock = (css) => section(css, '@media (prefers-color-scheme: dark)');
const attrBlock = (css) => section(css, ':root[data-theme="dark"]');
const count = (block) => (block.match(/^\s*--[a-z0-9-]+:/gm) ?? []).length;

describe('tokens-css.mjs', () => {
  it('(AC-T18-13) (TC-25) minimal shape: :root has light values, both dark blocks have only themed tokens', () => {
    const { css } = generate(MINIMAL);
    expect(rootBlock(css)).toContain('--color-ink: #0F2236;');
    expect(rootBlock(css)).toContain('--space-4: 16px;');
    for (const block of [mediaBlock(css), attrBlock(css)]) {
      expect(block).toContain('--color-ink: #F3F5F8;');
      expect(block).not.toContain('--space-4');
    }
  });

  it('(AC-T18-13) (TC-26) $-keys are skipped at any level and the order follows the source', () => {
    const { r, css } = generate({
      $meta: { x: 1 },
      color: { b: '#000000', a: { light: '#111111', dark: '#222222', $description: 'note' } },
      font: { size: { 'title-1': '1rem' } },
    });
    expect(r.status).toBe(0);
    expect(css.indexOf('--color-b:')).toBeLessThan(css.indexOf('--color-a:'));
    expect(css).toContain('--font-size-title-1: 1rem;');
  });

  const failing = {
    'unknown top-level group': { colors: { a: '#000000' } },
    'flattened name collision': { font: { size: { 'title-1': '1rem' }, 'size-title-1': '2rem' } },
    'uppercase name': { color: { Ink: '#000000' } },
    'underscore name': { color: { ink_2: '#000000' } },
    'number value': { space: { 4: 16 } },
    'null value': { space: { 4: null } },
    'array value': { space: { 4: ['16px'] } },
    'only light': { color: { x: { light: '#FFFFFF' } } },
    'dark is a number': { color: { x: { light: '#FFFFFF', dark: 1 } } },
    'light, dark and a third key': { color: { x: { light: '#FFFFFF', dark: '#000000', extra: '1' } } },
    'group is not an object': { color: '#FFFFFF' },
  };
  for (const [name, tokens] of Object.entries(failing)) {
    it(`(AC-T18-13) (TC-26) (TC-27) fails: ${name} (exit 1, stdout empty, reason on stderr)`, () => {
      const { r } = generate(tokens);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).not.toBe('');
    });
  }

  it('(AC-T18-13) (TC-28) header, color-scheme lines, block selectors, byte-identical reruns', () => {
    const first = generate(MINIMAL);
    const second = generate(MINIMAL);
    expect(first.css).toContain('自動產生，不要手改');
    expect(rootBlock(first.css)).toContain('color-scheme: light;');
    expect(first.css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {');
    expect(mediaBlock(first.css)).toContain('color-scheme: dark;');
    expect(attrBlock(first.css)).toContain('color-scheme: dark;');
    expect(first.css).toBe(second.css);
  });

  it('(AC-T18-13) (TC-28) strings only: the two dark blocks hold only color-scheme', () => {
    const { css } = generate({ space: { 4: '16px' } });
    expect(count(mediaBlock(css))).toBe(0);
    expect(count(attrBlock(css))).toBe(0);
    expect(mediaBlock(css)).toContain('color-scheme: dark;');
  });

  it('(AC-T18-14) (TC-29) --check: match → 0 without touching the file', () => {
    const { dir, css } = generate(MINIMAL);
    const r = run(dir, '--check');
    expect(r.status).toBe(0);
    expect(readFileSync(outPath(dir), 'utf8')).toBe(css);
  });

  it('(AC-T18-14) (TC-29) --check: one changed character → 1, file untouched', () => {
    const { dir, css } = generate(MINIMAL);
    const edited = css.replace('16px', '17px');
    writeFileSync(outPath(dir), edited);
    expect(run(dir, '--check').status).toBe(1);
    expect(readFileSync(outPath(dir), 'utf8')).toBe(edited);
  });

  it('(AC-T18-14) (TC-29) --check: missing output → 1 and nothing is created', () => {
    const dir = workdir(MINIMAL);
    expect(run(dir, '--check').status).toBe(1);
    expect(existsSync(outPath(dir))).toBe(false);
  });

  it('(AC-T18-14) (TC-29) --check: broken tokens.json → 1 with empty stdout', () => {
    const { dir } = generate(MINIMAL);
    writeFileSync(join(dir, 'docs/design/tokens.json'), '{ not json');
    const r = run(dir, '--check');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
  });

  it('(AC-T18-14) (TC-30) the committed tokens.css matches the real tokens.json', () => {
    const r = run(REPO, '--check');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('(AC-T18-14) (TC-30) real counts and sample values: 82 tokens, 29 themed in both dark blocks', () => {
    const css = readFileSync(join(REPO, 'apps/web/src/ui/tokens.css'), 'utf8');
    expect(count(rootBlock(css))).toBe(82);
    expect(rootBlock(css)).toContain('--color-theme-bar: #F4F5F7;');
    expect(rootBlock(css)).toContain('--color-on-hero: #FFFFFF;');
    for (const block of [mediaBlock(css), attrBlock(css)]) {
      expect(count(block)).toBe(29);
      expect(block).toContain('--color-theme-bar: #0A1420;');
      expect(block).toContain('--shadow-seg: none;');
    }
  });

  it('(AC-T18-14) (TC-30) main.tsx imports tokens.css first', () => {
    const main = readFileSync(join(REPO, 'apps/web/src/main.tsx'), 'utf8');
    const firstImport = main.split('\n').find((line) => line.startsWith('import '));
    expect(firstImport).toMatch(/\.\/ui\/tokens\.css/);
  });
});

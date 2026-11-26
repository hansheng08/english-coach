import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findViolations } from './css-literals.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'tooling/css-literals.mjs');

function scan(files) {
  const dir = mkdtempSync(join(tmpdir(), 'css-literals-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
}
const one = (decl) => scan({ 'apps/web/src/a.module.css': `.a {\n  ${decl}\n}\n` });

describe('css-literals.mjs', () => {
  for (const decl of ['color: #FFF;', 'border: 1px solid rgba(0,0,0,.1);', 'color: hsl(0 0% 0%);', 'color: #FFFF;', 'color: #00112233;', 'color: #001122;']) {
    it(`(AC-T18-15) (TC-31) rejects "${decl}" and prints file:line`, () => {
      const r = one(decl);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('apps/web/src/a.module.css:2');
    });
  }

  for (const decl of ['margin: 0;', 'width: 50%;', 'border-bottom: 1px dashed var(--color-ink-3);', 'grid-template-columns: 1fr 340px;', '/* color: #FFF; */', 'content: "#12";']) {
    it(`(AC-T18-15) (TC-31) accepts "${decl}"`, () => {
      const r = one(decl);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    });
  }

  it('(AC-T18-15) (TC-31) does not scan tokens.css', () => {
    const r = scan({ 'apps/web/src/ui/tokens.css': ':root { --color-x: #FFF; }\n', 'apps/web/src/a.module.css': '.a { margin: 0; }\n' });
    expect(r.status).toBe(0);
  });

  it('(AC-T18-15) (TC-31) a comment spanning lines does not shift the reported line', () => {
    const r = scan({ 'apps/web/src/a.module.css': '/* one\ntwo */\n.a { color: #FFF; }\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('a.module.css:3');
  });

  it('(AC-T18-15) (TC-31) exits 1 when apps/web/src does not exist', () => {
    const r = scan({ 'other/file.txt': 'x' });
    expect(r.status).toBe(1);
  });

  const lines = (...rows) => findViolations(rows.join('\n'));

  it('(AC-T18-31) (TC-55) a multi-line box-shadow reports the lines holding the literals', () => {
    expect(lines('.a {', '  box-shadow:', '    0 1px 2px #0f2236,', '    0 2px rgba(0, 0, 0, 0.2);', '}')).toEqual([3, 4]);
  });

  it('(AC-T18-31) (TC-56) a multi-line gradient reports the lines holding the literals', () => {
    expect(lines('.a {', '  background: linear-gradient(', '    #fff,', '    hsl(0 0% 0%)', '  );', '}')).toEqual([3, 4]);
  });

  it('(AC-T18-31) (TC-57) a declaration nested in an at-rule is checked, the at-rule prelude is not', () => {
    expect(lines('@media (min-width: 900px) {', '  .a {', '    border-color:', '      #123456;', '  }', '}')).toEqual([4]);
  });

  it('(AC-T18-32) (TC-58) selectors with ids or :not(#…) are not declarations; declarations in the same block still are', () => {
    expect(lines('a:not(#abc) {', '  color: var(--color-ink);', '}')).toEqual([]);
    expect(lines('.x:not(#fade) { color: var(--a); }')).toEqual([]);
    expect(lines('#app { color: var(--a); }')).toEqual([]);
    expect(lines('a:not(#abc) { color: #fff; }')).toEqual([1]);
  });

  it('(AC-T18-15) (TC-32) the repository itself passes', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

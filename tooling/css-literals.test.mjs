import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

  it('(AC-T18-15) (TC-32) the repository itself passes', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

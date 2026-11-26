import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SCRIPT = join(here, 'css-literals.mjs');

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't018-css-'));
  mkdirSync(join(dir, 'apps/web/src/ui'), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (cwd) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
const css = (name, text) => writeFileSync(join(dir, 'apps/web/src', name), text);

describe('css-literals', () => {
  it('(AC-T18-15) (TC-31) flags hex colours, rgba( and hsl( with file:line; leaves 0, 1px, %, comments and tokens.css alone', () => {
    css('a.module.css', ['.a {', '  color: #FFF;', '  border: 1px solid rgba(0,0,0,.1);', '  color: hsl(0 0% 0%);', '}', ''].join('\n'));
    const bad = run(dir);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('a.module.css:2');
    expect(bad.stderr).toContain('a.module.css:3');
    expect(bad.stderr).toContain('a.module.css:4');

    css(
      'a.module.css',
      ['.a {', '  margin: 0;', '  width: 50%;', '  border: 1px solid var(--color-line);', '  /* color: #FFF; */', '  grid-template-columns: 1fr 2fr;', '}', ''].join('\n'),
    );
    writeFileSync(join(dir, 'apps/web/src/ui/tokens.css'), ':root { --color-ink: #FFF; }\n');
    expect(run(dir).status).toBe(0);
  });

  it('(AC-T18-15) (TC-31) 8-digit and 4-digit hex are flagged, id selectors are not values', () => {
    css('b.module.css', '.b {\n  color: #0F2236CC;\n}\n');
    expect(run(dir).status).toBe(1);
    css('b.module.css', '.b {\n  color: #abcd;\n}\n');
    expect(run(dir).status).toBe(1);
    css('b.module.css', '.b {\n  background: var(--color-bg);\n}\n#root { width: 100%; }\n');
    expect(run(dir).status).toBe(0);
  });

  it('(AC-T18-15) (TC-31) missing apps/web/src → exit 1', () => {
    const empty = mkdtempSync(join(tmpdir(), 't018-css-empty-'));
    try {
      expect(run(empty).status).toBe(1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('(AC-T18-15) (TC-32) the project itself passes', () => {
    const r = run(root);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

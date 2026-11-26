import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = 'apps/web/src';
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/;
const FUNCS = /\b(?:rgba?|hsla?)\(/;
const DECLARATION = /(?:^|[;{])\s*(?:--[\w-]+|[a-zA-Z-]+)\s*:([^;}]*)/g;

/** 去掉 CSS 註解，保留換行，讓行號不變。 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 回傳違規的行號（從 1 開始）：宣告值裡有色碼或 rgb(／rgba(／hsl(／hsla(。 */
export function findViolations(css) {
  const lines = stripComments(css).split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(DECLARATION)) {
      const value = m[1] ?? '';
      if (HEX.test(value) || FUNCS.test(value)) {
        hits.push(i + 1);
        break;
      }
    }
  });
  return hits;
}

function listModuleCss(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listModuleCss(path));
    else if (entry.name.endsWith('.module.css')) files.push(path);
  }
  return files.sort();
}

export function run() {
  if (!existsSync(ROOT)) {
    process.stderr.write(`css-literals: 找不到 ${ROOT}\n`);
    return 1;
  }
  let bad = 0;
  for (const file of listModuleCss(ROOT)) {
    for (const line of findViolations(readFileSync(file, 'utf8'))) {
      process.stderr.write(`${file}:${String(line)} 不得寫色碼或 rgb(／hsl(，改用 var(--…)\n`);
      bad += 1;
    }
  }
  if (bad > 0) return 1;
  process.stdout.write('css-literals: OK\n');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}

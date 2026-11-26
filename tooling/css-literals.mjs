// ARCHITECTURE §9.1.5 使用規則：apps/web/src/**/*.module.css 不得寫色碼或 rgb(／rgba(／hsl(，一律用 var(--…)。
//   node tooling/css-literals.mjs [目錄]   預設 apps/web/src（相對於工作目錄）；tokens.css 不掃（它不是 *.module.css）。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIR = 'apps/web/src';

// 色碼：# 後面剛好 3、4、6、8 位十六進位，且後面不再接英數字（避免把 #main-id 之類誤判）
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/;
const FUNC = /\b(?:rgb|rgba|hsl)\(/i;

/** 把註解換成同樣數量的換行與空白，行號不變。 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 只看宣告的值（冒號之後、分號或換行之前），回傳違規的行號（1 起算）。 */
export function findViolations(css) {
  const out = [];
  stripComments(css)
    .split('\n')
    .forEach((line, i) => {
      const colon = line.indexOf(':');
      if (colon === -1 && line.includes('{')) return;
      const value = colon === -1 ? line : line.slice(colon + 1); // 沒有冒號＝多行宣告的後續行
      if (HEX.test(value) || FUNC.test(value)) out.push(i + 1);
    });
  return out;
}

function listModuleCss(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : listModuleCss(p);
    return name.endsWith('.module.css') ? [p] : [];
  });
}

function main(argv) {
  const dir = argv[0] ?? DEFAULT_DIR;
  if (!existsSync(dir)) {
    process.stderr.write(`css-literals: ${dir} not found\n`);
    process.exit(1);
  }
  let bad = 0;
  for (const file of listModuleCss(dir)) {
    for (const line of findViolations(readFileSync(file, 'utf8'))) {
      process.stderr.write(`${file}:${String(line)}\n`);
      bad += 1;
    }
  }
  if (bad > 0) process.exit(1);
  process.stdout.write('css-literals: OK\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

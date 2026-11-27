import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = 'apps/web/src';
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const FUNCS = /\b(?:rgba?|hsla?)\(/g;
const DECLARATION_NAME = /^\s*(?:--[\w-]+|[a-zA-Z-]+)\s*:/;

/** 去掉 CSS 註解，保留換行，讓行號不變。 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * 回傳違規的行號（從 1 開始，由小到大、不重複）：宣告值裡有色碼或 rgb(／rgba(／hsl(／hsla(，
 * 值可以跨行，回報字面值所在的那一行。以 `{` 結尾的片段是選擇器或 at-rule 前導，不檢查。
 */
export function findViolations(css) {
  const text = stripComments(css);
  const lineAt = (index) => {
    let line = 1;
    for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
    return line;
  };
  const hits = new Set();
  const check = (start, end) => {
    const segment = text.slice(start, end);
    const head = DECLARATION_NAME.exec(segment);
    if (head === null) return;
    const valueStart = start + head[0].length;
    for (const pattern of [HEX, FUNCS]) {
      for (const m of text.slice(valueStart, end).matchAll(pattern)) hits.add(lineAt(valueStart + m.index));
    }
  };
  let segStart = 0;
  let parens = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      parens += 1;
    } else if (ch === ')') {
      parens = Math.max(0, parens - 1);
    } else if (parens === 0 && (ch === '{' || ch === ';' || ch === '}')) {
      if (ch !== '{') check(segStart, i);
      segStart = i + 1;
    }
  }
  check(segStart, text.length);
  return [...hits].sort((a, b) => a - b);
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

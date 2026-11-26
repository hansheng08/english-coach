// ARCHITECTURE §9.1.5：docs/design/tokens.json → apps/web/src/ui/tokens.css（只用 Node 內建模組；路徑相對於工作目錄）。
//   node tooling/tokens-css.mjs           寫檔
//   node tooling/tokens-css.mjs --check   只比對；不同、輸出檔不存在或解析失敗 → exit 1
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INPUT = 'docs/design/tokens.json';
export const OUTPUT = 'apps/web/src/ui/tokens.css';

const GROUPS = ['color', 'space', 'radius', 'font', 'shadow', 'motion'];
const NAME = /^[a-z0-9-]+$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const entriesOf = (o) => Object.entries(o).filter(([k]) => !k.startsWith('$'));

/** 回傳 { ok: true, vars } 或 { ok: false, reason }。vars: { name, light, dark | null }[]（照 tokens.json 鍵順序）。 */
export function parseTokens(json) {
  if (!isObject(json)) return { ok: false, reason: 'tokens.json: top level must be an object' };
  const vars = [];
  const seen = new Set();
  const fail = (reason) => ({ ok: false, reason });

  const walk = (node, parts) => {
    for (const [key, value] of entriesOf(node)) {
      const here = [...parts, key];
      const label = here.join('.');
      if (!NAME.test(key)) return fail(`invalid token name "${label}" (only a-z, 0-9 and -)`);
      if (typeof value === 'string') {
        const r = add(here, value, null);
        if (r) return r;
      } else if (isObject(value)) {
        const inner = Object.fromEntries(entriesOf(value));
        if (has(inner, 'light') || has(inner, 'dark')) {
          const keys = Object.keys(inner);
          if (keys.length !== 2 || typeof inner.light !== 'string' || typeof inner.dark !== 'string') {
            return fail(`"${label}" must be exactly { light, dark } with two string values`);
          }
          const r = add(here, inner.light, inner.dark);
          if (r) return r;
        } else {
          const r = walk(value, here);
          if (r) return r;
        }
      } else {
        return fail(`"${label}" must be a string, { light, dark } or a nested object`);
      }
    }
    return null;
  };

  const add = (parts, light, dark) => {
    const name = parts.join('-');
    if (seen.has(name)) return fail(`duplicate token name "--${name}"`);
    seen.add(name);
    vars.push({ name, light, dark });
    return null;
  };

  for (const [group, node] of entriesOf(json)) {
    if (!GROUPS.includes(group)) return fail(`unknown top-level group "${group}"`);
    if (!isObject(node)) return fail(`group "${group}" must be an object`);
    if (has(node, 'light') || has(node, 'dark')) return fail(`group "${group}" must not be a { light, dark } value`);
    const r = walk(node, [group]);
    if (r) return r;
  }
  return { ok: true, vars };
}

export function renderCss(vars) {
  const lines = (list, pick) => list.flatMap((v) => (pick(v) === null ? [] : [`${pad}--${v.name}: ${pick(v)};`]));
  const pad = '  ';
  const darkVars = vars.filter((v) => v.dark !== null);
  const darkBody = (indent) =>
    [...darkVars.map((v) => `${indent}--${v.name}: ${v.dark};`), `${indent}color-scheme: dark;`].join('\n');
  return [
    '/* 自動產生，不要手改。來源：docs/design/tokens.json；產生器：node tooling/tokens-css.mjs */',
    ':root {',
    ...lines(vars, (v) => v.light),
    '  color-scheme: light;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    darkBody('    '),
    '  }',
    '}',
    ':root[data-theme="dark"] {',
    darkBody('  '),
    '}',
    '',
  ].join('\n');
}

export function generate(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'tokens.json: not valid JSON' };
  }
  const parsed = parseTokens(json);
  if (!parsed.ok) return parsed;
  return { ok: true, css: renderCss(parsed.vars) };
}

function main(argv) {
  const check = argv.includes('--check');
  const unknown = argv.filter((a) => a !== '--check');
  const fail = (reason) => {
    process.stderr.write(`tokens-css: ${reason}\n`);
    process.exit(1);
  };
  if (unknown.length > 0) fail(`unknown argument: ${unknown.join(' ')}`);
  if (!existsSync(INPUT)) fail(`${INPUT} not found`);
  const r = generate(readFileSync(INPUT, 'utf8'));
  if (!r.ok) fail(r.reason);
  if (check) {
    if (!existsSync(OUTPUT)) fail(`${OUTPUT} does not exist; run node tooling/tokens-css.mjs`);
    if (readFileSync(OUTPUT, 'utf8') !== r.css) fail(`${OUTPUT} is out of date; run node tooling/tokens-css.mjs`);
    process.stdout.write('tokens-css: OK\n');
    return;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, r.css);
  process.stdout.write(`tokens-css: wrote ${OUTPUT}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

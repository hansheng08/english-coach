import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const INPUT = 'docs/design/tokens.json';
const OUTPUT = 'apps/web/src/ui/tokens.css';
const GROUPS = ['color', 'space', 'radius', 'font', 'shadow', 'motion'];
const NAME = /^[a-z0-9-]+$/;
const HEADER = `/* 自動產生，不要手改。來源：${INPUT}；產生器：tooling/tokens-css.mjs */`;

// 物件以 Map 表示：保留原文鍵的順序（JSON.parse 會把 "10"、"2" 這類整數鍵排到最前面）。
const isPlainObject = (v) => v instanceof Map;
const dataKeys = (obj) => [...obj.keys()].filter((k) => !k.startsWith('$'));

/** 讀 JSON 原文，物件變 Map（鍵依出現順序）。語法先由 JSON.parse 驗過；同一物件重複的鍵 → 失敗。 */
function parseOrdered(text) {
  let i = 0;
  const skip = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i += 1;
  };
  const string = () => {
    const start = i;
    i += 1;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i += 1;
    return JSON.parse(text.slice(start, i));
  };
  const value = () => {
    skip();
    const ch = text[i];
    if (ch === '{') {
      i += 1;
      const map = new Map();
      skip();
      if (text[i] === '}') {
        i += 1;
        return { value: map };
      }
      for (;;) {
        skip();
        const key = string();
        if (map.has(key)) return { duplicate: key };
        skip();
        i += 1; // ':'
        const member = value();
        if ('duplicate' in member) return member;
        map.set(key, member.value);
        skip();
        const sep = text[i];
        i += 1;
        if (sep === '}') return { value: map };
      }
    }
    if (ch === '[') {
      i += 1;
      const list = [];
      skip();
      if (text[i] === ']') {
        i += 1;
        return { value: list };
      }
      for (;;) {
        const item = value();
        if ('duplicate' in item) return item;
        list.push(item.value);
        skip();
        const sep = text[i];
        i += 1;
        if (sep === ']') return { value: list };
      }
    }
    if (ch === '"') return { value: string() };
    const start = i;
    while (i < text.length && !',]} \t\n\r'.includes(text[i])) i += 1;
    return { value: JSON.parse(text.slice(start, i)) };
  };
  return value();
}

/** 解析 tokens.json（ARCHITECTURE §9.1.5 規則 1～7）。成功回 { ok: true, tokens: [{ name, light, dark, split }] }。 */
export function parseTokens(text) {
  try {
    JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `tokens.json 無法解析：${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = parseOrdered(text);
  if ('duplicate' in parsed) return { ok: false, reason: `同一個物件裡的鍵重複：${parsed.duplicate}` };
  const json = parsed.value;
  if (!isPlainObject(json)) return { ok: false, reason: 'tokens.json 頂層不是物件' };
  for (const key of dataKeys(json)) {
    if (!GROUPS.includes(key)) return { ok: false, reason: `不認得的群組：${key}（只能是 ${GROUPS.join('、')}）` };
    if (!isPlainObject(json.get(key))) return { ok: false, reason: `群組 ${key} 必須是物件` };
  }

  const tokens = [];
  const seen = new Set();
  const add = (path, light, dark, split) => {
    const name = path.join('-');
    if (seen.has(name)) return `攤平後名稱重複：--${name}`;
    seen.add(name);
    tokens.push({ name, light, dark, split });
    return null;
  };
  const walk = (node, path) => {
    for (const key of dataKeys(node)) {
      const where = [...path, key];
      if (!NAME.test(key)) return `名稱只能是小寫英數和 -：${where.join('.')}`;
      const value = node.get(key);
      let failure;
      if (typeof value === 'string') {
        failure = add(where, value, value, false);
      } else if (isPlainObject(value)) {
        const keys = dataKeys(value);
        if (keys.length === 0) {
          failure = `群組或子類別是空的（去掉 $ 鍵後沒有任何鍵）：${where.join('.')}`;
        } else if (keys.includes('light') || keys.includes('dark')) {
          const exact = keys.length === 2 && typeof value.get('light') === 'string' && typeof value.get('dark') === 'string';
          failure = exact
            ? add(where, value.get('light'), value.get('dark'), true)
            : `物件含 light 或 dark，但不是剛好兩個字串值 { light, dark }：${where.join('.')}`;
        } else {
          failure = walk(value, where);
        }
      } else {
        failure = `值必須是字串、{ light, dark } 或巢狀物件：${where.join('.')}`;
      }
      if (failure !== null) return failure;
    }
    return null;
  };
  for (const group of dataKeys(json)) {
    const failure = walk(new Map([[group, json.get(group)]]), []);
    if (failure !== null) return { ok: false, reason: failure };
  }
  return { ok: true, tokens };
}

/** 輸出 CSS：:root 放淺色（含共用值）、兩段深色只放有 { light, dark } 的 token（ARCHITECTURE §9.1.4）。 */
export function generateCss(text) {
  const parsed = parseTokens(text);
  if (!parsed.ok) return parsed;
  const light = parsed.tokens.map((t) => `--${t.name}: ${t.light};`);
  const dark = parsed.tokens.filter((t) => t.split).map((t) => `--${t.name}: ${t.dark};`);
  const indent = (prefix, lines) => lines.map((l) => `${prefix}${l}`);
  const out = [
    HEADER,
    ':root {',
    ...indent('  ', light),
    '  color-scheme: light;',
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    ...indent('    ', dark),
    '    color-scheme: dark;',
    '  }',
    '}',
    '',
    ':root[data-theme="dark"] {',
    ...indent('  ', dark),
    '  color-scheme: dark;',
    '}',
    '',
  ];
  return { ok: true, css: out.join('\n') };
}

function fail(reason) {
  process.stderr.write(`tokens-css: ${reason}\n`);
  return 1;
}

export function run(argv) {
  const check = argv.includes('--check');
  const unknown = argv.filter((a) => a !== '--check');
  if (unknown.length > 0) return fail(`不認得的參數：${unknown.join(' ')}`);
  if (!existsSync(INPUT)) return fail(`找不到 ${INPUT}`);
  const generated = generateCss(readFileSync(INPUT, 'utf8'));
  if (!generated.ok) return fail(generated.reason);
  if (check) {
    if (!existsSync(OUTPUT)) return fail(`找不到 ${OUTPUT}；先執行 node tooling/tokens-css.mjs`);
    if (readFileSync(OUTPUT, 'utf8') !== generated.css) return fail(`${OUTPUT} 與 ${INPUT} 不一致；先執行 node tooling/tokens-css.mjs`);
    process.stdout.write('tokens-css: OK\n');
    return 0;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, generated.css);
  process.stdout.write(`tokens-css: wrote ${OUTPUT}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}

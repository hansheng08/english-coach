// PR 說明檢查（O-016）：改到 .github/workflows/** 時，「Actions 分鐘數影響」一節必須真的填了。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HEADING = '## Actions 分鐘數影響';
const PLACEHOLDER = '（改到 .github/workflows/** 時必填：預估每月增減的分鐘數與算法，或「無影響：理由」）';
const EMPTY_LINE_RE = /^(-|\*|無|N\/A|TBD|待補)$/i;
const MINUTES_RE = /\d[\d,]*(\.\d+)?\s*分鐘/;
const NO_IMPACT_RE = /^[-*]?\s*無影響[：:]\s*\S/;

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function workflowsChanged(files) {
  return isStringArray(files) && files.some((f) => f.startsWith('.github/workflows/'));
}

function result(ok, rule, message) {
  return { ok, rule, message };
}

function sectionOf(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimEnd() === HEADING);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

export function lintPrBody(body, files) {
  if (!isStringArray(files)) return result(false, 'INPUT', 'files 必須是字串陣列');
  if (!workflowsChanged(files)) return result(true, null, '沒有改到 .github/workflows/**，不需填寫');
  if (typeof body !== 'string') return result(false, 'PB-MISSING', `PR 說明不是文字，找不到「${HEADING}」一節`);
  const section = sectionOf(body);
  if (section === null) return result(false, 'PB-MISSING', `改到 .github/workflows/**，但 PR 說明沒有「${HEADING}」一節`);

  const lines = section
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/, '')
    .split('\n')
    .map((l) => l.trim());
  const hadPlaceholder = lines.includes(PLACEHOLDER);
  const filled = lines.filter((l) => l !== '' && l !== PLACEHOLDER && !EMPTY_LINE_RE.test(l));
  if (filled.length === 0) {
    return hadPlaceholder
      ? result(false, 'PB-PLACEHOLDER', `「${HEADING}」還是佔位文字，請填預估分鐘數與算法，或「無影響：理由」`)
      : result(false, 'PB-EMPTY', `「${HEADING}」是空的，請填預估分鐘數與算法，或「無影響：理由」`);
  }
  if (!filled.some((l) => MINUTES_RE.test(l) || NO_IMPACT_RE.test(l))) {
    return result(false, 'PB-VAGUE', `「${HEADING}」要有「數字＋分鐘」，或以「無影響：」開頭並寫理由`);
  }
  return result(true, null, `「${HEADING}」已填寫`);
}

function usage(message) {
  return { code: 1, stdout: '', stderr: `pr-body-lint: FAIL USAGE ${message}\n` };
}

function readLines(path) {
  try {
    return { text: readFileSync(path, 'utf8') };
  } catch (e) {
    return { error: `讀不到 ${path}：${e instanceof Error ? e.message : 'unknown'}` };
  }
}

export function run(argv) {
  const opts = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== '--body' && flag !== '--changed') return usage(`未知選項 ${String(flag)}`);
    const value = argv[i + 1];
    if (value === undefined) return usage(`${flag} 缺少值`);
    if (opts.has(flag)) return usage(`${flag} 重複`);
    opts.set(flag, value);
  }
  if (!opts.has('--body') || !opts.has('--changed')) return usage('需要 --body <檔案> --changed <檔案>');

  const body = readLines(opts.get('--body'));
  const changed = readLines(opts.get('--changed'));
  for (const r of [body, changed]) {
    if ('error' in r) return { code: 1, stdout: '', stderr: `pr-body-lint: FAIL INPUT ${r.error}\n` };
  }
  const files = changed.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const res = lintPrBody(body.text, files);
  if (!res.ok) return { code: 1, stdout: '', stderr: `pr-body-lint: FAIL ${res.rule} ${res.message}\n` };
  return { code: 0, stdout: `pr-body-lint: OK ${res.message}\n`, stderr: '' };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}

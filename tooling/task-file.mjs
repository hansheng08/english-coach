// 任務單解析與 CLI 共用工具（O-008）。只用 node: 內建模組；解析函式不丟例外。
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const AC_ANY_RE = /AC-([A-Za-z]+\d+)-(\d+)/g;

export function splitLines(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// "T-023"→"T23"、"T-012-fix1"→"T12"、"O-008"→"O8"
export function acPrefix(id) {
  const m = /^([A-Za-z]+)-(\d+)/.exec(id);
  if (m === null) return id.replace(/[^A-Za-z0-9]/g, '');
  return `${(m[1] ?? '').toUpperCase()}${String(Number(m[2]))}`;
}

// "task/T-023"→"T-023"、"fix/Q-012"→"Q-012"、其他→null
export function branchId(branch) {
  if (typeof branch !== 'string') return null;
  const m = /^(?:task\/([TQOAP]-\d{3})|fix\/(Q-\d{3}))$/.exec(branch);
  if (m === null) return null;
  return m[1] ?? m[2] ?? null;
}

// `**` 可跨 `/`（含零層）；`*`、`?` 不跨 `/`；其餘逐字比對。
export function matchGlob(pattern, path) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      const atSegmentStart = i === 0 || pattern[i - 1] === '/';
      if (atSegmentStart && pattern[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
    } else if (c === '*') {
      re += '[^/]*';
      i += 1;
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += (c ?? '').replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`).test(path);
}

// 掃描程式碼區塊。回傳 blocks 與每行是否在區塊內（含開關行）。
export function scanFences(lines) {
  const blocks = [];
  const inFence = new Array(lines.length).fill(false);
  let cur = null;
  lines.forEach((text, idx) => {
    const m = FENCE_RE.exec(text);
    if (cur === null) {
      if (m !== null) {
        const marker = m[1] ?? '';
        const info = (m[2] ?? '').trim();
        cur = {
          open: idx + 1,
          char: marker[0],
          len: marker.length,
          lang: (/^[\w+-]+/.exec(info)?.[0] ?? '').toLowerCase(),
          content: [],
          closed: false,
        };
        inFence[idx] = true;
      }
      return;
    }
    inFence[idx] = true;
    const isClose = m !== null && (m[1] ?? '')[0] === cur.char && (m[1] ?? '').length >= cur.len && (m[2] ?? '').trim() === '';
    if (isClose) {
      cur.closed = true;
      blocks.push(cur);
      cur = null;
    } else {
      cur.content.push({ n: idx + 1, text });
    }
  });
  if (cur !== null) blocks.push(cur);
  return { blocks, inFence };
}

// 取得以 `prefix` 開頭的二級標題（區塊外）到下一個二級標題之間的範圍。回傳 0 起算索引。
export function findSection(lines, inFence, prefix) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!inFence[i] && (lines[i] ?? '').startsWith(prefix) && (lines[i] ?? '').startsWith('## ')) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!inFence[i] && (lines[i] ?? '').startsWith('## ')) {
      end = i;
      break;
    }
  }
  return { start, end };
}

// 在二級區間內找以 `prefix` 開頭的三級標題範圍。
function findSub(lines, inFence, sec, prefix) {
  let start = -1;
  for (let i = sec.start + 1; i < sec.end; i += 1) {
    if (!inFence[i] && (lines[i] ?? '').startsWith(prefix) && (lines[i] ?? '').startsWith('### ')) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = sec.end;
  for (let i = start + 1; i < sec.end; i += 1) {
    if (!inFence[i] && (lines[i] ?? '').startsWith('### ')) {
      end = i;
      break;
    }
  }
  return { start, end };
}

const LIST_ITEM_RE = /^\s*- (?:\[[ xX]\] )?(.*)$/;

function firstBacktick(text) {
  const m = /`([^`]+)`/.exec(text);
  return m === null ? null : (m[1] ?? null);
}

function listBackticks(lines, sub) {
  const out = [];
  if (sub === null) return out;
  for (let i = sub.start + 1; i < sub.end; i += 1) {
    const item = LIST_ITEM_RE.exec(lines[i] ?? '');
    if (item === null) continue;
    const p = firstBacktick(item[1] ?? '');
    if (p !== null) out.push({ path: p, line: i + 1 });
  }
  return out;
}

export const TC_HEADER = ['TC', '對應 AC', '情境', '輸入', '預期輸出／錯誤'];

export function splitRow(line) {
  const cells = line.trim().split('|').map((c) => c.trim());
  if (cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

// 解析測試案例表。回傳 { headerOk, headerLine, rows }。
export function parseTcTable(lines, inFence) {
  const sec = findSection(lines, inFence, '## 測試案例');
  const result = { sectionFound: sec !== null, headerOk: false, headerLine: sec === null ? 1 : sec.start + 1, rows: [] };
  if (sec === null) return result;
  let i = sec.start + 1;
  while (i < sec.end && !(lines[i] ?? '').trimStart().startsWith('|')) i += 1;
  if (i >= sec.end) return result;
  const header = splitRow(lines[i] ?? '');
  result.headerLine = i + 1;
  result.headerOk = header.length === TC_HEADER.length && header.every((c, k) => c === TC_HEADER[k]);
  if (!result.headerOk) return result;
  i += 1;
  for (; i < sec.end; i += 1) {
    const text = lines[i] ?? '';
    if (!text.trimStart().startsWith('|')) break;
    const cells = splitRow(text);
    if (cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const acs = [...(cells[1] ?? '').matchAll(AC_ANY_RE)].map((m) => m[0]);
    result.rows.push({ tc: cells[0] ?? '', acs, line: i + 1 });
  }
  return result;
}

// 解析任務單。不丟例外。額外欄位（hasDo、acDefs 等）供 lint 與 scope-check 使用。
export function parseTaskFile(task) {
  const lines = splitLines(task.text);
  const { inFence } = scanFences(lines);
  const prefix = acPrefix(task.id);

  let branch = null;
  const branchSec = findSection(lines, inFence, '## 分支');
  if (branchSec !== null) {
    for (let i = branchSec.start + 1; i < branchSec.end; i += 1) {
      const p = firstBacktick(lines[i] ?? '');
      if (p !== null) {
        branch = p;
        break;
      }
    }
  }

  const acDefs = [];
  const acSec = findSection(lines, inFence, '## 驗收標準');
  if (acSec !== null) {
    const defRe = new RegExp(`AC-${prefix}-\\d+`);
    for (let i = acSec.start + 1; i < acSec.end; i += 1) {
      if (inFence[i]) continue;
      const item = LIST_ITEM_RE.exec(lines[i] ?? '');
      if (item === null) continue;
      const m = defRe.exec(item[1] ?? '');
      if (m !== null) acDefs.push({ id: m[0], line: i + 1 });
    }
  }

  const tc = parseTcTable(lines, inFence);

  const allow = [];
  const deny = [];
  let hasDo = false;
  const scopeSec = findSection(lines, inFence, '## 檔案範圍');
  if (scopeSec !== null) {
    const doSub = findSub(lines, inFence, scopeSec, '### 要做');
    hasDo = doSub !== null;
    for (const e of listBackticks(lines, doSub)) allow.push(e.path);
    for (const e of listBackticks(lines, findSub(lines, inFence, scopeSec, '### 其他角色'))) allow.push(e.path);
    for (const e of listBackticks(lines, findSub(lines, inFence, scopeSec, '### 範圍外'))) deny.push(e.path);
  }

  return {
    id: task.id,
    branch,
    acIds: acDefs.map((d) => d.id),
    tcRows: tc.rows.map((r) => ({ tc: r.tc, acs: r.acs, line: r.line })),
    allow,
    deny,
    hasDo,
    acDefs,
    hasTcHeader: tc.headerOk,
  };
}

// ---- CLI 共用 -------------------------------------------------------------

export function isMain(metaUrl) {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry === '') return false;
  return metaUrl === pathToFileURL(resolve(entry)).href;
}

export function failure(tool, findings) {
  const lines = findings.map((f) => `${tool}: FAIL ${f.file}:${String(f.line)}: ${f.rule}: ${f.message}`);
  lines.push(`${tool}: ${String(findings.length)} error(s)`);
  return { code: 1, stdout: '', stderr: `${lines.join('\n')}\n` };
}

export function success(tool, targets) {
  return { code: 0, stdout: `${targets.map((t) => `${tool}: OK ${t}`).join('\n')}\n`, stderr: '' };
}

export function usageFailure(tool, rule, message) {
  return failure(tool, [{ file: '-', line: 0, rule, message }]);
}

// 只接受 `--name value` 與 `--name=value`；未知選項、缺值、重複都算 USAGE。
export function parseArgs(argv, { options, positional }) {
  const values = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
      if (!options.includes(name)) return { ok: false, message: `unknown option --${name}` };
      if (name in values) return { ok: false, message: `duplicate option --${name}` };
      let value;
      if (eq >= 0) {
        value = arg.slice(eq + 1);
      } else {
        value = argv[i + 1];
        i += 1;
      }
      if (typeof value !== 'string' || value === '' || (eq < 0 && value.startsWith('--'))) {
        return { ok: false, message: `option --${name} needs a value` };
      }
      values[name] = value;
    } else if (positional) {
      positionals.push(arg);
    } else {
      return { ok: false, message: `unexpected argument ${arg}` };
    }
  }
  return { ok: true, values, positionals };
}

export function readText(path) {
  try {
    return { ok: true, text: readFileSync(path, 'utf8') };
  } catch (e) {
    return { ok: false, message: `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function loadTasks(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch (e) {
    return { ok: false, message: `cannot read tasks dir ${dir}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const tasks = [];
  for (const name of names) {
    const path = join(dir, name);
    const r = readText(path);
    if (!r.ok) return r;
    tasks.push({ id: basename(name, '.md'), path, text: r.text });
  }
  return { ok: true, tasks };
}

export function tasksForBranch(branch, tasks) {
  return tasks.map((t) => ({ task: t, parsed: parseTaskFile(t) })).filter((x) => x.parsed.branch === branch);
}

// CLI 進入點：任何未捕捉的例外都轉成 exit 1。
export function runCli(tool, run) {
  let result;
  try {
    result = run(process.argv.slice(2));
  } catch (e) {
    result = usageFailure(tool, 'INPUT', `unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exitCode = result.code === 0 ? 0 : 1;
}

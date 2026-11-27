// AC／TC 覆蓋檢查（O-008）：讀 `vitest run --reporter=json` 的結果。fail-closed。
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  failure,
  isMain,
  loadTasks,
  parseArgs,
  readText,
  runCli,
  success,
  tasksForBranch,
  usageFailure,
} from './task-file.mjs';
import { parseTap, tapToTests } from './tap.mjs';

const TOOL = 'ac-coverage';

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 回傳 { tests } 或 { error }。
function collectTests(results) {
  if (!isRecord(results) || !Array.isArray(results.testResults)) return { error: 'JSON 缺少 testResults 陣列' };
  const tests = [];
  for (const tr of results.testResults) {
    if (!isRecord(tr) || !Array.isArray(tr.assertionResults)) return { error: 'testResults[] 缺少 assertionResults 陣列' };
    for (const a of tr.assertionResults) {
      if (!isRecord(a) || typeof a.fullName !== 'string' || typeof a.status !== 'string') {
        return { error: 'assertionResults[] 缺少 fullName 或 status' };
      }
      tests.push({ name: a.fullName, status: a.status });
    }
  }
  return { tests };
}

// Playwright 單筆測試 → 'passed'／'failed'／'skipped'（O-025）。
// passed：expectedStatus=passed、outcome 為 expected／flaky、且最後一筆 result 為 passed。
function playwrightStatus(t) {
  if (t.expectedStatus !== 'passed') return 'skipped'; // 含 expected-fail、skipped
  if (t.status === 'skipped') return 'skipped';
  if (t.results.length === 0) return 'skipped';
  const last = t.results[t.results.length - 1];
  if (!isRecord(last) || typeof last.status !== 'string') return null;
  if (last.status === 'skipped') return 'skipped';
  if (t.status === 'unexpected' || last.status !== 'passed') return 'failed';
  return t.status === 'expected' || t.status === 'flaky' ? 'passed' : null;
}

// 遞迴走 suites；回傳 { tests } 或 { error }。
function collectPlaywright(json) {
  if (!isRecord(json) || !Array.isArray(json.suites)) return { error: 'Playwright JSON 缺少 suites 陣列' };
  const tests = [];
  const walk = (suite, titles) => {
    if (!isRecord(suite)) return 'suites[] 不是物件';
    const here = typeof suite.title === 'string' && suite.title !== '' ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      if (!isRecord(spec) || typeof spec.title !== 'string' || !Array.isArray(spec.tests)) return 'specs[] 缺少 title 或 tests 陣列';
      for (const t of spec.tests) {
        if (!isRecord(t) || typeof t.status !== 'string' || typeof t.expectedStatus !== 'string' || !Array.isArray(t.results)) {
          return 'tests[] 缺少 status、expectedStatus 或 results 陣列';
        }
        const status = playwrightStatus(t);
        if (status === null) return 'tests[] 的 status 或 results 無法判斷';
        tests.push({ name: [...here, spec.title].join(' '), status });
      }
    }
    if (suite.suites !== undefined && !Array.isArray(suite.suites)) return 'suites 不是陣列';
    for (const child of suite.suites ?? []) {
      const e = walk(child, here);
      if (e !== undefined) return e;
    }
    return undefined;
  };
  for (const s of json.suites) {
    const e = walk(s, []);
    if (e !== undefined) return { error: `Playwright JSON：${e}` };
  }
  return { tests };
}

// e2e 規格檔掃描（O-027）：只認標籤原文。回傳 { texts } 或 { error }。
const E2E_FILE_RE = /\.(?:spec|test)\.(?:ts|js|mjs|cjs)$/;

export function loadE2eSpecs(dirs, { explicit }) {
  const texts = [];
  for (const dir of dirs) {
    let names;
    try {
      names = readdirSync(dir, { recursive: true });
    } catch (e) {
      if (!explicit && e instanceof Error && e.code === 'ENOENT') continue;
      return { error: `cannot read e2e dir ${dir}: ${e instanceof Error ? e.message : String(e)}` };
    }
    for (const name of names.map(String).sort()) {
      if (!E2E_FILE_RE.test(name)) continue;
      const raw = readText(join(dir, name));
      if (!raw.ok) return { error: raw.message };
      texts.push(raw.text);
    }
  }
  return { texts };
}

export function checkCoverage({ branch, tasks, results, taps, playwright, e2eSkipped = false, e2eTexts = [] }) {
  const set = tasksForBranch(branch, tasks);
  if (set.length === 0) return [{ file: branch, line: 0, rule: 'CV-NOTASK', message: `找不到分支 ${branch} 對應的任務單` }];
  if (results === undefined && taps === undefined && playwright === undefined) {
    return [{ file: '-', line: 0, rule: 'INPUT', message: '沒有任何測試結果（需要 results、taps 或 playwright）' }];
  }
  const collected = results === undefined ? { tests: [] } : collectTests(results);
  if (collected.error !== undefined) return [{ file: '-', line: 0, rule: 'INPUT', message: collected.error }];
  const unitNames = [];
  const addUnit = (tests) => unitNames.push(...tests.map((t) => t.name));
  addUnit(collected.tests);
  for (const pw of playwright ?? []) {
    const c = collectPlaywright(pw);
    if (c.error !== undefined) return [{ file: '-', line: 0, rule: 'INPUT', message: c.error }];
    collected.tests.push(...c.tests);
  }
  for (const tap of taps ?? []) {
    if (tap.errors.length > 0) {
      return tap.errors.map((e) => ({ file: tap.file, line: e.line, rule: 'INPUT', message: `${e.rule}: ${e.message}` }));
    }
    const tapTests = tapToTests(tap);
    addUnit(tapTests);
    collected.tests.push(...tapTests);
  }

  const findings = [];
  // markers：全部都要出現在測試名稱裡才算相關
  const matches = (name, markerSets) => markerSets.some((ms) => ms.every((m) => name.includes(m)));
  const check = (file, line, label, markerSets) => {
    const related = collected.tests.filter((t) => matches(t.name, markerSets));
    if (related.some((t) => t.status === 'failed')) {
      findings.push({ file, line, rule: 'CV-FAILED', message: `${label} 有失敗的測試` });
    } else if (!related.some((t) => t.status === 'passed')) {
      // 僅 E2E：不在 Vitest／TAP 任何名稱裡，且標籤出現在 e2e 規格檔原始碼（O-027）
      const e2eOnly = e2eSkipped && !unitNames.some((n) => matches(n, markerSets)) && e2eTexts.some((x) => matches(x, markerSets));
      if (e2eOnly) {
        findings.push({ file, line, rule: 'CV-DEFERRED-PR', message: `${label} 只由 E2E 覆蓋，push 延到 PR 判定` });
      } else {
        findings.push({ file, line, rule: 'CV-MISSING', message: `${label} 沒有通過的測試（略過、待辦不算覆蓋）` });
      }
    }
  };

  for (const { task, parsed } of set) {
    for (const d of parsed.acDefs) check(task.path, d.line, d.id, [[`(${d.id})`]]);
    for (const r of parsed.tcRows) {
      const acs = r.acs.length > 0 ? r.acs : ['(no-ac)'];
      check(task.path, r.line, `${r.tc}（${r.acs.join(',')}）`, acs.map((a) => [`(${r.tc})`, `(${a})`]));
    }
  }
  return findings;
}

const USAGE_TEXT =
  'usage: ac-coverage.mjs --branch <name> [--results <vitest.json>] [--tap <file.tap> ...] [--playwright <file.json> ...] [--tasks-dir <dir>] [--event <name>] [--e2e-skipped] [--e2e-dir <dir> ...]';

// --tap、--playwright、--e2e-dir 可重複，--e2e-skipped 是旗標：先從 argv 抽出，其餘交給 parseArgs。
function splitRepeatArgs(argv) {
  const paths = { tap: [], playwright: [], 'e2e-dir': [] };
  const rest = [];
  let e2eSkipped = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--e2e-skipped') {
      e2eSkipped = true;
      continue;
    }
    const name = Object.keys(paths).find((n) => arg === `--${n}` || arg.startsWith(`--${n}=`));
    if (name === undefined) {
      rest.push(arg);
    } else if (arg === `--${name}`) {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value === '' || value.startsWith('--')) return { ok: false, message: `option --${name} needs a value` };
      paths[name].push(value);
      i += 1;
    } else {
      const value = arg.slice(`--${name}=`.length);
      if (value === '') return { ok: false, message: `option --${name} needs a value` };
      paths[name].push(value);
    }
  }
  return { ok: true, tapPaths: paths.tap, playwrightPaths: paths.playwright, e2eDirs: paths['e2e-dir'], e2eSkipped, rest };
}

export function run(argv) {
  const split = splitRepeatArgs(argv);
  if (!split.ok) return usageFailure(TOOL, 'USAGE', split.message);
  const args = parseArgs(split.rest, { options: ['branch', 'results', 'tasks-dir', 'event'], positional: false });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const { branch, results, event } = args.values;
  // fail-closed：--e2e-skipped 只在 push 事件合法（O-027）
  if (split.e2eSkipped && event !== 'push') {
    return usageFailure(TOOL, 'INPUT', `--e2e-skipped 只允許搭配 --event push（目前：${event ?? '未提供'}）`);
  }
  if (branch === undefined || (results === undefined && split.tapPaths.length === 0 && split.playwrightPaths.length === 0)) {
    return usageFailure(TOOL, 'USAGE', USAGE_TEXT);
  }
  const playwright = [];
  for (const p of split.playwrightPaths) {
    const raw = readText(p);
    if (!raw.ok) return usageFailure(TOOL, 'INPUT', raw.message);
    if (raw.text.trim() === '') return usageFailure(TOOL, 'INPUT', `${p}: 空檔`);
    try {
      playwright.push(JSON.parse(raw.text));
    } catch (e) {
      return usageFailure(TOOL, 'INPUT', `${p}: JSON 無法解析：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let json;
  if (results !== undefined) {
    const raw = readText(results);
    if (!raw.ok) return usageFailure(TOOL, 'INPUT', raw.message);
    try {
      json = JSON.parse(raw.text);
    } catch (e) {
      return usageFailure(TOOL, 'INPUT', `JSON 無法解析：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const taps = [];
  for (const p of split.tapPaths) {
    const raw = readText(p);
    if (!raw.ok) return usageFailure(TOOL, 'INPUT', raw.message);
    const tap = parseTap(raw.text, p);
    if (tap.errors.length > 0) {
      return usageFailure(TOOL, 'INPUT', `${p}: ${tap.errors.map((e) => e.rule).join(',')}`);
    }
    taps.push(tap);
  }
  const loaded = loadTasks(args.values['tasks-dir'] ?? 'docs/tasks');
  if (!loaded.ok) return usageFailure(TOOL, 'INPUT', loaded.message);
  let e2eTexts = [];
  if (split.e2eSkipped) {
    const specs = loadE2eSpecs(split.e2eDirs.length > 0 ? split.e2eDirs : ['test/e2e'], { explicit: split.e2eDirs.length > 0 });
    if (specs.error !== undefined) return usageFailure(TOOL, 'INPUT', specs.error);
    e2eTexts = specs.texts;
  }
  const findings = checkCoverage({ branch, tasks: loaded.tasks, results: json, taps: split.tapPaths.length > 0 ? taps : undefined,
    playwright: split.playwrightPaths.length > 0 ? playwright : undefined,
    e2eSkipped: split.e2eSkipped,
    e2eTexts,
  });
  const deferred = findings.filter((f) => f.rule === 'CV-DEFERRED-PR');
  const errors = findings.filter((f) => f.rule !== 'CV-DEFERRED-PR');
  const deferredLines = deferred.map((f) => `${TOOL}: ${f.rule} ${f.file}:${String(f.line)}: ${f.message}\n`).join('');
  if (errors.length > 0) {
    const r = failure(TOOL, errors);
    return { ...r, stderr: `${deferredLines}${r.stderr}` };
  }
  const ok = success(TOOL, [branch]);
  return { ...ok, stdout: `${deferredLines}${ok.stdout}` };
}

if (isMain(import.meta.url)) runCli(TOOL, run);

// AC／TC 覆蓋檢查（O-008）：讀 `vitest run --reporter=json` 的結果。fail-closed。
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

export function checkCoverage({ branch, tasks, results, taps }) {
  const set = tasksForBranch(branch, tasks);
  if (set.length === 0) return [{ file: branch, line: 0, rule: 'CV-NOTASK', message: `找不到分支 ${branch} 對應的任務單` }];
  if (results === undefined && taps === undefined) return [{ file: '-', line: 0, rule: 'INPUT', message: '沒有任何測試結果（需要 results 或 taps）' }];
  const collected = results === undefined ? { tests: [] } : collectTests(results);
  if (collected.error !== undefined) return [{ file: '-', line: 0, rule: 'INPUT', message: collected.error }];
  for (const tap of taps ?? []) {
    if (tap.errors.length > 0) {
      return tap.errors.map((e) => ({ file: tap.file, line: e.line, rule: 'INPUT', message: `${e.rule}: ${e.message}` }));
    }
    collected.tests.push(...tapToTests(tap));
  }

  const findings = [];
  // markers：全部都要出現在測試名稱裡才算相關
  const check = (file, line, label, markerSets) => {
    const related = collected.tests.filter((t) => markerSets.some((ms) => ms.every((m) => t.name.includes(m))));
    if (related.some((t) => t.status === 'failed')) {
      findings.push({ file, line, rule: 'CV-FAILED', message: `${label} 有失敗的測試` });
    } else if (!related.some((t) => t.status === 'passed')) {
      findings.push({ file, line, rule: 'CV-MISSING', message: `${label} 沒有通過的測試（略過、待辦不算覆蓋）` });
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

const USAGE_TEXT = 'usage: ac-coverage.mjs --branch <name> [--results <vitest.json>] [--tap <file.tap> ...] [--tasks-dir <dir>]';

// --tap 可重複：先從 argv 抽出，其餘交給 parseArgs。
function splitTapArgs(argv) {
  const tapPaths = [];
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--tap') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value === '' || value.startsWith('--')) return { ok: false, message: 'option --tap needs a value' };
      tapPaths.push(value);
      i += 1;
    } else if (arg.startsWith('--tap=')) {
      const value = arg.slice('--tap='.length);
      if (value === '') return { ok: false, message: 'option --tap needs a value' };
      tapPaths.push(value);
    } else {
      rest.push(arg);
    }
  }
  return { ok: true, tapPaths, rest };
}

export function run(argv) {
  const split = splitTapArgs(argv);
  if (!split.ok) return usageFailure(TOOL, 'USAGE', split.message);
  const args = parseArgs(split.rest, { options: ['branch', 'results', 'tasks-dir'], positional: false });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const { branch, results } = args.values;
  if (branch === undefined || (results === undefined && split.tapPaths.length === 0)) {
    return usageFailure(TOOL, 'USAGE', USAGE_TEXT);
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
  const findings = checkCoverage({ branch, tasks: loaded.tasks, results: json, taps: split.tapPaths.length > 0 ? taps : undefined });
  return findings.length > 0 ? failure(TOOL, findings) : success(TOOL, [branch]);
}

if (isMain(import.meta.url)) runCli(TOOL, run);

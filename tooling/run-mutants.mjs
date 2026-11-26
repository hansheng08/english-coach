// 套用 QA 的 mutants.json 並跑測試（O-009）。fail-closed；每筆突變後立即還原。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { failure, isMain, matchGlob, parseArgs, readText, runCli, usageFailure } from './task-file.mjs';

const TOOL = 'run-mutants';
const DEFAULT_RUNNER = ['pnpm', 'exec', 'vitest', 'run', '--reporter=json', '--outputFile={report}'];
const DEFAULT_TIMEOUT_MS = 600_000;
const TOP_KEYS = ['task', 'mutants'];
const MUTANT_KEYS = ['id', 'file', 'before', 'after', 'expectFail'];
const FORBIDDEN_TARGETS = [
  '**/*.test.*',
  '**/*.spec.*',
  'tooling/fixtures/**',
  'docs/**',
  '.github/**',
  '.claude/**',
  '**/node_modules/**',
];

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameKeys(obj, keys) {
  const actual = Object.keys(obj);
  return actual.length === keys.length && keys.every((k) => actual.includes(k));
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function targetProblem(file, root) {
  if (isAbsolute(file) || file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return '不可是絕對路徑';
  if (file.split(/[\\/]/).includes('..')) return '不可含 ..';
  const rel = file.replace(/^(?:\.\/)+/, '');
  const hit = FORBIDDEN_TARGETS.find((p) => matchGlob(p, rel));
  if (hit !== undefined) return `符合禁止的目標 ${hit}`;
  try {
    if (!lstatSync(resolve(root, file)).isFile()) return '不是一般檔案';
  } catch {
    return '檔案不存在';
  }
  return null;
}

export function validateMutants(data, { task, root }) {
  const where = `docs/qa/mutants/${task}.json`;
  const findings = [];
  const add = (line, rule, message) => findings.push({ file: where, line, rule, message });
  if (!isRecord(data)) return [{ file: where, line: 1, rule: 'MU-SCHEMA', message: '頂層不是物件' }];
  if (!sameKeys(data, TOP_KEYS)) add(1, 'MU-SCHEMA', '頂層欄位必須剛好是 task、mutants');
  if (data.task !== task) add(1, 'MU-SCHEMA', `task 必須等於檔名 ${task}`);
  if (!Array.isArray(data.mutants) || data.mutants.length === 0) {
    add(1, 'MU-SCHEMA', 'mutants 必須是非空陣列');
    return findings;
  }
  const seen = new Set();
  data.mutants.forEach((m, i) => {
    const line = i + 1;
    if (!isRecord(m)) {
      add(line, 'MU-SCHEMA', `第 ${String(line)} 筆不是物件`);
      return;
    }
    const label = typeof m.id === 'string' ? m.id : `#${String(line)}`;
    if (!sameKeys(m, MUTANT_KEYS)) add(line, 'MU-SCHEMA', `${label}: 欄位必須剛好是 ${MUTANT_KEYS.join('、')}`);
    if (typeof m.id !== 'string' || !/^M\d+$/.test(m.id)) add(line, 'MU-SCHEMA', `${label}: id 必須符合 M<數字>`);
    else if (seen.has(m.id)) add(line, 'MU-SCHEMA', `${label}: id 重複`);
    else seen.add(m.id);
    if (typeof m.before !== 'string' || m.before === '') add(line, 'MU-SCHEMA', `${label}: before 必須是非空字串`);
    if (typeof m.after !== 'string') add(line, 'MU-SCHEMA', `${label}: after 必須是字串`);
    else if (m.after === m.before) add(line, 'MU-SCHEMA', `${label}: after 不可等於 before`);
    if (!Array.isArray(m.expectFail) || m.expectFail.length === 0 || !m.expectFail.every((s) => typeof s === 'string' && s !== '')) {
      add(line, 'MU-SCHEMA', `${label}: expectFail 必須是非空字串陣列`);
    }
    if (typeof m.file !== 'string' || m.file === '') {
      add(line, 'MU-SCHEMA', `${label}: file 必須是字串`);
    } else {
      const p = targetProblem(m.file, root);
      if (p !== null) add(line, 'MU-TARGET', `${label}: ${m.file} ${p}`);
    }
  });
  return findings;
}

// 讀 Vitest JSON 報告；缺漏或無法解析回 null，否則回失敗測試的 fullName 陣列。
function readFailed(path) {
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(json) || !Array.isArray(json.testResults)) return null;
    const failed = [];
    for (const tr of json.testResults) {
      if (!isRecord(tr) || !Array.isArray(tr.assertionResults)) return null;
      for (const a of tr.assertionResults) {
        if (!isRecord(a) || typeof a.fullName !== 'string' || typeof a.status !== 'string') return null;
        if (a.status === 'failed') failed.push(a.fullName);
      }
    }
    return failed;
  } catch {
    return null;
  }
}

// 執行一次。回傳 { status, failed }；status 為 null 表示逾時或無法啟動，failed 為 null 表示報告不可用。
function invoke({ runner, root, timeoutMs, spawn, reportPath }) {
  rmSync(reportPath, { force: true });
  const argv = runner.map((a) => a.split('{report}').join(reportPath));
  try {
    const r = spawn(argv[0], argv.slice(1), { cwd: root, stdio: 'ignore', timeout: timeoutMs });
    if (r.error !== undefined && r.error !== null) return { status: null, failed: null };
    return { status: r.status, failed: readFailed(reportPath) };
  } catch {
    return { status: null, failed: null };
  }
}

// 預設解析：用 Vitest import graph（`vitest related`）找出會載入該檔的測試檔，每個檔只解析一次。
// 回傳 { tests } 或 { rule: 'MU-RELATED', error }。0 個測試回 { tests: [] }（呼叫端改跑完整套件）。
function defaultResolveRelated(sourceFile, { root, timeoutMs, spawn, reportPath }) {
  rmSync(reportPath, { force: true });
  try {
    const r = spawn('pnpm', ['exec', 'vitest', 'related', sourceFile, '--run', '--reporter=json', `--outputFile=${reportPath}`], {
      cwd: root,
      stdio: 'ignore',
      timeout: timeoutMs,
    });
    if (r.error !== undefined && r.error !== null) return { rule: 'MU-RELATED', error: '無法啟動或逾時' };
    const json = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (!isRecord(json) || !Array.isArray(json.testResults)) return { rule: 'MU-RELATED', error: '輸出沒有 testResults' };
    const tests = [];
    for (const tr of json.testResults) {
      if (!isRecord(tr) || typeof tr.name !== 'string') return { rule: 'MU-RELATED', error: 'testResults 格式不符' };
      tests.push(relative(root, resolve(root, tr.name)).split('\\').join('/'));
    }
    return { tests };
  } catch (e) {
    return { rule: 'MU-RELATED', error: e instanceof Error ? e.message : String(e) };
  }
}

function applyMutant(text, m) {
  const first = text.indexOf(m.before);
  return `${text.slice(0, first)}${m.after}${text.slice(first + m.before.length)}`;
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

// 回傳 { report, findings }。
// resolveRelated(sourceFile, ctx) → { tests } | { rule: 'MU-RELATED', error }；未注入時只有預設執行器才用 import graph 解析，
// 自訂執行器（`--` 之後）一律跑完整套件（行為同 O-009）。
export function execute({ file, root, runner = DEFAULT_RUNNER, timeoutMs = DEFAULT_TIMEOUT_MS, spawn = spawnSync, resolveRelated }) {
  if (resolveRelated === undefined && runner === DEFAULT_RUNNER) resolveRelated = defaultResolveRelated;
  const task = basename(file, '.json');
  const empty = { task, total: 0, killed: 0, survived: [], results: [] };
  const read = readText(file);
  if (!read.ok) return { report: empty, findings: [{ file, line: 0, rule: 'INPUT', message: read.message }] };
  let data;
  try {
    data = JSON.parse(read.text);
  } catch (e) {
    return { report: empty, findings: [{ file, line: 0, rule: 'INPUT', message: `JSON 無法解析：${e instanceof Error ? e.message : String(e)}` }] };
  }
  const schema = validateMutants(data, { task, root });
  const total = Array.isArray(data?.mutants) ? data.mutants.length : 0;
  if (schema.length > 0) return { report: { ...empty, total }, findings: schema };

  const targets = new Map();
  for (const m of data.mutants) {
    const abs = resolve(root, m.file);
    if (!targets.has(abs)) {
      const bytes = readFileSync(abs);
      targets.set(abs, { bytes, hash: sha256(bytes) });
    }
  }

  const findings = [];
  const results = [];
  const tmp = mkdtempSync(join(tmpdir(), 'run-mutants-'));
  const reportPath = join(tmp, 'report.json');
  const ctx = { runner, root, timeoutMs, spawn, reportPath };
  const related = new Map();
  try {
    const base = invoke(ctx);
    if (base.status !== 0 || base.failed === null || base.failed.length > 0) {
      findings.push({ file, line: 0, rule: 'MU-BASELINE', message: '未突變時測試就不通過（或報告不可用）；不套用任何突變' });
    } else {
      data.mutants.forEach((m, i) => {
        const line = i + 1;
        const abs = resolve(root, m.file);
        const original = targets.get(abs).bytes;
        const text = readFileSync(abs, 'utf8');
        const n = countOccurrences(text, m.before);
        if (n !== 1) {
          results.push({ id: m.id, status: 'unexpected', failedTests: [] });
          findings.push({ file, line, rule: 'MU-ANCHOR', message: `${m.id}: before 在 ${m.file} 出現 ${String(n)} 次（必須剛好 1 次）` });
          return;
        }
        let tests = [];
        if (resolveRelated !== undefined) {
          if (!related.has(m.file)) {
            let res;
            try {
              res = resolveRelated(m.file, { root, timeoutMs, spawn, reportPath: join(tmp, 'related.json') });
            } catch (e) {
              res = { rule: 'MU-RELATED', error: e instanceof Error ? e.message : String(e) };
            }
            const ok = isRecord(res) && Array.isArray(res.tests) && res.tests.every((t) => typeof t === 'string' && t !== '');
            related.set(m.file, ok ? { tests: res.tests } : { rule: 'MU-RELATED', error: isRecord(res) && typeof res.error === 'string' ? res.error : '解析結果格式不符' });
          }
          const res = related.get(m.file);
          if (res.rule !== undefined) {
            results.push({ id: m.id, status: 'unexpected', failedTests: [] });
            findings.push({ file, line, rule: 'MU-RELATED', message: `${m.id}: 無法解析 ${m.file} 的相關測試：${res.error}` });
            return;
          }
          tests = res.tests;
        }
        const runCtx = tests.length > 0 ? { ...ctx, runner: [...runner, ...tests] } : ctx;
        let outcome;
        try {
          writeFileSync(abs, applyMutant(text, m));
          outcome = invoke(runCtx);
        } finally {
          writeFileSync(abs, original);
        }
        if (outcome.status === 0) {
          results.push({ id: m.id, status: 'survived', failedTests: [] });
          findings.push({ file, line, rule: 'MU-SURVIVED', message: `${m.id}: 突變存活，測試沒有抓到` });
        } else if (outcome.status === null || outcome.failed === null) {
          results.push({ id: m.id, status: 'unexpected', failedTests: [] });
          findings.push({ file, line, rule: 'MU-RUNNER', message: `${m.id}: 執行器逾時、無法啟動，或沒有可用的報告` });
        } else if (outcome.failed.some((name) => m.expectFail.some((s) => name.includes(s)))) {
          results.push({ id: m.id, status: 'killed', failedTests: outcome.failed });
        } else {
          results.push({ id: m.id, status: 'unexpected', failedTests: outcome.failed });
          findings.push({ file, line, rule: 'MU-UNEXPECTED', message: `${m.id}: 失敗的測試都不含 expectFail` });
        }
      });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  for (const [abs, t] of targets) {
    if (sha256(readFileSync(abs)) !== t.hash) {
      findings.push({ file: abs, line: 0, rule: 'MU-RESTORE', message: '目標檔沒有還原成原始內容' });
      writeFileSync(abs, t.bytes);
    }
  }

  const report = {
    task,
    total,
    killed: results.filter((r) => r.status === 'killed').length,
    survived: results.filter((r) => r.status === 'survived').map((r) => r.id),
    results,
  };
  return { report, findings };
}

export function runMutants(o) {
  return execute(o).report;
}

function splitRunner(argv) {
  const at = argv.indexOf('--');
  if (at < 0) return { own: argv, runner: DEFAULT_RUNNER };
  return { own: argv.slice(0, at), runner: argv.slice(at + 1) };
}

export function run(argv) {
  const { own, runner } = splitRunner(argv);
  const args = parseArgs(own, { options: ['file', 'out', 'root'], positional: false });
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const { file, out } = args.values;
  if (file === undefined || out === undefined) {
    return usageFailure(TOOL, 'USAGE', 'usage: run-mutants.mjs --file <mutants.json> --out <report.json> [--root <dir>] [-- <runner argv...>]');
  }
  if (runner.length === 0) return usageFailure(TOOL, 'USAGE', '-- 之後必須有執行器指令');
  const { report, findings } = execute({ file, root: args.values.root ?? '.', runner });
  try {
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  } catch (e) {
    return usageFailure(TOOL, 'INPUT', `cannot write ${out}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const killed = report.results.filter((r) => r.status === 'killed').map((r) => `${TOOL}: KILLED ${r.id}\n`).join('');
  if (findings.length > 0) return { ...failure(TOOL, findings), stdout: killed };
  return { code: 0, stdout: killed, stderr: '' };
}

if (isMain(import.meta.url)) runCli(TOOL, run);

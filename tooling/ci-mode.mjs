// ci run 模式判斷（O-015）：full／docs／light。純函式、fail-closed：任何缺漏或異常一律 full。
import { isMain, readText, runCli, usageFailure } from './task-file.mjs';

const TOOL = 'ci-mode';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNonEmptyStr = (v) => typeof v === 'string' && v !== '';

export function isDocPath(path) {
  if (!isStr(path) || path === '' || path.startsWith('/') || path.includes('\\')) return false;
  if (path.split('/').includes('..')) return false;
  if (path.startsWith('docs/')) return !path.startsWith('docs/poc/') && !path.startsWith('docs/qa/');
  return !path.includes('/') && path.endsWith('.md');
}

export function classifyChange(files, referenced) {
  const bad = !Array.isArray(files) || !files.every(isStr) || !Array.isArray(referenced) || !referenced.every(isStr);
  if (bad) return { docsOnly: false, tasksChanged: false, reason: 'bad-input' };
  const tasksChanged = files.some((f) => f.startsWith('docs/tasks/'));
  if (files.length === 0) return { docsOnly: false, tasksChanged, reason: 'empty' };
  if (!files.every(isDocPath)) return { docsOnly: false, tasksChanged, reason: 'code-path' };
  if (files.some((f) => referenced.includes(f))) return { docsOnly: false, tasksChanged, reason: 'referenced' };
  return { docsOnly: true, tasksChanged, reason: 'docs-only' };
}

// QA 檔（O-028 Q1～Q4）：只有「單一測試檔」才算；共用輔助檔、設定、快照一律不算。
const QA_ROOTS = ['apps/', 'packages/', 'supabase/'];

export function isQaPath(path) {
  if (!isStr(path) || path === '' || path.startsWith('/') || path.includes('\\')) return false;
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || p === '__snapshots__')) return false;
  if (path.startsWith('docs/qa/')) return true;
  if (/^supabase\/tests\/[^/]+_test\.sql$/.test(path)) return true;
  if (path.startsWith('test/e2e/')) return path.endsWith('.spec.ts');
  if (QA_ROOTS.some((root) => path.startsWith(root))) return path.endsWith('.test.ts') || path.endsWith('.test.tsx');
  return false;
}

export function classifyQa(files) {
  if (!Array.isArray(files) || !files.every(isStr)) return { qaOnly: false, reason: 'bad-input' };
  if (files.length === 0) return { qaOnly: false, reason: 'empty' };
  if (!files.every(isQaPath)) return { qaOnly: false, reason: 'non-qa-path' };
  return { qaOnly: true, reason: 'qa-only' };
}

const UNKNOWN_PR ={ prOpen: 'unknown', prNumber: null };

export function parseOpenPrs(body, branch) {
  if (!Array.isArray(body) || !isNonEmptyStr(branch)) return UNKNOWN_PR;
  if (body.length === 0) return { prOpen: false, prNumber: null };
  const numbers = [];
  for (const pr of body) {
    if (!isObj(pr) || pr.state !== 'open') return UNKNOWN_PR;
    if (!isObj(pr.head) || pr.head.ref !== branch) return UNKNOWN_PR;
    if (!isObj(pr.base) || pr.base.ref !== 'main') return UNKNOWN_PR;
    if (!Number.isInteger(pr.number) || pr.number <= 0) return UNKNOWN_PR;
    numbers.push(pr.number);
  }
  return { prOpen: true, prNumber: Math.min(...numbers) };
}

const full = (reason) => ({ mode: 'full', reason });

export function decideMode(input) {
  if (!isObj(input) || !isNonEmptyStr(input.event) || !isNonEmptyStr(input.ref)) return full('bad-input');
  if (input.event !== 'push') return full('event');
  const { ref, change, pr } = input;
  if (ref === 'main') {
    if (isObj(change) && change.docsOnly === true) return { mode: 'docs', reason: 'docs-only-main' };
    return full('main-not-docs');
  }
  if (ref.startsWith('task/') || ref.startsWith('fix/')) {
    if (isObj(pr) && pr.prOpen === true) return { mode: 'light', reason: 'branch-with-open-pr' };
    const noPr = isObj(pr) && pr.prOpen === false;
    if (noPr && ref.startsWith('task/') && isObj(input.qa) && input.qa.qaOnly === true) {
      return { mode: 'light', reason: 'tests-only-no-pr' };
    }
    return full('branch-without-pr');
  }
  return full('ref');
}

// 只在 tests-only-no-pr 且前一次推送也只改 QA 檔時才警告；不影響 mode。
export function decideQaBatchWarning(decision, prevQa) {
  return isObj(decision) && decision.reason === 'tests-only-no-pr' && isObj(prevQa) && prevQa.qaOnly === true;
}

const VALUE_OPTS = ['event', 'ref', 'changed', 'referenced', 'pr', 'qa-changed', 'prev-qa-changed'];
const FLAG_OPTS = ['changed-error', 'pr-error', 'pr-skip', 'qa-changed-error', 'prev-skip'];

function parseCli(argv) {
  const values = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) return { ok: false, message: `unexpected argument ${arg}` };
    const name = arg.slice(2);
    if (FLAG_OPTS.includes(name)) {
      if (flags.has(name)) return { ok: false, message: `duplicate option --${name}` };
      flags.add(name);
    } else if (VALUE_OPTS.includes(name)) {
      if (name in values) return { ok: false, message: `duplicate option --${name}` };
      const value = argv[i + 1];
      if (!isNonEmptyStr(value) || value.startsWith('--')) return { ok: false, message: `option --${name} needs a value` };
      values[name] = value;
      i += 1;
    } else {
      return { ok: false, message: `unknown option --${name}` };
    }
  }
  if (!('event' in values) || !('ref' in values)) return { ok: false, message: '--event and --ref are required' };
  const hasChanged = 'changed' in values;
  const hasReferenced = 'referenced' in values;
  if (hasChanged !== hasReferenced) return { ok: false, message: '--changed and --referenced must be given together' };
  if (hasChanged === flags.has('changed-error')) return { ok: false, message: 'give exactly one of (--changed --referenced) or --changed-error' };
  const prCount = ('pr' in values ? 1 : 0) + (flags.has('pr-error') ? 1 : 0) + (flags.has('pr-skip') ? 1 : 0);
  if (prCount !== 1) return { ok: false, message: 'give exactly one of --pr, --pr-error, --pr-skip' };
  const branchRef = values.ref.startsWith('task/') || values.ref.startsWith('fix/');
  const qaCount = ('qa-changed' in values ? 1 : 0) + (flags.has('qa-changed-error') ? 1 : 0);
  const prevCount = ('prev-qa-changed' in values ? 1 : 0) + (flags.has('prev-skip') ? 1 : 0);
  if (branchRef) {
    if (qaCount !== 1) return { ok: false, message: 'give exactly one of --qa-changed, --qa-changed-error' };
    if (prevCount !== 1) return { ok: false, message: 'give exactly one of --prev-qa-changed, --prev-skip' };
  } else if (qaCount + prevCount !== 0) {
    return { ok: false, message: 'qa options are only accepted for task/** and fix/** refs' };
  }
  return { ok: true, values, flags };
}

function readLines(path) {
  const r = readText(path);
  if (!r.ok) return null;
  return r.text.replace(/\r\n/g, '\n').split('\n').filter((l) => l !== '');
}

function readPr(path, branch) {
  const r = readText(path);
  if (!r.ok) return 'error';
  let body;
  try {
    body = JSON.parse(r.text);
  } catch {
    return 'error';
  }
  return parseOpenPrs(body, branch);
}

export function run(argv) {
  if (argv[0] !== 'decide') return usageFailure(TOOL, 'USAGE', 'usage: ci-mode.mjs decide --event <name> --ref <name> ...');
  const args = parseCli(argv.slice(1));
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const { values, flags } = args;

  let change = 'error';
  if ('changed' in values) {
    const files = readLines(values.changed);
    const referenced = readLines(values.referenced);
    if (files !== null && referenced !== null) change = classifyChange(files, referenced);
  }
  let pr = 'skip';
  if ('pr' in values) pr = readPr(values.pr, values.ref);
  else if (flags.has('pr-error')) pr = 'error';

  let qa = 'error';
  if ('qa-changed' in values) {
    const files = readLines(values['qa-changed']);
    if (files !== null) qa = classifyQa(files);
  }
  let prevQa = null;
  if ('prev-qa-changed' in values) {
    const prevFiles = readLines(values['prev-qa-changed']);
    if (prevFiles !== null) prevQa = classifyQa(prevFiles);
  }

  const decision = decideMode({ event: values.event, ref: values.ref, change, pr, qa });
  const out = {
    mode: decision.mode,
    docs_only: isObj(change) ? change.docsOnly : false,
    tasks_changed: isObj(change) ? change.tasksChanged : false,
    pr_open: isObj(pr) ? pr.prOpen : pr === 'error' ? 'unknown' : null,
    pr_number: isObj(pr) ? pr.prNumber : null,
    reason: decision.reason,
    qa_only: isObj(qa) ? qa.qaOnly : false,
    qa_batch_warning: decideQaBatchWarning(decision, prevQa),
  };
  return { code: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '' };
}

if (isMain(import.meta.url)) runCli(TOOL, run);

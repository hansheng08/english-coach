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

const UNKNOWN_PR = { prOpen: 'unknown', prNumber: null };

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
    return full('branch-without-pr');
  }
  return full('ref');
}

const VALUE_OPTS = ['event', 'ref', 'changed', 'referenced', 'pr'];
const FLAG_OPTS = ['changed-error', 'pr-error', 'pr-skip'];

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

  const decision = decideMode({ event: values.event, ref: values.ref, change, pr });
  const out = {
    mode: decision.mode,
    docs_only: isObj(change) ? change.docsOnly : false,
    tasks_changed: isObj(change) ? change.tasksChanged : false,
    pr_open: isObj(pr) ? pr.prOpen : pr === 'error' ? 'unknown' : null,
    pr_number: isObj(pr) ? pr.prNumber : null,
    reason: decision.reason,
  };
  return { code: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '' };
}

if (isMain(import.meta.url)) runCli(TOOL, run);

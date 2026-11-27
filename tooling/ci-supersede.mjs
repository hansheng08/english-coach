// push 紅燈被 PR 結果取代的註記判斷（O-028）。純函式、fail-closed：判不出來一律不標註。
import { isMain, parseArgs, readText, runCli, usageFailure } from './task-file.mjs';

const TOOL = 'ci-supersede';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const SHA_RE = /^[0-9a-f]{40}$/;
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const MAX_DESCRIPTION = 140;

const none = (reason) => ({ action: 'none', reason, prNumber: null, prRunId: null, pushRunId: null, description: '' });

function validInput({ sha, repo, runs, jobs, existing }) {
  if (!isStr(sha) || !SHA_RE.test(sha) || !isStr(repo) || !REPO_RE.test(repo)) return false;
  if (!Array.isArray(runs) || !runs.every((r) => isObj(r) && isPosInt(r.id) && isStr(r.event))) return false;
  if (!isObj(jobs) || !Object.values(jobs).every((j) => Array.isArray(j) && j.every(isObj))) return false;
  return Array.isArray(existing) && existing.every(isObj);
}

const latest = (list) => list.reduce((best, r) => (best === null || r.id > best.id ? r : best), null);

function prRunVerdict(run, repo, jobs) {
  if (run === null) return { ok: false };
  if (run.status !== 'completed') return { ok: false };
  if (!isObj(run.head_repository) || run.head_repository.full_name !== repo) return { ok: false };
  const numbers = Array.isArray(run.pull_requests) ? run.pull_requests.filter((p) => isObj(p) && isPosInt(p.number)) : [];
  if (numbers.length === 0) return { ok: false };
  const runJobs = jobs[String(run.id)];
  if (!Array.isArray(runJobs)) return { ok: false };
  const ciOk = runJobs.filter((j) => j.name === 'ci-ok');
  if (ciOk.length === 0 || !ciOk.every((j) => j.conclusion === 'success')) return { ok: false };
  return { ok: true, prNumber: Math.min(...numbers.map((p) => p.number)) };
}

function pushRunVerdict(run) {
  if (run === null) return false;
  const branch = run.head_branch;
  const branchOk = isStr(branch) && (branch.startsWith('task/') || branch.startsWith('fix/'));
  return branchOk && run.status === 'completed' && run.conclusion === 'failure';
}

export function descriptionFor(prNumber, prRunId, pushRunId) {
  const text = `push run ${String(pushRunId)} 紅燈已被 PR #${String(prNumber)} 的 run ${String(prRunId)} 取代；非必過、請勿為消紅燈重推`;
  return text.length <= MAX_DESCRIPTION ? text : text.slice(0, MAX_DESCRIPTION);
}

function markedRunId(status) {
  if (!isObj(status) || status.state !== 'success' || !isStr(status.description)) return null;
  const m = /的 run (\d+) 取代/.exec(status.description);
  return m === null ? null : Number(m[1]);
}

export function decideSupersede(input) {
  if (!isObj(input) || !validInput(input)) return none('bad-input');
  const { sha, repo, runs, jobs, existing } = input;
  const atSha = runs.filter((r) => r.head_sha === sha);
  const prRun = latest(atSha.filter((r) => r.event === 'pull_request'));
  const pushRun = latest(atSha.filter((r) => r.event === 'push'));
  const pr = prRunVerdict(prRun, repo, jobs);
  const holds = pr.ok && pushRunVerdict(pushRun);
  const newest = existing.length > 0 ? existing[0] : null;

  if (holds) {
    if (markedRunId(newest) === prRun.id) return none('already-marked');
    return {
      action: 'mark',
      reason: 'pr-green-push-red',
      prNumber: pr.prNumber,
      prRunId: prRun.id,
      pushRunId: pushRun.id,
      description: descriptionFor(pr.prNumber, prRun.id, pushRun.id),
    };
  }
  if (isObj(newest) && newest.state === 'success') return { ...none('no-longer-superseded'), action: 'retract' };
  return none('not-superseded');
}

function readJson(path) {
  const r = readText(path);
  if (!r.ok) return { ok: false, message: r.message };
  try {
    return { ok: true, value: JSON.parse(r.text) };
  } catch {
    return { ok: false, message: `invalid JSON in ${path}` };
  }
}

export function run(argv) {
  if (argv[0] !== 'decide') return usageFailure(TOOL, 'USAGE', 'usage: ci-supersede.mjs decide --sha <sha> --repo <owner/name> --runs <file> --jobs <file> --existing <file>');
  const args = parseArgs(argv.slice(1), { options: ['sha', 'repo', 'runs', 'jobs', 'existing'], positional: false });
  if (!args.ok) return usageFailure(TOOL, 'INPUT', args.message);
  const { values } = args;
  for (const name of ['sha', 'repo', 'runs', 'jobs', 'existing']) {
    if (!(name in values)) return usageFailure(TOOL, 'INPUT', `--${name} is required`);
  }
  const files = {};
  for (const name of ['runs', 'jobs', 'existing']) {
    const r = readJson(values[name]);
    if (!r.ok) return usageFailure(TOOL, 'INPUT', r.message);
    files[name] = r.value;
  }
  const decision = decideSupersede({ sha: values.sha, repo: values.repo, ...files });
  if (decision.reason === 'bad-input') return usageFailure(TOOL, 'INPUT', 'input has the wrong shape');
  return { code: 0, stdout: `${JSON.stringify(decision)}\n`, stderr: '' };
}

if (isMain(import.meta.url)) runCli(TOOL, run);

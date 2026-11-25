// Actions 用量推算（O-016）：從 runs／jobs API 估計計費分鐘。fail-closed：任何問題都 exit 1、stdout 為空。
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const METHOD = 'sum of ceil(job seconds / 60) from actions runs/jobs API (estimate)';
export const GH_MAX_ATTEMPTS = 3;
export const GH_RETRY_BASE_MS = 1000;
const PER_PAGE = 100;
const MAX_RUNS_PER_DAY = 1000;
const DEFAULTS = { daily_warn: 100, daily_stop: 200, month_warn_pct: 75, month_stop_pct: 90 };
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TZ_RE = /^([+-])(\d{2}):(\d{2})$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(rule, message) {
  return { error: `${rule}: ${message}`, rule };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function parseTime(v) {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function parseDate(v) {
  if (typeof v !== 'string') return null;
  const m = DATE_RE.exec(v);
  if (m === null) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === v ? ms : null;
}

// "+08:00" → 分鐘數；格式錯回 null
function parseOffset(v) {
  if (typeof v !== 'string') return null;
  const m = TZ_RE.exec(v);
  if (m === null) return null;
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (h > 14 || min > 59) return null;
  return (m[1] === '-' ? -1 : 1) * (h * 60 + min);
}

function dayString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function billedMinutes(job) {
  if (!isRecord(job)) return fail('DATA', 'job 不是物件');
  if (job.status !== 'completed') return fail('DATA', 'job 尚未完成');
  // 被略過的 job 不計費，GitHub 給的時間也不可靠（常見 completed_at 早於 started_at）：算 0、不驗時間
  const skipped = job.conclusion === 'skipped';
  const started = parseTime(job.started_at);
  const completed = parseTime(job.completed_at);
  if (!skipped) {
    if (started === null || completed === null) return fail('DATA', 'job 的 started_at／completed_at 不是合法時間');
    if (completed < started) return fail('DATA', 'job 的 completed_at 早於 started_at');
  }
  const { labels } = job;
  if (!Array.isArray(labels) || !labels.some((l) => typeof l === 'string' && l.startsWith('ubuntu-'))) {
    return fail('RUNNER', 'job 的 labels 缺漏或不是 ubuntu-（倍率未知，不猜）');
  }
  if (skipped) return { minutes: 0, rawSeconds: 0 };
  const rawSeconds = (completed - started) / 1000;
  return { minutes: Math.ceil(rawSeconds / 60), rawSeconds };
}

function newBucket() {
  return { runs: new Set(), jobs: 0, billed: 0, rawSeconds: 0 };
}

function addTo(map, workflow, runId, minutes, rawSeconds) {
  let b = map.get(workflow);
  if (b === undefined) {
    b = newBucket();
    map.set(workflow, b);
  }
  b.runs.add(runId);
  b.jobs += 1;
  b.billed += minutes;
  b.rawSeconds += rawSeconds;
}

function totals(map) {
  let runs = 0;
  let jobs = 0;
  let billed = 0;
  let rawSeconds = 0;
  const byWorkflow = [];
  for (const [workflow, b] of map) {
    runs += b.runs.size;
    jobs += b.jobs;
    billed += b.billed;
    rawSeconds += b.rawSeconds;
    byWorkflow.push({
      workflow,
      runs: b.runs.size,
      jobs: b.jobs,
      billed_minutes: b.billed,
      raw_minutes: round1(b.rawSeconds / 60),
    });
  }
  byWorkflow.sort((a, b) => b.billed_minutes - a.billed_minutes || (a.workflow < b.workflow ? -1 : a.workflow > b.workflow ? 1 : 0));
  return { runs, jobs, billed, rawSeconds, byWorkflow };
}

function checkThresholds(t) {
  if (!isRecord(t)) return false;
  return Object.keys(DEFAULTS).every((k) => typeof t[k] === 'number' && Number.isFinite(t[k]) && t[k] >= 0);
}

export function summarize(input) {
  if (!isRecord(input)) return fail('DATA', 'input 不是物件');
  const { runs, jobs, date, tzOffset, cycleStart, thresholds, included } = input;
  const dateMs = parseDate(date);
  const startMs = parseDate(cycleStart);
  const offMin = parseOffset(tzOffset);
  if (dateMs === null || startMs === null) return fail('USAGE', 'date／cycleStart 不是 YYYY-MM-DD');
  if (offMin === null) return fail('USAGE', 'tzOffset 不是 ±HH:MM');
  if (dateMs < startMs) return fail('USAGE', 'date 早於 cycleStart');
  if (typeof included !== 'number' || !Number.isFinite(included) || included <= 0) return fail('USAGE', 'included 必須是正數');
  if (!checkThresholds(thresholds)) return fail('USAGE', 'thresholds 缺漏或不是非負數');
  if (!Array.isArray(runs) || !Array.isArray(jobs)) return fail('DATA', 'runs／jobs 不是陣列');

  const names = new Map();
  for (const r of runs) {
    if (!isRecord(r) || typeof r.id !== 'number' || typeof r.name !== 'string') return fail('DATA', 'run 缺少 id 或 name');
    names.set(r.id, r.name);
  }

  const dayMap = new Map();
  const cycleMap = new Map();
  let inProgress = 0;
  for (const job of jobs) {
    if (!isRecord(job) || typeof job.id !== 'number' || typeof job.run_id !== 'number' || typeof job.status !== 'string') {
      return fail('DATA', 'job 缺少 id、run_id 或 status');
    }
    const started = parseTime(job.started_at);
    let local = null;
    if (started !== null) local = dayString(started + offMin * 60000);
    if (local !== null && (local < cycleStart || local > date)) continue;
    if (job.status !== 'completed') {
      if (local === date) inProgress += 1;
      continue;
    }
    const b = billedMinutes(job);
    if ('error' in b) return b;
    if (local === null) continue; // 只可能是沒有合法 started_at 的 skipped job：不歸任何一天
    const workflow = names.get(job.run_id);
    if (workflow === undefined) return fail('DATA', `job ${job.id} 的 run ${job.run_id} 不在 runs 裡`);
    addTo(cycleMap, workflow, job.run_id, b.minutes, b.rawSeconds);
    if (local === date) addTo(dayMap, workflow, job.run_id, b.minutes, b.rawSeconds);
  }

  const day = totals(dayMap);
  const cycle = totals(cycleMap);
  const daysElapsed = Math.round((dateMs - startMs) / 86400000) + 1;
  const avg = cycle.billed / daysElapsed;
  const remaining = included - cycle.billed;
  const usedPct = (cycle.billed / included) * 100;
  const d = new Date(dateMs);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = Math.round(avg * daysInMonth);
  let left = 0;
  if (remaining > 0) left = avg === 0 ? null : round1(remaining / avg);

  const t = thresholds;
  const reasons = [];
  const dailyStop = day.billed >= t.daily_stop;
  const exhausted = remaining <= 0;
  const monthStop = usedPct >= t.month_stop_pct;
  if (dailyStop) reasons.push('daily-stop');
  if (exhausted) reasons.push('exhausted');
  else if (monthStop) reasons.push('month-stop');
  const stop = reasons.length > 0;
  if (!dailyStop && day.billed >= t.daily_warn) reasons.push('daily-warn');
  if (!exhausted && !monthStop && usedPct >= t.month_warn_pct) reasons.push('month-warn');
  if (projected > included) reasons.push('projected-over');
  const status = stop ? 'stop' : reasons.length > 0 ? 'warn' : 'ok';

  return {
    schema: 'actions-usage/v1',
    repo: typeof input.repo === 'string' ? input.repo : null,
    date,
    tz_offset: tzOffset,
    cycle_start: cycleStart,
    method: METHOD,
    day: {
      billed_minutes: day.billed,
      raw_minutes: round1(day.rawSeconds / 60),
      runs: day.runs,
      jobs: day.jobs,
      in_progress_jobs: inProgress,
      by_workflow: day.byWorkflow,
    },
    cycle: {
      billed_minutes: cycle.billed,
      days_elapsed: daysElapsed,
      daily_average: round1(avg),
      by_workflow: cycle.byWorkflow,
    },
    allowance: {
      included_minutes: included,
      used_minutes: cycle.billed,
      remaining_minutes: remaining,
      used_pct: round1(usedPct),
      days_of_allowance_left: left,
      projected_cycle_minutes: projected,
    },
    thresholds: {
      daily_warn: t.daily_warn,
      daily_stop: t.daily_stop,
      month_warn_pct: t.month_warn_pct,
      month_stop_pct: t.month_stop_pct,
    },
    status,
    reasons,
  };
}

const OPTIONS = new Set([
  'repo',
  'date',
  'included',
  'cycle-start',
  'tz-offset',
  'daily-warn',
  'daily-stop',
  'month-warn-pct',
  'month-stop-pct',
]);

function parseArgv(argv) {
  const opts = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (typeof flag !== 'string' || !flag.startsWith('--') || !OPTIONS.has(flag.slice(2))) {
      return fail('USAGE', `未知或不合法的選項 ${String(flag)}`);
    }
    const value = argv[i + 1];
    if (value === undefined) return fail('USAGE', `${flag} 缺少值`);
    if (opts.has(flag.slice(2))) return fail('USAGE', `${flag} 重複`);
    opts.set(flag.slice(2), value);
  }
  return { opts };
}

function numberOpt(opts, key, fallback) {
  if (!opts.has(key)) return fallback;
  const raw = opts.get(key);
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}

function sleepMs(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// gh 的 stderr 最後一個 "(HTTP nnn)"；沒有回 null
function httpStatus(stderr) {
  const all = [...String(stderr ?? '').matchAll(/\(HTTP (\d{3})\)/g)];
  return all.length === 0 ? null : Number(all[all.length - 1][1]);
}

function retryable(r, status) {
  if (status !== null) return status >= 500 && status <= 599;
  return r.status === 1;
}

function ghJson(bin, path, baseMs) {
  for (let attempt = 1; ; attempt += 1) {
    const r = spawnSync(bin, ['api', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error !== undefined) return fail('API', `無法執行 gh：${r.error.message}`);
    if (r.status === 0) {
      let parsed;
      try {
        parsed = JSON.parse(r.stdout);
      } catch {
        return fail('API', `gh api ${path} 的輸出不是 JSON`);
      }
      return { value: parsed };
    }
    const status = httpStatus(r.stderr);
    if (!retryable(r, status) || attempt >= GH_MAX_ATTEMPTS) {
      return fail('API', `gh api ${path} 失敗（已試 ${attempt} 次，最後 exit ${String(r.status)}，狀態碼 ${status === null ? '無' : status}）`);
    }
    sleepMs(baseMs * 2 ** (attempt - 1));
  }
}

// 回傳毫秒數或 null（不合法）
function retryBase(env) {
  const raw = env.ACTIONS_USAGE_RETRY_BASE_MS;
  if (raw === undefined) return GH_RETRY_BASE_MS;
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

// 逐頁收齊；回傳 { items } 或 { error }
function fetchAll(bin, baseMs, basePath, listKey, validate) {
  const items = [];
  let total = null;
  for (let page = 1; ; page += 1) {
    const sep = basePath.includes('?') ? '&' : '?';
    const res = ghJson(bin, `${basePath}${sep}per_page=${PER_PAGE}&page=${page}`, baseMs);
    if ('error' in res) return res;
    const body = res.value;
    if (!isRecord(body) || !Number.isInteger(body.total_count) || !Array.isArray(body[listKey])) {
      return fail('DATA', `${basePath} 的回應缺少 total_count 或 ${listKey}`);
    }
    if (total === null) {
      total = body.total_count;
      if (listKey === 'workflow_runs' && total > MAX_RUNS_PER_DAY) return fail('COUNT', `${basePath} 的 total_count ${total} 超過 ${MAX_RUNS_PER_DAY}`);
    }
    for (const it of body[listKey]) {
      const bad = validate(it);
      if (bad !== null) return fail('DATA', bad);
      items.push(it);
    }
    if (body[listKey].length < PER_PAGE || items.length >= total) break;
  }
  if (items.length !== total) return fail('COUNT', `${basePath} 收到 ${items.length} 筆，total_count 是 ${String(total)}`);
  return { items };
}

function validRun(r) {
  return isRecord(r) && typeof r.id === 'number' && typeof r.name === 'string' ? null : 'run 缺少 id 或 name';
}

function validJob(j) {
  return isRecord(j) && typeof j.id === 'number' && typeof j.run_id === 'number' && typeof j.status === 'string' ? null : 'job 缺少 id、run_id 或 status';
}

function ok(stdout) {
  return { code: 0, stdout, stderr: '' };
}

function bad(res) {
  return { code: 1, stdout: '', stderr: `usage: ${res.rule} ${res.error.slice(res.rule.length + 2)}\n` };
}

export function run(argv) {
  const parsed = parseArgv(argv);
  if ('error' in parsed) return bad(parsed);
  const { opts } = parsed;
  const repo = opts.get('repo');
  if (repo === undefined || !REPO_RE.test(repo)) return bad(fail('USAGE', '--repo 必填，格式 <owner>/<name>'));
  const date = opts.get('date');
  const dateMs = parseDate(date);
  if (dateMs === null) return bad(fail('USAGE', '--date 必填，格式 YYYY-MM-DD'));
  const included = numberOpt(opts, 'included', undefined);
  if (included === undefined) return bad(fail('USAGE', '--included 必填（免費 2000、Pro 3000，不猜）'));
  if (included === null || included <= 0) return bad(fail('USAGE', '--included 必須是正數'));
  const tzOffset = opts.get('tz-offset') ?? '+08:00';
  const offMin = parseOffset(tzOffset);
  if (offMin === null) return bad(fail('USAGE', '--tz-offset 格式必須是 ±HH:MM'));
  const cycleStart = opts.get('cycle-start') ?? `${date.slice(0, 7)}-01`;
  const startMs = parseDate(cycleStart);
  if (startMs === null) return bad(fail('USAGE', '--cycle-start 格式必須是 YYYY-MM-DD'));
  if (dateMs < startMs) return bad(fail('USAGE', '--date 早於 --cycle-start'));
  const thresholds = {
    daily_warn: numberOpt(opts, 'daily-warn', DEFAULTS.daily_warn),
    daily_stop: numberOpt(opts, 'daily-stop', DEFAULTS.daily_stop),
    month_warn_pct: numberOpt(opts, 'month-warn-pct', DEFAULTS.month_warn_pct),
    month_stop_pct: numberOpt(opts, 'month-stop-pct', DEFAULTS.month_stop_pct),
  };
  if (!checkThresholds(thresholds)) return bad(fail('USAGE', '門檻必須是非負數'));

  const baseMs = retryBase(process.env);
  if (baseMs === null) return bad(fail('USAGE', 'ACTIONS_USAGE_RETRY_BASE_MS 必須是非負整數'));
  const bin = process.env.GH_BIN ?? 'gh';
  const allRuns = [];
  const allJobs = [];
  for (let ms = startMs - 86400000; ms <= dateMs + 86400000; ms += 86400000) {
    const res = fetchAll(bin, baseMs, `repos/${repo}/actions/runs?created=${dayString(ms)}`, 'workflow_runs', validRun);
    if ('error' in res) return bad(res);
    for (const r of res.items) {
      allRuns.push(r);
      const jr = fetchAll(bin, baseMs, `repos/${repo}/actions/runs/${r.id}/jobs?filter=all`, 'jobs', validJob);
      if ('error' in jr) return bad(jr);
      allJobs.push(...jr.items);
    }
  }

  const out = summarize({ repo, runs: allRuns, jobs: allJobs, date, tzOffset, cycleStart, thresholds, included });
  if ('error' in out) return bad(out);
  return ok(`${JSON.stringify(out)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = run(process.argv.slice(2));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}

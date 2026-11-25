// Claude 用量上限偵測與連續次數（O-014）。fail-closed：判斷不了就不是用量上限，連續次數算不出就停下。
import { isMain, readText, runCli, usageFailure } from './task-file.mjs';

const TOOL = 'usage-limit';
const TYPE_RE = /^[a-z_]{1,32}$/;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const lastOf = (events, pred) => {
  for (let i = events.length - 1; i >= 0; i -= 1) if (pred(events[i])) return events[i];
  return undefined;
};

function toIso(sec) {
  if (typeof sec !== 'number' || !Number.isSafeInteger(sec) || sec <= 0) return null;
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function detectUsageLimit(events) {
  const none = { usageLimit: false, resetsAt: null, limitType: null };
  if (!Array.isArray(events)) return none;
  const result = lastOf(events, (e) => isObject(e) && e.type === 'result');
  if (result === undefined) return none;
  if (result.is_error !== true || result.api_error !== 'usage_limit_reached' || result.api_error_status !== 429) return none;
  const rejected = lastOf(
    events,
    (e) => isObject(e) && e.type === 'rate_limit_event' && isObject(e.rate_limit_info) && e.rate_limit_info.status === 'rejected',
  );
  const info = rejected === undefined ? undefined : rejected.rate_limit_info;
  const type = info?.rateLimitType;
  return {
    usageLimit: true,
    resetsAt: info === undefined ? null : toIso(info.resetsAt),
    limitType: typeof type === 'string' && TYPE_RE.test(type) ? type : null,
  };
}

export function usageLimitStreak(current, previous) {
  if (current === false) return { streak: 0, action: 'none' };
  if (previous === null) return { streak: 1, action: 'reschedule' };
  if (isObject(previous) && typeof previous.outcome === 'string') {
    if (previous.outcome !== 'usage_limit') return { streak: 1, action: 'reschedule' };
    const n = previous.usage_limit_streak;
    if (Number.isSafeInteger(n) && n > 0) return { streak: n + 1, action: 'stop' };
  }
  return { streak: 'unknown', action: 'stop' };
}

function parseJsonFile(path) {
  const raw = readText(path);
  if (!raw.ok) return { ok: false, message: raw.message };
  try {
    return { ok: true, value: JSON.parse(raw.text) };
  } catch (e) {
    return { ok: false, message: `invalid JSON in ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// 旗標與選項：`--name value`；`flags` 為不帶值的旗標。選項重複或缺值 → 錯誤。
function parse(argv, valueOpts, flagOpts) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--')) return { ok: false, message: `unexpected argument ${arg}` };
    const name = arg.slice(2);
    if (name in values) return { ok: false, message: `duplicate option --${name}` };
    if (flagOpts.includes(name)) {
      values[name] = true;
    } else if (valueOpts.includes(name)) {
      const v = argv[i + 1];
      if (typeof v !== 'string' || v === '' || v.startsWith('--')) return { ok: false, message: `option --${name} needs a value` };
      values[name] = v;
      i += 1;
    } else {
      return { ok: false, message: `unknown option --${name}` };
    }
  }
  return { ok: true, values };
}

const json = (obj) => ({ code: 0, stdout: `${JSON.stringify(obj)}\n`, stderr: '' });

function runDetect(rest) {
  const args = parse(rest, ['execution-file'], []);
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const path = args.values['execution-file'];
  if (path === undefined) return usageFailure(TOOL, 'USAGE', 'detect needs --execution-file <path>');
  const file = parseJsonFile(path);
  if (!file.ok) return usageFailure(TOOL, 'INPUT', file.message);
  const r = detectUsageLimit(file.value);
  return json({ usage_limit: r.usageLimit, resets_at: r.resetsAt, limit_type: r.limitType });
}

function runStreak(rest) {
  const args = parse(rest, ['current', 'previous-file'], ['no-previous', 'previous-error']);
  if (!args.ok) return usageFailure(TOOL, 'USAGE', args.message);
  const { current, 'previous-file': prevFile, 'no-previous': noPrev, 'previous-error': prevErr } = args.values;
  if (current !== 'true' && current !== 'false') return usageFailure(TOOL, 'USAGE', '--current must be true or false');
  const given = [prevFile, noPrev, prevErr].filter((v) => v !== undefined).length;
  if (given !== 1) return usageFailure(TOOL, 'USAGE', 'give exactly one of --previous-file, --no-previous, --previous-error');
  let previous = 'error';
  if (noPrev === true) {
    previous = null;
  } else if (prevFile !== undefined) {
    const file = parseJsonFile(prevFile);
    previous = file.ok && file.value !== null ? file.value : 'error';
  }
  const r = usageLimitStreak(current === 'true', previous);
  return json({ usage_limit_streak: r.streak, usage_limit_action: r.action });
}

export function run(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'detect') return runDetect(rest);
  if (sub === 'streak') return runStreak(rest);
  return usageFailure(TOOL, 'USAGE', 'usage: usage-limit.mjs detect|streak ...');
}

if (isMain(import.meta.url)) runCli(TOOL, run);

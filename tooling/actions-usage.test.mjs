import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GH_MAX_ATTEMPTS, GH_RETRY_BASE_MS, billedMinutes, summarize } from './actions-usage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures', 'o016');
const cli = join(here, 'actions-usage.mjs');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const T0 = '2026-11-25T03:00:00Z';
const at = (sec) => new Date(Date.parse(T0) + sec * 1000).toISOString().replace('.000Z', 'Z');
const job = (sec, over = {}) => ({
  id: 1,
  run_id: 1,
  run_attempt: 1,
  name: 'j',
  status: 'completed',
  started_at: T0,
  completed_at: at(sec),
  labels: ['ubuntu-latest'],
  ...over,
});
const RUNS = [{ id: 1, name: 'CI', run_attempt: 1, status: 'completed', created_at: T0 }];
const THRESHOLDS = { daily_warn: 100, daily_stop: 200, month_warn_pct: 75, month_stop_pct: 90 };
const base = (over = {}) => ({
  runs: RUNS,
  jobs: [],
  date: '2026-11-25',
  tzOffset: '+08:00',
  cycleStart: '2026-11-25',
  thresholds: THRESHOLDS,
  included: 2000,
  ...over,
});
// 一個 N 分鐘的 job 落在 date 當天
const withMinutes = (minutes, over = {}) => base({ jobs: [job(minutes * 60)], ...over });

describe('billedMinutes', () => {
  it('(AC-O16-1) (TC-1) 進位：61→2、60→1、1→1、0→0', () => {
    expect(billedMinutes(job(61))).toEqual({ minutes: 2, rawSeconds: 61 });
    expect(billedMinutes(job(60))).toEqual({ minutes: 1, rawSeconds: 60 });
    expect(billedMinutes(job(1))).toEqual({ minutes: 1, rawSeconds: 1 });
    expect(billedMinutes(job(0))).toEqual({ minutes: 0, rawSeconds: 0 });
  });

  it('(AC-O16-1) (TC-2) 壞時間與非 ubuntu runner → error', () => {
    const bad = [
      job(10, { completed_at: at(-5) }),
      job(10, { started_at: 'x' }),
      job(10, { labels: ['windows-latest'] }),
      job(10, { labels: ['self-hosted'] }),
      (() => {
        const j = job(10);
        delete j.labels;
        return j;
      })(),
    ];
    for (const j of bad) expect(billedMinutes(j)).toHaveProperty('error');
  });

  it('(AC-O16-1) (TC-3) 未完成的 job 不計入，算進 in_progress_jobs', () => {
    const j = job(0, { status: 'in_progress', completed_at: null });
    expect(billedMinutes(j)).toHaveProperty('error');
    const out = summarize(base({ jobs: [j, job(61)] }));
    expect(out.day.in_progress_jobs).toBe(1);
    expect(out.day.billed_minutes).toBe(2);
    expect(out.day.jobs).toBe(1);
  });
});

describe('summarize 歸日與彙總', () => {
  it('(AC-O16-2) (TC-4) +08:00：UTC 15:59:59 歸前一天、16:00:00 歸當天', () => {
    const before = job(60, { id: 1, started_at: '2026-11-24T15:59:59Z', completed_at: '2026-11-24T16:00:59Z' });
    const after = job(60, { id: 2, started_at: '2026-11-24T16:00:00Z', completed_at: '2026-11-24T16:01:00Z' });
    const out = summarize(base({ jobs: [before, after] }));
    expect(out.day.jobs).toBe(1);
    expect(out.day.billed_minutes).toBe(1);
    const wide = summarize(base({ jobs: [before, after], cycleStart: '2026-11-24' }));
    expect(wide.cycle.billed_minutes).toBe(2);
    expect(wide.day.billed_minutes).toBe(1);
  });

  it('(AC-O16-2) (TC-5) 重跑：同 run 不同 run_attempt 的 job 都計入', () => {
    const out = summarize(base({ jobs: [job(60, { id: 1, run_attempt: 1 }), job(120, { id: 2, run_attempt: 2 })] }));
    expect(out.day.jobs).toBe(2);
    expect(out.day.runs).toBe(1);
    expect(out.day.billed_minutes).toBe(3);
  });

  it('(AC-O16-2) (TC-6) fixture usage-normal 與預期 JSON 完全相同', () => {
    const input = readJson(join(fx, 'usage-normal', 'input.json'));
    const expected = readJson(join(fx, 'usage-normal', 'expected.json'));
    expect(summarize(input)).toEqual(expected);
  });
});

describe('summarize 門檻', () => {
  it('(AC-O16-3) (TC-7) 每日門檻：200 → stop；100 → warn', () => {
    const stop = summarize(withMinutes(200, { cycleStart: '2026-11-01' }));
    expect(stop.status).toBe('stop');
    expect(stop.reasons).toEqual(['daily-stop']);
    const warn = summarize(withMinutes(100, { cycleStart: '2026-11-01' }));
    expect(warn.status).toBe('warn');
    expect(warn.reasons).toEqual(['daily-warn']);
  });

  it('(AC-O16-3) (TC-8) 月門檻與用完', () => {
    const stop = summarize(withMinutes(90, { included: 100, cycleStart: '2026-11-01' }));
    expect(stop.status).toBe('stop');
    expect(stop.reasons).toContain('month-stop');
    const warn = summarize(withMinutes(75, { included: 100, cycleStart: '2026-11-01' }));
    expect(warn.status).toBe('warn');
    expect(warn.reasons).toContain('month-warn');
    const zero = summarize(withMinutes(90, { included: 90, cycleStart: '2026-11-01' }));
    expect(zero.status).toBe('stop');
    expect(zero.reasons).toContain('exhausted');
    expect(zero.allowance.remaining_minutes).toBe(0);
    expect(zero.allowance.days_of_allowance_left).toBe(0);
    const neg = summarize(withMinutes(95, { included: 90, cycleStart: '2026-11-01' }));
    expect(neg.reasons).toContain('exhausted');
    expect(neg.allowance.remaining_minutes).toBe(-5);
  });

  it('(AC-O16-3) (TC-9) 推估超量：其他都低 → warn＋projected-over', () => {
    const out = summarize(withMinutes(60, { included: 1000 }));
    expect(out.status).toBe('warn');
    expect(out.reasons).toEqual(['projected-over']);
    expect(out.allowance.projected_cycle_minutes).toBe(1800);
  });

  it('(AC-O16-3) (TC-10) stop 優先於 warn，reasons 全列；自訂門檻生效；ok 時 reasons 為空', () => {
    const both = summarize(withMinutes(100, { included: 105, cycleStart: '2026-11-01' }));
    expect(both.status).toBe('stop');
    expect(both.reasons).toContain('daily-warn');
    expect(both.reasons).toContain('month-stop');
    const custom = summarize(withMinutes(10, { cycleStart: '2026-11-01', thresholds: { ...THRESHOLDS, daily_warn: 10 } }));
    expect(custom.status).toBe('warn');
    expect(custom.reasons).toEqual(['daily-warn']);
    expect(custom.thresholds.daily_warn).toBe(10);
    const ok = summarize(withMinutes(10, { cycleStart: '2026-11-01' }));
    expect(ok.status).toBe('ok');
    expect(ok.reasons).toEqual([]);
  });
});

describe('CLI（假 gh）', () => {
  let dir;
  let fakeGh;
  const input = readJson(join(fx, 'usage-normal', 'input.json'));
  const ARGS = ['--repo', 'o/r', '--date', '2026-11-25', '--cycle-start', '2026-11-24', '--included', '2000'];

  const buildRoutes = (src) => {
    const routes = {};
    const byDay = new Map();
    for (const r of src.runs) {
      const day = r.created_at.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), r]);
      const jobs = src.jobs.filter((j) => j.run_id === r.id);
      routes[`repos/o/r/actions/runs/${r.id}/jobs?filter=all&per_page=100&page=1`] = JSON.stringify({ total_count: jobs.length, jobs });
    }
    for (const [day, list] of byDay) {
      routes[`repos/o/r/actions/runs?created=${day}&per_page=100&page=1`] = JSON.stringify({ total_count: list.length, workflow_runs: list });
    }
    return routes;
  };

  const exec = (cfg, args = ARGS) => {
    const routesFile = join(dir, 'routes.json');
    writeFileSync(routesFile, JSON.stringify(cfg));
    return spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GH_BIN: fakeGh, FAKE_GH_ROUTES: routesFile, ACTIONS_USAGE_RETRY_BASE_MS: '0' },
    });
  };
  const expectFail = (r, rule) => {
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(`usage: ${rule}`);
  };
  const clone = () => structuredClone(input);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'o016-'));
    fakeGh = join(dir, 'gh');
    writeFileSync(
      fakeGh,
      `#!/usr/bin/env node
const fs = require('node:fs');
const cfg = JSON.parse(fs.readFileSync(process.env.FAKE_GH_ROUTES, 'utf8'));
if (cfg.exit) { process.stderr.write('boom'); process.exit(cfg.exit); }
if (cfg.raw !== undefined) { process.stdout.write(cfg.raw); process.exit(0); }
const p = process.argv[3];
const hit = cfg.routes[p];
if (hit !== undefined) { process.stdout.write(hit); process.exit(0); }
if (p.includes('/jobs')) { process.exit(1); }
process.stdout.write(JSON.stringify({ total_count: 0, workflow_runs: [] }));
`,
      { mode: 0o755 },
    );
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('(AC-O16-4) (TC-11) 正常 fixture → exit 0，stdout 恰為一行可解析的 JSON', () => {
    const r = exec({ routes: buildRoutes(input) });
    expect(r.status).toBe(0);
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(r.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toEqual(readJson(join(fx, 'usage-normal', 'expected.json')));
  });

  it('(AC-O16-4) (TC-12) gh exit 1、回壞 JSON → API，stdout 空', () => {
    expectFail(exec({ exit: 1 }), 'API');
    expectFail(exec({ raw: '{' }), 'API');
  });

  it('(AC-O16-4) (TC-13) 筆數對不上、total_count 1001 → COUNT，stdout 空', () => {
    const routes = buildRoutes(input);
    const runsKey = 'repos/o/r/actions/runs?created=2026-11-25&per_page=100&page=1';
    const jobsKey = 'repos/o/r/actions/runs/1/jobs?filter=all&per_page=100&page=1';
    const short = { ...routes, [runsKey]: JSON.stringify({ ...JSON.parse(routes[runsKey]), total_count: 150 }) };
    expectFail(exec({ routes: short }), 'COUNT');
    const fewJobs = { ...routes, [jobsKey]: JSON.stringify({ ...JSON.parse(routes[jobsKey]), total_count: 9 }) };
    expectFail(exec({ routes: fewJobs }), 'COUNT');
    const many = { ...routes, [runsKey]: JSON.stringify({ ...JSON.parse(routes[runsKey]), total_count: 1001 }) };
    expectFail(exec({ routes: many }), 'COUNT');
  });

  it('(AC-O16-4) (TC-14) job 缺 labels、windows label → RUNNER；run 缺 id → DATA', () => {
    const noLabels = clone();
    delete noLabels.jobs[3].labels;
    expectFail(exec({ routes: buildRoutes(noLabels) }), 'RUNNER');
    const win = clone();
    win.jobs[3].labels = ['windows-latest'];
    expectFail(exec({ routes: buildRoutes(win) }), 'RUNNER');
    const noId = clone();
    const routes = buildRoutes(noId);
    const key = 'repos/o/r/actions/runs?created=2026-11-25&per_page=100&page=1';
    const body = JSON.parse(routes[key]);
    delete body.workflow_runs[0].id;
    expectFail(exec({ routes: { ...routes, [key]: JSON.stringify(body) } }), 'DATA');
  });

  it('(AC-O16-4) (TC-15) 缺 --included、--date 早於 --cycle-start、--tz-offset 8 → USAGE，stdout 空', () => {
    const routes = buildRoutes(input);
    expectFail(exec({ routes }, ['--repo', 'o/r', '--date', '2026-11-25']), 'USAGE');
    expectFail(exec({ routes }, ['--repo', 'o/r', '--date', '2026-11-20', '--cycle-start', '2026-11-24', '--included', '2000']), 'USAGE');
    expectFail(exec({ routes }, [...ARGS, '--tz-offset', '8']), 'USAGE');
  });
});

describe('gh api 有限重試（O-017）', () => {
  let dir;
  let fakeGh;
  const input = readJson(join(fx, 'usage-normal', 'input.json'));
  const expected = readJson(join(fx, 'usage-normal', 'expected.json'));
  const ARGS = ['--repo', 'o/r', '--date', '2026-11-25', '--cycle-start', '2026-11-24', '--included', '2000'];
  const RUNS_KEY = 'repos/o/r/actions/runs?created=2026-11-25&per_page=100&page=1';
  const jobsKey = (id) => `repos/o/r/actions/runs/${id}/jobs?filter=all&per_page=100&page=1`;
  const HTTP = (code) => ({ exit: 1, stderr: `gh: Server Error (HTTP ${code})` });

  const buildRoutes = () => {
    const routes = {};
    const byDay = new Map();
    for (const r of input.runs) {
      const day = r.created_at.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), r]);
      const jobs = input.jobs.filter((j) => j.run_id === r.id);
      routes[jobsKey(r.id)] = JSON.stringify({ total_count: jobs.length, jobs });
    }
    for (const [day, list] of byDay) {
      routes[`repos/o/r/actions/runs?created=${day}&per_page=100&page=1`] = JSON.stringify({ total_count: list.length, workflow_runs: list });
    }
    return routes;
  };
  const firstJobsKey = jobsKey(input.runs[0].id);

  // seq[path]：第 n 次呼叫用 seq[path][n]，超過就沿用最後一項；null 表示正常回 routes
  const exec = (seq = {}, { env = {}, args = ARGS, routes = buildRoutes(), bin } = {}) => {
    writeFileSync(join(dir, 'cfg.json'), JSON.stringify({ routes, seq }));
    const log = join(dir, 'calls.log');
    writeFileSync(log, '');
    const r = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GH_BIN: bin ?? fakeGh,
        FAKE_GH_CFG: join(dir, 'cfg.json'),
        FAKE_GH_LOG: log,
        ACTIONS_USAGE_RETRY_BASE_MS: '0',
        ...env,
      },
    });
    const calls = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
    const count = (p) => calls.filter((c) => c === p).length;
    return { r, calls, count };
  };
  const expectApiFail = ({ r }) => {
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.startsWith('usage: API')).toBe(true);
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'o017-'));
    fakeGh = join(dir, 'gh');
    writeFileSync(
      fakeGh,
      `#!/usr/bin/env node
const fs = require('node:fs');
const cfg = JSON.parse(fs.readFileSync(process.env.FAKE_GH_CFG, 'utf8'));
const p = process.argv[3];
fs.appendFileSync(process.env.FAKE_GH_LOG, p + '\\n');
const n = fs.readFileSync(process.env.FAKE_GH_LOG, 'utf8').split('\\n').filter((l) => l === p).length - 1;
const steps = cfg.seq[p];
if (steps !== undefined) {
  const step = steps[Math.min(n, steps.length - 1)];
  if (step !== null) {
    if (step.raw !== undefined) { process.stdout.write(step.raw); process.exit(0); }
    process.stderr.write(step.stderr ?? '');
    process.exit(step.exit);
  }
}
const hit = cfg.routes[p];
if (hit !== undefined) { process.stdout.write(hit); process.exit(0); }
if (p.includes('/jobs')) { process.exit(1); }
process.stdout.write(JSON.stringify({ total_count: 0, workflow_runs: [] }));
`,
      { mode: 0o755 },
    );
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('(AC-O17-1) (TC-1) jobs 先 502 再成功 → 輸出與未失敗相同、2 次、stderr 空', () => {
    const t = exec({ [firstJobsKey]: [HTTP(502), null] });
    expect(t.r.status).toBe(0);
    expect(JSON.parse(t.r.stdout)).toEqual(expected);
    expect(t.r.stderr).toBe('');
    expect(t.count(firstJobsKey)).toBe(2);
  });

  it('(AC-O17-1) (TC-2) runs 頁 503 兩次後成功 → 3 次', () => {
    const t = exec({ [RUNS_KEY]: [HTTP(503), HTTP(503), null] });
    expect(t.r.status).toBe(0);
    expect(JSON.parse(t.r.stdout)).toEqual(expected);
    expect(t.r.stderr).toBe('');
    expect(t.count(RUNS_KEY)).toBe(3);
  });

  it('(AC-O17-1) (TC-3) 500、504 也重試', () => {
    const t = exec({ [RUNS_KEY]: [HTTP(500), null], [firstJobsKey]: [HTTP(504), null] });
    expect(t.r.status).toBe(0);
    expect(JSON.parse(t.r.stdout)).toEqual(expected);
    expect(t.count(RUNS_KEY)).toBe(2);
    expect(t.count(firstJobsKey)).toBe(2);
  });

  it('(AC-O17-2) (TC-4) 沒有狀態碼的 exit 1 → 重試', () => {
    const t = exec({ [firstJobsKey]: [{ exit: 1, stderr: 'boom' }, null] });
    expect(t.r.status).toBe(0);
    expect(JSON.parse(t.r.stdout)).toEqual(expected);
    expect(t.count(firstJobsKey)).toBe(2);
  });

  it('(AC-O17-3) (TC-5) 4xx（404、403、422、429）不重試，之後的路徑 0 次', () => {
    for (const code of [404, 403, 422, 429]) {
      const t = exec({ [RUNS_KEY]: [HTTP(code)] });
      expectApiFail(t);
      expect(t.count(RUNS_KEY)).toBe(1);
      expect(t.calls.at(-1)).toBe(RUNS_KEY);
    }
    const t = exec({ [firstJobsKey]: [HTTP(404)] });
    expectApiFail(t);
    expect(t.count(firstJobsKey)).toBe(1);
    expect(t.calls.at(-1)).toBe(firstJobsKey);
  });

  it('(AC-O17-4) (TC-6) exit 4、exit 0 非 JSON、gh 不存在 → 不重試', () => {
    const a = exec({ [firstJobsKey]: [{ exit: 4, stderr: 'weird' }] });
    expectApiFail(a);
    expect(a.count(firstJobsKey)).toBe(1);
    const b = exec({ [firstJobsKey]: [{ raw: 'not json' }] });
    expectApiFail(b);
    expect(b.count(firstJobsKey)).toBe(1);
    const c = exec({}, { bin: join(dir, 'no-such-gh') });
    expectApiFail(c);
  });

  it('(AC-O17-5) (TC-7) 一直 502 → exit 1、stdout 空、含 3 與 502、恰 3 次', () => {
    const t = exec({ [firstJobsKey]: [HTTP(502)] });
    expectApiFail(t);
    expect(t.r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(t.r.stderr).toContain('3');
    expect(t.r.stderr).toContain('502');
    expect(t.count(firstJobsKey)).toBe(GH_MAX_ATTEMPTS);
  });

  it('(AC-O17-5) (TC-8) 一直沒有狀態碼的 exit 1 → 含 3、狀態碼「無」、恰 3 次', () => {
    const t = exec({ [firstJobsKey]: [{ exit: 1, stderr: 'boom' }] });
    expectApiFail(t);
    expect(t.r.stderr).toContain('3');
    expect(t.r.stderr).toContain('無');
    expect(t.count(firstJobsKey)).toBe(3);
  });

  it('(AC-O17-6) (TC-9) 退避：base=100 → 整次執行 ≥ 300 毫秒', () => {
    const t0 = performance.now();
    const t = exec({ [firstJobsKey]: [HTTP(502)] }, { env: { ACTIONS_USAGE_RETRY_BASE_MS: '100' } });
    const elapsed = performance.now() - t0;
    expectApiFail(t);
    expect(elapsed).toBeGreaterThanOrEqual(300);
  });

  it('(AC-O17-6) (TC-10) 匯出常數預設值', () => {
    expect(GH_MAX_ATTEMPTS).toBe(3);
    expect(GH_RETRY_BASE_MS).toBe(1000);
  });

  it('(AC-O17-6) (TC-11) base 不合法（-1、1.5、abc、空字串）→ USAGE、gh 0 次', () => {
    for (const v of ['-1', '1.5', 'abc', '']) {
      const t = exec({}, { env: { ACTIONS_USAGE_RETRY_BASE_MS: v } });
      expect(t.r.status, v).toBe(1);
      expect(t.r.stdout, v).toBe('');
      expect(t.r.stderr.startsWith('usage: USAGE'), v).toBe(true);
      expect(t.calls, v).toHaveLength(0);
    }
  });

  it('(AC-O17-7) (TC-12) 既有 TC-1～TC-15、TC-22 斷言不變；新程式也符合無吞錯規則', () => {
    const text = readFileSync(join(here, 'actions-usage.mjs'), 'utf8');
    expect(text).toContain('GH_MAX_ATTEMPTS');
    expect(text).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });
});

describe('skipped job 算 0 分鐘（O-018）', () => {
  const skipped = (over = {}) => job(0, { conclusion: 'skipped', ...over });
  const zero = { minutes: 0, rawSeconds: 0 };
  const omit = (j, key) => {
    const copy = { ...j };
    delete copy[key];
    return copy;
  };

  it('(AC-O18-1) (TC-1) skipped、時間顛倒 1 秒與 10 秒 → 0 分鐘', () => {
    expect(billedMinutes(skipped({ completed_at: at(-1) }))).toEqual(zero);
    expect(billedMinutes(skipped({ completed_at: at(-10) }))).toEqual(zero);
  });

  it('(AC-O18-1) (TC-2) skipped、時間為 null、缺欄位、"x" → 0 分鐘且沒有 error', () => {
    const cases = [
      skipped({ started_at: null }),
      skipped({ completed_at: null }),
      omit(skipped(), 'started_at'),
      omit(skipped(), 'completed_at'),
      skipped({ started_at: 'x' }),
      skipped({ completed_at: 'x' }),
    ];
    for (const j of cases) {
      const b = billedMinutes(j);
      expect(b).toEqual(zero);
      expect(b).not.toHaveProperty('error');
    }
  });

  it('(AC-O18-1) (TC-3) skipped、時間正常但相差 61 秒 → 0 分鐘', () => {
    expect(billedMinutes(skipped({ completed_at: at(61) }))).toEqual(zero);
  });

  it('(AC-O18-2) (TC-4) 不是 skipped 的 completed job 時間顛倒 → DATA', () => {
    const values = ['success', 'failure', 'cancelled', null, 'Skipped'];
    const cases = values.map((c) => job(10, { conclusion: c, completed_at: at(-5) }));
    cases.push(job(10, { completed_at: at(-5) }));
    for (const j of cases) {
      const b = billedMinutes(j);
      expect(b).toHaveProperty('error');
      expect(b.rule).toBe('DATA');
    }
  });

  it('(AC-O18-2) (TC-5) 不是 skipped、completed_at 為 null → DATA', () => {
    const b = billedMinutes(job(10, { conclusion: 'success', completed_at: null }));
    expect(b).toHaveProperty('error');
    expect(b.rule).toBe('DATA');
  });

  it('(AC-O18-3) (TC-6) skipped 依 started_at 歸日，計入 jobs 與 runs', () => {
    const ok = job(61, { id: 1, conclusion: 'success' });
    const sk = skipped({ id: 2, completed_at: at(-3) });
    const both = summarize(base({ jobs: [ok, sk] }));
    const only = summarize(base({ jobs: [ok] }));
    expect(both.day.billed_minutes).toBe(2);
    expect(both.day.jobs).toBe(2);
    expect(both.day.runs).toBe(1);
    expect(both.day.raw_minutes).toBe(only.day.raw_minutes);
  });

  it('(AC-O18-3) (TC-7) 沒有合法 started_at 的 skipped 不計入任何數字', () => {
    const ok = job(61, { id: 1, conclusion: 'success' });
    for (const sk of [skipped({ id: 2, started_at: null }), omit(skipped({ id: 2 }), 'started_at'), skipped({ id: 2, started_at: 'x' })]) {
      const out = summarize(base({ jobs: [ok, sk] }));
      expect(out).not.toHaveProperty('error');
      expect(out.day.jobs).toBe(1);
      expect(out.cycle.by_workflow.map((w) => w.jobs)).toEqual([1]);
    }
  });

  it('(AC-O18-4) (TC-8) skipped 但 labels 非 ubuntu → RUNNER', () => {
    const b = billedMinutes(skipped({ labels: ['windows-latest'], completed_at: at(-3) }));
    expect(b).toHaveProperty('error');
    expect(b.rule).toBe('RUNNER');
  });

  it('(AC-O18-4) (TC-9) 未完成的 job 不看 conclusion，算 in_progress_jobs', () => {
    const j = job(0, { id: 2, status: 'in_progress', conclusion: 'skipped', completed_at: null });
    const out = summarize(base({ jobs: [j, job(61, { id: 1 })] }));
    expect(out.day.in_progress_jobs).toBe(1);
    expect(out.day.jobs).toBe(1);
  });

  describe('CLI（假 gh）', () => {
    let dir;
    let fakeGh;
    const input = readJson(join(fx, 'usage-normal', 'input.json'));
    const expected = readJson(join(fx, 'usage-normal', 'expected.json'));
    const ARGS = ['--repo', 'o/r', '--date', '2026-11-25', '--cycle-start', '2026-11-24', '--included', '2000'];

    const routesFor = (src) => {
      const routes = {};
      const byDay = new Map();
      for (const r of src.runs) {
        const day = r.created_at.slice(0, 10);
        byDay.set(day, [...(byDay.get(day) ?? []), r]);
        const jobs = src.jobs.filter((j) => j.run_id === r.id);
        routes[`repos/o/r/actions/runs/${r.id}/jobs?filter=all&per_page=100&page=1`] = JSON.stringify({ total_count: jobs.length, jobs });
      }
      for (const [day, list] of byDay) {
        routes[`repos/o/r/actions/runs?created=${day}&per_page=100&page=1`] = JSON.stringify({ total_count: list.length, workflow_runs: list });
      }
      return routes;
    };
    const withExtra = (conclusion) => {
      const src = structuredClone(input);
      const first = src.jobs[0];
      src.jobs.push({
        ...first,
        id: 987654321,
        conclusion,
        started_at: '2026-11-25T03:00:10Z',
        completed_at: '2026-11-25T03:00:07Z',
      });
      return src;
    };
    const exec = (src) => {
      const routesFile = join(dir, 'routes.json');
      writeFileSync(routesFile, JSON.stringify({ routes: routesFor(src) }));
      return spawnSync(process.execPath, [cli, ...ARGS], {
        encoding: 'utf8',
        env: { ...process.env, GH_BIN: fakeGh, FAKE_GH_ROUTES: routesFile, ACTIONS_USAGE_RETRY_BASE_MS: '0' },
      });
    };

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'o018-'));
      fakeGh = join(dir, 'gh');
      writeFileSync(
        fakeGh,
        `#!/usr/bin/env node
const fs = require('node:fs');
const cfg = JSON.parse(fs.readFileSync(process.env.FAKE_GH_ROUTES, 'utf8'));
const hit = cfg.routes[process.argv[3]];
if (hit !== undefined) { process.stdout.write(hit); process.exit(0); }
if (process.argv[3].includes('/jobs')) { process.exit(1); }
process.stdout.write(JSON.stringify({ total_count: 0, workflow_runs: [] }));
`,
        { mode: 0o755 },
      );
    });
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('(AC-O18-5) (TC-10) skipped 時間顛倒 3 秒 → exit 0，分鐘數與沒有該 job 時相同', () => {
      const r = exec(withExtra('skipped'));
      expect(r.status).toBe(0);
      expect(r.stdout.trimEnd().split('\n')).toHaveLength(1);
      const out = JSON.parse(r.stdout);
      expect(out.day.billed_minutes).toBe(expected.day.billed_minutes);
      expect(out.cycle.billed_minutes).toBe(expected.cycle.billed_minutes);
    });

    it('(AC-O18-2) (TC-11) 同樣的顛倒 job 但 conclusion 是 success → exit 1、DATA', () => {
      const r = exec(withExtra('success'));
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr.startsWith('usage: DATA')).toBe(true);
    });
  });

  it('(AC-O18-6) (TC-12) 既有測試不變；import 只用 node: 與 ./，沒有吞錯', () => {
    const text = readFileSync(join(here, 'actions-usage.mjs'), 'utf8');
    const specs = [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specs) expect(s.startsWith('node:') || s.startsWith('./'), s).toBe(true);
    expect(text).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });
});

describe('新增檔案的規則', () => {
  const sources = ['actions-usage.mjs', 'pr-body-lint.mjs'].map((f) => [f, readFileSync(join(here, f), 'utf8')]);
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

  it('(AC-O16-6) (TC-22) import 只有 node: 與 ./；沒有吞錯；fixtures 不是 QA 擁有檔樣式', () => {
    for (const [name, text] of sources) {
      const specs = [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(specs.length, name).toBeGreaterThan(0);
      for (const s of specs) expect(s.startsWith('node:') || s.startsWith('./'), `${name}: ${s}`).toBe(true);
      expect(text, name).not.toMatch(new RegExp('\\|\\|\\s*true'));
      expect(text, name).not.toContain('continue-on-error');
      expect(text, name).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
      expect(text, name).not.toMatch(/catch[^{]*\{[^}]*(exit\(0\)|exitCode\s*=\s*0)/);
    }
    const files = walk(join(fx));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f).not.toMatch(/\.qa\.test\.ts$/);
      expect(f).not.toMatch(/qa_[^/]*\.sql$/);
      expect(f).not.toMatch(/docs\/qa\/mutants\//);
    }
  });
});

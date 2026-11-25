import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { billedMinutes, summarize } from './actions-usage.mjs';

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
      env: { ...process.env, GH_BIN: fakeGh, FAKE_GH_ROUTES: routesFile },
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

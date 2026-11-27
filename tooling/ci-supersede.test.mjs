import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decideSupersede } from './ci-supersede.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, 'ci-supersede.mjs');
const SRC = readFileSync(cli, 'utf8');
const SHA = 'a'.repeat(40);
const REPO = 'hansheng08/english-coach';

const prRun = (over = {}) => ({
  id: 200,
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  head_sha: SHA,
  head_branch: 'task/T-018',
  head_repository: { full_name: REPO },
  pull_requests: [{ number: 82 }],
  ...over,
});
const pushRun = (over = {}) => ({
  id: 100,
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  head_sha: SHA,
  head_branch: 'task/T-018',
  head_repository: { full_name: REPO },
  pull_requests: [],
  ...over,
});
const okJobs = (id = 200) => ({ [String(id)]: [{ name: 'check', conclusion: 'success' }, { name: 'ci-ok', conclusion: 'success' }] });
const input = (over = {}) => ({ sha: SHA, repo: REPO, runs: [prRun(), pushRun()], jobs: okJobs(), existing: [], ...over });
const marked = (prRunId) => ({ state: 'success', description: `push run 100 紅燈已被 PR #82 的 run ${String(prRunId)} 取代；非必過、請勿為消紅燈重推` });

describe('decideSupersede', () => {
  it('(AC-O28-5) (TC-10) 取代成立 → mark，帶 PR 編號與兩個 run id', () => {
    const r = decideSupersede(input());
    expect(r).toMatchObject({ action: 'mark', prNumber: 82, prRunId: 200, pushRunId: 100 });
    expect(r.description.length).toBeLessThanOrEqual(140);
    expect(r.description).toContain('100');
    expect(r.description).toContain('82');
    expect(r.description).toContain('非必過');
  });

  it('(AC-O28-6) (TC-11) 不得標註的情況', () => {
    const cases = {
      'PR ci-ok failure': input({ jobs: { 200: [{ name: 'ci-ok', conclusion: 'failure' }] } }),
      '只有 ci-ok (push)': input({ jobs: { 200: [{ name: 'ci-ok (push)', conclusion: 'success' }] } }),
      '沒有 jobs': input({ jobs: {} }),
      '舊 PR run 綠、新 PR run 紅': input({
        runs: [prRun(), prRun({ id: 300 }), pushRun()],
        jobs: { ...okJobs(200), 300: [{ name: 'ci-ok', conclusion: 'failure' }] },
      }),
      'push success': input({ runs: [prRun(), pushRun({ conclusion: 'success' })] }),
      'push in_progress': input({ runs: [prRun(), pushRun({ status: 'in_progress', conclusion: null })] }),
      'push 在 main': input({ runs: [prRun(), pushRun({ head_branch: 'main' })] }),
      'PR 未完成': input({ runs: [prRun({ status: 'in_progress', conclusion: null }), pushRun()] }),
      fork: input({ runs: [prRun({ head_repository: { full_name: 'someone/english-coach' } }), pushRun()] }),
      '沒有 PR run': input({ runs: [pushRun()] }),
      '沒有 PR 編號': input({ runs: [prRun({ pull_requests: [] }), pushRun()] }),
      'head_sha 不同': input({ runs: [prRun({ head_sha: 'b'.repeat(40) }), pushRun({ head_sha: 'b'.repeat(40) })] }),
      'PR run 的 head_sha 不同': input({ runs: [prRun({ head_sha: 'b'.repeat(40) }), pushRun()] }),
    };
    for (const [name, c] of Object.entries(cases)) {
      expect(decideSupersede(c).action, name).not.toBe('mark');
    }
  });

  it('(AC-O28-7) (TC-12) 已標過同一 PR run → none；條件不成立且先前 success → retract', () => {
    expect(decideSupersede(input({ existing: [marked(200)] })).action).toBe('none');
    expect(decideSupersede(input({ existing: [marked(150)] })).action).toBe('mark');
    expect(decideSupersede(input({ existing: [{ state: 'pending' }] })).action).toBe('mark');
    const broken = input({ jobs: { 200: [{ name: 'ci-ok', conclusion: 'failure' }] }, existing: [marked(200)] });
    expect(decideSupersede(broken).action).toBe('retract');
    expect(decideSupersede({ ...broken, existing: [] }).action).toBe('none');
  });

  it('(AC-O28-7) (TC-13) 輸入不合法 → bad-input、不是 mark', () => {
    for (const bad of [input({ sha: 'xyz' }), input({ runs: 'x' }), input({ jobs: [] }), input({ existing: null }), input({ repo: '' }), null]) {
      const r = decideSupersede(bad);
      expect(r.action).toBe('none');
      expect(r.reason).toBe('bad-input');
    }
  });
});

describe('ci-supersede CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'o028-cli-'));
  const file = (name, value) => {
    const p = join(dir, name);
    writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
    return p;
  };
  const exec = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const good = () => ({
    runs: file('runs.json', [prRun(), pushRun()]),
    jobs: file('jobs.json', okJobs()),
    existing: file('existing.json', []),
  });
  const args = (f, sha = SHA) => ['decide', '--sha', sha, '--repo', REPO, '--runs', f.runs, '--jobs', f.jobs, '--existing', f.existing];

  it('(AC-O28-5) (TC-10) CLI：mark 輸出 JSON、exit 0', () => {
    const r = exec(args(good()));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ action: 'mark', prNumber: 82, prRunId: 200, pushRunId: 100 });
  });

  it('(AC-O28-7) (TC-13) CLI：非 JSON、壞 sha、缺 --existing → INPUT、非 0、stdout 無 mark', () => {
    const f = good();
    const badRuns = { ...f, runs: file('bad.json', 'not json') };
    const missingExisting = args(f).slice(0, -2);
    const cases = [args(badRuns), args(f, 'abc'), missingExisting, args({ ...f, jobs: join(dir, 'nope.json') }), ['decide'], []];
    for (const c of cases) {
      const r = exec(c);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('mark');
      expect(r.stderr).toMatch(/INPUT|USAGE/);
    }
  });
});

// 突變：改一個條件，行為檢查必須判出「壞了」。
async function loadMutant([from, to]) {
  expect(SRC).toContain(from);
  const dir = mkdtempSync(join(tmpdir(), 'o028-mut-'));
  copyFileSync(join(here, 'task-file.mjs'), join(dir, 'task-file.mjs'));
  writeFileSync(join(dir, 'ci-supersede.mjs'), SRC.replace(from, to));
  return import(pathToFileURL(join(dir, 'ci-supersede.mjs')).href);
}

function brokenBehaviours(mod) {
  const broken = [];
  const asMark = (c) => mod.decideSupersede(c).action === 'mark';
  if (asMark(input({ jobs: { 200: [{ name: 'ci-ok (push)', conclusion: 'success' }] } }))) broken.push('push-ci-ok');
  if (asMark(input({ runs: [prRun({ head_repository: { full_name: 'x/y' } }), pushRun()] }))) broken.push('fork');
  if (asMark(input({ runs: [prRun({ head_sha: 'b'.repeat(40) }), pushRun()] }))) broken.push('head-sha');
  if (asMark(input({ runs: [prRun(), prRun({ id: 300 }), pushRun()], jobs: { ...okJobs(200), 300: [{ name: 'ci-ok', conclusion: 'failure' }] } }))) broken.push('latest-pr-run');
  if (!asMark(input())) broken.push('base-case');
  return broken;
}

describe('突變必須被抓到（O-028 supersede）', () => {
  it('(AC-O28-10) (TC-14) 真實實作沒有任何行為不符', () => {
    expect(brokenBehaviours({ decideSupersede })).toEqual([]);
  });

  const mutants = [
    ['把 ci-ok (push) 當成 ci-ok', ["j.name === 'ci-ok'", "j.name.startsWith('ci-ok')"], 'push-ci-ok'],
    ['接受 fork PR run', ['!isObj(run.head_repository) || run.head_repository.full_name !== repo', 'false'], 'fork'],
    ['不比對 head_sha', ['r.head_sha === sha', 'true'], 'head-sha'],
    ['不取最新 PR run', ['r.id > best.id', 'r.id < best.id'], 'latest-pr-run'],
  ];
  for (const [name, replacer, expected] of mutants) {
    it(`(AC-O28-10) (TC-14) 突變「${name}」→ 被抓到`, async () => {
      expect(brokenBehaviours(await loadMutant(replacer))).toContain(expected);
    });
  }
});

describe('fail-closed 掃描', () => {
  it('(AC-O28-11) (TC-15) 本單檔案沒有 || true、continue-on-error、空 catch', () => {
    for (const f of ['ci-mode.mjs', 'ci-supersede.mjs']) {
      const src = readFileSync(join(here, f), 'utf8');
      expect(src).not.toMatch(/\|\|\s*true/);
      expect(src).not.toContain('continue-on-error');
      expect(src).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
    }
  });
});

// O-033 vitest wrapper and real-file tests (SRE). The lock and Notify suites
// live under .github/scripts, which vitest does not collect, so ac-coverage
// would never see AC-O33-6 ~ AC-O33-8 / AC-O33-11 and the real-file layer of
// AC-O33-9. The snapshot tests run the REAL "Snapshot trusted scripts" run:
// text from claude-run-task.yml in a temp checkout (no network, no Docker).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintText } from '../.github/scripts/fail-open-lint.mjs';
import { stepsOf, trustedScriptProblems } from './trusted-scripts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const scripts = join(repo, '.github', 'scripts');
const WF = join(repo, '.github', 'workflows', 'claude-run-task.yml');
const yml = readFileSync(WF, 'utf8');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: repo, ...opts });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// The `run: |` body of a named step, de-indented (same rule as the Notify
// extraction in run-task-validate-id-test.sh).
function runBody(text, name) {
  const step = stepsOf(text)?.find((s) => s.name === name);
  if (!step) throw new Error(`step not found: ${name}`);
  const lines = step.text.split('\n');
  const i = lines.findIndex((l) => /^ {8}run: \|$/.test(l));
  if (i < 0) throw new Error(`no run: | in ${name}`);
  const body = [];
  for (const l of lines.slice(i + 1)) {
    if (l === '' || l.startsWith('          ')) body.push(l.slice(10));
    else break;
  }
  return `${body.join('\n')}\n`;
}

// Every file under dir as { relative path: content }.
function tree(dir, base = dir, out = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tree(p, base, out);
    else out[p.slice(base.length + 1)] = readFileSync(p, 'utf8');
  }
  return out;
}

// A temp "dispatch checkout": real .github/scripts and tooling in a git repo.
function checkout(root, { withTooling = true } = {}) {
  const ws = join(root, 'ws');
  mkdirSync(join(ws, '.github'), { recursive: true });
  cpSync(scripts, join(ws, '.github', 'scripts'), { recursive: true });
  if (withTooling) cpSync(here, join(ws, 'tooling'), { recursive: true, filter: (s) => !s.includes('node_modules') });
  const git = (...a) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: ws });
  expect(git('init', '-q').code).toBe(0);
  expect(git('commit', '-q', '--allow-empty', '-m', 'snapshot source').code).toBe(0);
  return ws;
}

function snapshot(ws, rt, body = runBody(yml, 'Snapshot trusted scripts')) {
  writeFileSync(join(rt, '..', 'snapshot.sh'), body);
  return run('bash', [join(rt, '..', 'snapshot.sh')], { cwd: ws, env: { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: rt } });
}

// Copies equal: [] or the first differences.
function diffTrees(ws, rt) {
  const diffs = [];
  for (const [src, dst] of [['.github/scripts', 'trusted/.github/scripts'], ['tooling', 'trusted/tooling']]) {
    if (!existsSync(join(rt, dst))) { diffs.push(`${dst} missing`); continue; }
    const a = tree(join(ws, src));
    const b = tree(join(rt, dst));
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) diffs.push(`${dst}/${k}`);
  }
  return diffs.slice(0, 5);
}

// The task-id class assembled from pieces (no old regex literal in the repo).
const CLS = `[${'TQOAP'}]`;
const DEF_ID = `^${CLS}-[0-9]{3}[a-z]?(-fix[1-9][0-9]*)?$`;
const OLD_ID = `^${CLS}-[0-9]{3}(-fix[0-9]+)?$`;

const suites = {};
const temps = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'o033-')); temps.push(d); return d; };

beforeAll(() => {
  suites.permCheck = run(process.execPath, [join(scripts, 'claude-permission-check.mjs'), repo]);
  suites.permTests = run(process.execPath, ['--test', join(scripts, 'claude-permission-check.test.mjs')]);
  suites.validateId = run('bash', [join(scripts, 'run-task-validate-id-test.sh')]);
  suites.failOpen = run(process.execPath, [join(scripts, 'fail-open-lint.mjs'), repo]);
}, 300_000);
afterAll(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

describe('O-033 trusted snapshot (SRE wiring)', () => {
  it('script suites used by AC/TC all exit 0', () => {
    for (const [name, r] of Object.entries(suites)) expect(r.code, `${name}:\n${r.out}`).toBe(0);
  });

  it('(AC-O33-6) (TC-15) real claude-run-task.yml passes the lock; permission check wired; tests in the existing ci.yml step', () => {
    expect(trustedScriptProblems(yml)).toEqual([]);
    const names = stepsOf(yml).map((s) => s.name);
    expect(names.slice(1, 3)).toEqual(['Snapshot trusted scripts', 'Validate task id']);
    expect(suites.permCheck.out).toMatch(/O-033: Snapshot trusted scripts at step 2; every step after the task-branch switch runs \.github\/scripts and tooling from \$RUNNER_TEMP\/trusted, TOOLING_DIR trusted/);
    expect(suites.permCheck.out).toMatch(/claude-permission-check: OK \(.*O-033 guard scripts from the trusted snapshot after the branch switch\)/);
    expect(suites.permTests.out).toMatch(/✔ \(AC-O33-6\) \(TC-15\) real claude-run-task\.yml: snapshot step 2, Validate step 3, five guard steps trusted/);
    const ci = readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/\n {12}\.github\/scripts\/claude-permission-check\.test\.mjs\n/);
    expect(ci).toMatch(/\n {10}bash \.github\/scripts\/run-task-validate-id-test\.sh\n/);
    expect(ci).toMatch(/\n {10}node \.github\/scripts\/claude-permission-check\.mjs \.\n/);
    expect(existsSync(join(here, 'o033.test.mjs'))).toBe(true);
  });

  it('(AC-O33-7) (TC-16) the real snapshot copies both directories file by file and later work-tree edits do not reach it', () => {
    const root = temp();
    const ws = checkout(root);
    const rt = join(root, 'rt');
    mkdirSync(rt);
    const r = snapshot(ws, rt);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/^run-task: trusted scripts and tooling from [0-9a-f]{40}$/m);
    expect(diffTrees(ws, rt)).toEqual([]);
    const before = { ...tree(join(rt, 'trusted')) };
    // The task-branch switch: the work tree now holds old / broken guards.
    writeFileSync(join(ws, '.github', 'scripts', 'run-task-post-check.sh'), 'exit 0\n');
    writeFileSync(join(ws, 'tooling', 'scope-check.mjs'), 'process.exit(0);\n');
    expect(tree(join(rt, 'trusted'))).toEqual(before);
    expect(diffTrees(ws, rt).length).toBeGreaterThan(0);
  });

  it('(AC-O33-7) (TC-17) T-035b: the trusted validate accepts it, the stale work-tree copy (old regex) rejects it', () => {
    const root = temp();
    const ws = checkout(root);
    const rt = join(root, 'rt');
    mkdirSync(rt);
    expect(snapshot(ws, rt).code).toBe(0);
    const v = join(ws, '.github', 'scripts', 'run-task-validate-id.sh');
    const src = readFileSync(v, 'utf8');
    expect(src).toContain(DEF_ID);
    writeFileSync(v, src.split(DEF_ID).join(OLD_ID));
    const env = { PATH: process.env.PATH, TASK: 'T-035b' };
    const trusted = run('bash', [join(rt, 'trusted', '.github', 'scripts', 'run-task-validate-id.sh')], { cwd: ws, env });
    const stale = run('bash', [v], { cwd: ws, env });
    expect(trusted.code, trusted.out).toBe(0);
    expect(stale.code).toBe(1);
    expect(stale.out).toMatch(/invalid task id/);
  });

  it('(AC-O33-7) (TC-18) fail-closed: no tooling/ in the checkout, or a trusted root that already exists', () => {
    const root = temp();
    const ws = checkout(root, { withTooling: false });
    const rt = join(root, 'rt');
    mkdirSync(rt);
    expect(snapshot(ws, rt).code).not.toBe(0);
    const root2 = temp();
    const ws2 = checkout(root2);
    const rt2 = join(root2, 'rt');
    mkdirSync(join(rt2, 'trusted'), { recursive: true });
    const r = snapshot(ws2, rt2);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/trusted already exists/);
  });

  it('(AC-O33-8) (TC-19) Notify runs from the trusted root: one failure POST with a stale work tree, fails without the root', () => {
    const out = suites.validateId.out;
    expect(out.split('\n').filter((l) => l.startsWith('CASE OK: (AC-O32-7) (TC-16) (AC-O33-8) (TC-19) Validate failed, stale work tree'))).toHaveLength(9);
    expect(out).toMatch(/CASE OK: \(AC-O32-7\) \(TC-17\) \(AC-O33-8\) \(TC-19\) without the trusted root \(work tree scripts present\) -> exit [1-9]\d*, no POST/);
    expect(out).toMatch(/CASE OK: \(AC-O32-7\) \(TC-18\) all skipped -> failure, not success/);
    expect(out).not.toMatch(/CASE FAIL|mutant survived/);
  });

  it('(AC-O33-9) (TC-20) real-file weakenings are caught', () => {
    for (let n = 1; n <= 16; n += 1) expect(suites.permTests.out).toMatch(new RegExp(`✔ O33-M${String(n)} mutation .* -> exit 1`));
    // Runtime mutants of the real snapshot text.
    const body = runBody(yml, 'Snapshot trusted scripts');
    const mutants = {
      'no tooling copy': body.replace(/^cp -R tooling .*\n/m, ''),
      'existing root tolerated': body.replace(/^if \[\[ -e [\s\S]*?^fi\n/m, 'rm -rf "${RUNNER_TEMP}/trusted"\n'),
    };
    for (const [name, text] of Object.entries(mutants)) expect(text, name).not.toBe(body);
    const root = temp();
    const ws = checkout(root);
    const rt = join(root, 'rt');
    mkdirSync(rt);
    expect(snapshot(ws, rt, mutants['no tooling copy']).code).toBe(0);
    expect(diffTrees(ws, rt)).toContain('trusted/tooling missing');
    const root2 = temp();
    const ws2 = checkout(root2);
    const rt2 = join(root2, 'rt');
    mkdirSync(join(rt2, 'trusted'), { recursive: true });
    expect(snapshot(ws2, rt2, mutants['existing root tolerated']).code).toBe(0); // the TC-18 assertion (non-zero) would fail
    // A workflow whose guard steps run from the work tree is rejected.
    const relative = yml.split('"${RUNNER_TEMP}/trusted/.github/scripts/').join('.github/scripts/');
    expect(trustedScriptProblems(relative).length).toBeGreaterThanOrEqual(5);
  });

  it('(AC-O33-10) (TC-21) no unallowlisted fail-open pattern in the files this wiring touches', () => {
    expect(suites.failOpen.out).toMatch(/fail-open-lint: no unallowlisted/);
    for (const f of [
      '.github/workflows/claude-run-task.yml', '.github/scripts/claude-permission-check.mjs',
      '.github/scripts/claude-permission-check.test.mjs', '.github/scripts/run-task-validate-id-test.sh',
      'tooling/o033.test.mjs', 'tooling/trusted-scripts.mjs',
    ]) expect(lintText(readFileSync(join(repo, f), 'utf8'), f), f).toEqual([]);
    expect(trustedScriptProblems('').length).toBeGreaterThan(0);
  });

  it('(AC-O33-11) (TC-22) RUNBOOK states where the guard scripts come from and the known residuals', () => {
    const rb = readFileSync(join(repo, 'docs', 'RUNBOOK.md'), 'utf8');
    const line = rb.split('\n').find((l) => l.startsWith('**守門腳本來源（O-033）**'));
    expect(line).toBeDefined();
    expect(line).toContain('派工當下的 main');
    expect(line).toContain('`$RUNNER_TEMP/trusted`');
    expect(line).toMatch(/task 分支上的 `\.github\/scripts`、`tooling` 對守門沒有影響/);
    expect(line).toContain('`.claude/**`');
  });
});

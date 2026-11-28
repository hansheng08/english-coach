// O-031 vitest wrapper (SRE): the wiring tests live under .github/scripts, which vitest does
// not collect, so ac-coverage would never see AC-O31-4..10 / TC-10..20. This file runs those
// suites and asserts on their real output and on the real files.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from '../.github/scripts/ci-workflow-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const scripts = join(repo, '.github', 'scripts');
const read = (rel) => readFileSync(join(repo, rel), 'utf8');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: repo });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const suites = {};

beforeAll(() => {
  suites.wrapper = run('bash', [join(scripts, 'supabase-start-test.sh')]);
  suites.workflow = run(process.execPath, [join(scripts, 'ci-workflow-check.mjs'), repo]);
  suites.workflowTests = run(process.execPath, ['--test', join(scripts, 'ci-workflow-check.test.mjs')]);
  suites.failOpen = run(process.execPath, [join(scripts, 'fail-open-lint.mjs'), repo]);
}, 180_000);

const okLines = (label) => suites.wrapper.out.split('\n').filter((l) => l.startsWith(`ok   ${label}`));
const passed = (name) => new RegExp(`^✔ mutation ${name} `, 'm').test(suites.workflowTests.out);

describe('O-031 vitest wrapper (ac-coverage)', () => {
  it('script suites used by AC/TC all exit 0', () => {
    for (const [name, r] of Object.entries(suites)) expect(r.code, `${name}:\n${r.out}`).toBe(0);
    expect(suites.wrapper.out).toMatch(/^supabase-start-test: OK \(22 cases, 15 mutants killed\)$/m);
    expect(suites.workflow.out).toMatch(/ci-workflow-check: OK/);
  });

  it('(AC-O31-4) (TC-10) first success: no stop, no wait', () => {
    expect(okLines('TC-10 ')).toHaveLength(1);
  });

  it('(AC-O31-4) (TC-11) rescued by a retry after stop --no-backup, evidence per attempt', () => {
    expect(okLines('TC-11 ')).toHaveLength(2);
  });

  it('(AC-O31-4) (TC-12) three port-bind failures exit non-zero with diagnostics and a summary', () => {
    expect(okLines('TC-12 ')).toHaveLength(1);
    expect(okLines('AC-O31-4 diagnostics')).toHaveLength(1);
    expect(okLines('AC-O31-4 mask rules identical')).toHaveLength(1);
  });

  it('(AC-O31-4) (TC-13) fatal is attempted once', () => {
    expect(okLines('TC-13 ')).toHaveLength(1);
  });

  it('(AC-O31-4) (TC-14) a non-Docker listener after cleanup stops the retry', () => {
    expect(okLines('TC-14 ')).toHaveLength(3);
  });

  it('(AC-O31-5) (TC-15) every Supabase start goes through the wrapper with unchanged flags', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^ {6}- name: Start local Supabase\n {8}run: bash \.github\/scripts\/supabase-start\.sh -x studio,imgproxy,logflare,vector\n/m);
    expect(ci).toMatch(/^ {10}psql --version\n {10}bash \.github\/scripts\/supabase-start\.sh -x studio,imgproxy,logflare,vector,mailpit,realtime,postgres-meta,supavisor\n/m);
    expect(ci).not.toMatch(/^\s+(run: )?supabase (--workdir \S+ )?start\b/m);
    const dbv = read('.github/scripts/db-job-verify.sh');
    expect(dbv).toContain('bash "$(dirname "${BASH_SOURCE[0]}")/supabase-start.sh" --workdir "$WORKDIR" -x "$EXCLUDES"\n');
    expect(dbv).not.toMatch(/^\s*supabase (--workdir \S+ )?start\b/m);
    for (const n of ['SS-M1', 'SS-M2', 'SS-M3', 'SS-M4', 'SS-M5', 'SS-M6', 'SS-M7', 'SS-M8', 'SS-M17']) expect(passed(n), n).toBe(true);
  });

  it('(AC-O31-6) (TC-16) port reservation before attempt 1, warning only, old values kept', () => {
    expect(okLines('TC-16 ')).toHaveLength(5);
  });

  it('(AC-O31-7) (TC-17) no new job, budget 7, timeouts unchanged, db has Node, no shell classifier', () => {
    expect(JSON.parse(read('.github/ci-budget.json')).max_jobs['ci.yml']).toBe(7);
    const ci = read('.github/workflows/ci.yml');
    const wf = parseWorkflow(ci);
    expect([...wf.jobs.keys()]).toEqual(['ci-guard', 'check', 'taskcheck', 'bundle', 'db', 'e2e', 'ci-ok']);
    expect([wf.jobs.get('taskcheck').timeout, wf.jobs.get('db').timeout, wf.jobs.get('e2e').timeout]).toEqual(['40', '20', '20']);
    const db = ci.slice(ci.indexOf('\n  db:\n'), ci.indexOf('\n  e2e:\n'));
    expect(db).toMatch(/timeout-minutes: 20\n/);
    expect(db.indexOf('uses: supabase/setup-cli@')).toBeGreaterThan(0);
    expect(db.indexOf('uses: supabase/setup-cli@')).toBeLessThan(db.indexOf('run: bash .github/scripts/db-job-verify.sh'));
    const w = read('.github/scripts/supabase-start.sh');
    expect(w).toContain('kind="$(node "$POLICY" classify "$log")"');
    expect(w).toContain('decision="$(node "$POLICY" decide "$attempt" "$kind" "$held")"');
    expect(w.toLowerCase()).not.toMatch(/address already in use|rate exceeded|failed to bind host port|toomanyrequests/);
    expect(okLines('AC-O31-7 node missing')).toHaveLength(1);
    for (const n of ['SS-M9', 'SS-M10', 'SS-M11', 'SS-M13', 'SS-M14', 'SS-M15', 'SS-M16']) expect(passed(n), n).toBe(true);
  });

  it('(AC-O31-8) (TC-18) RUNBOOK section: root cause, rules, diagnostics, counting, rejected options', () => {
    const rb = read('docs/RUNBOOK.md');
    const at = rb.indexOf('### 2.5 `supabase start` 重試與診斷（O-031）');
    expect(at).toBeGreaterThan(0);
    const sec = rb.slice(at, rb.indexOf('\n## 3. ', at));
    for (const s of ['**根因判斷', '54322', '54324', '46166949622', '141046714048', '**更正**', 'ephemeral', '**重試規則**', '10 秒', '20 秒', 'supabase stop --no-backup', 'ip_local_reserved_ports', '**證據行與診斷怎麼讀**', 'supabase-start: OK on attempt 2', 'TIME-WAIT', '**CLI 仍釘 3.2.0', 'docker save', 'SUPABASE_INTERNAL_IMAGE_REGISTRY', '3.4.0']) {
      expect(sec, s).toContain(s);
    }
  });

  it('(AC-O31-9) (TC-19) weakened wiring is caught (script and workflow mutants)', () => {
    expect(suites.wrapper.out.match(/^ok {3}mutant '.+' killed$/gm)).toHaveLength(15);
    expect(suites.wrapper.out).not.toMatch(/survived/);
    for (const n of ['failure exits 0', 'no cleanup before retry', 'held port ignored']) expect(suites.wrapper.out).toContain(`ok   mutant '${n}' killed`);
    for (const n of ['SS-M1', 'SS-M2', 'SS-M3']) expect(passed(n), n).toBe(true);
  });

  it('(AC-O31-10) (TC-20) no unallowed || true / continue-on-error; stop failure does not hide the start failure', () => {
    expect(suites.failOpen.code).toBe(0);
    for (const rel of ['.github/scripts/supabase-start.sh', '.github/scripts/supabase-start-test.sh']) {
      expect(read(rel), rel).not.toMatch(/\|\|\s*(true|:)(\s|$)|continue-on-error/);
    }
    // db-job-verify.sh keeps its pre-existing allowlisted cleanups only; every one carries o004-allow.
    for (const l of read('.github/scripts/db-job-verify.sh').split('\n').filter((x) => /\|\|\s*true\b/.test(x))) expect(l).toContain('# o004-allow:');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s+continue-on-error:/m);
    expect(okLines('stop --no-backup failing is logged')).toHaveLength(1);
  });
});

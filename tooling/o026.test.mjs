import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const scripts = join(repo, '.github', 'scripts');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: repo });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const suites = {};

beforeAll(() => {
  suites.preHead = run('bash', [join(scripts, 'run-task-pre-head-test.sh')]);
  suites.verify = run('bash', [join(scripts, 'verify-push-test.sh')]);
  suites.outcome = run('bash', [join(scripts, 'run-task-outcome-test.sh')]);
  suites.summary = run('bash', [join(scripts, 'run-task-summary-step-test.sh')]);
  suites.comment = run(process.execPath, ['--test', join(scripts, 'post-run-task-comment.test.mjs')]);
});

describe('O-026 vitest wrapper (ac-coverage)', () => {
  it('script suites used by AC/TC all exit 0', () => {
    for (const [name, r] of Object.entries(suites)) {
      expect(r.code, `${name}:\n${r.out}`).toBe(0);
    }
  });

  it('(AC-O26-1) (TC-1) existing branch is checked out at PRE_HEAD', () => {
    expect(suites.preHead.code, suites.preHead.out).toBe(0);
  });

  it('(AC-O26-1) (TC-2) first run stays on main', () => {
    expect(suites.preHead.code, suites.preHead.out).toBe(0);
  });

  it('(AC-O26-2) (TC-3) SKILL continues an existing head', () => {
    expect(suites.preHead.code, suites.preHead.out).toBe(0);
  });

  it('(AC-O26-3) (TC-4) stale remote 28367c8 vs local 7fb74cc fails verify', () => {
    expect(suites.verify.code, suites.verify.out).toBe(0);
  });

  it('(AC-O26-3) (TC-5) this SHA with in_progress or failed push CI still verifies', () => {
    expect(suites.verify.code, suites.verify.out).toBe(0);
  });

  it('(AC-O26-3) (TC-9) missing push CI for this SHA fails verify', () => {
    expect(suites.verify.code, suites.verify.out).toBe(0);
  });

  it('(AC-O26-4) (TC-6) post-check failure is not overwritten by summary failure', () => {
    expect(suites.outcome.code, suites.outcome.out).toBe(0);
  });

  it('(AC-O26-5) (TC-7) unpushed SHA gets no commit comment', () => {
    expect(suites.summary.code, suites.summary.out).toBe(0);
    expect(suites.comment.code, suites.comment.out).toBe(0);
  });

  it('(AC-O26-6) (TC-8) mutants of verify, outcome, comments, and SKILL are caught', () => {
    expect(suites.preHead.code, suites.preHead.out).toBe(0);
    expect(suites.verify.code, suites.verify.out).toBe(0);
    expect(suites.outcome.code, suites.outcome.out).toBe(0);
    expect(suites.comment.code, suites.comment.out).toBe(0);
  });
});

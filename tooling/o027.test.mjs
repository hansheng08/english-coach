import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const scripts = join(repo, '.github', 'scripts');
const ciYml = join(repo, '.github', 'workflows', 'ci.yml');

function run(cmd, args, cwd = repo) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const suites = {};

beforeAll(() => {
  suites.workflow = run(process.execPath, [join(scripts, 'ci-workflow-check.mjs'), repo]);
  suites.workflowTests = run(process.execPath, ['--test', join(scripts, 'ci-workflow-check.test.mjs')]);
  suites.taskcheck = run('bash', [join(scripts, 'taskcheck-test.sh')]);
});

describe('O-027 vitest wrapper (ac-coverage)', () => {
  it('script suites used by AC/TC all exit 0', () => {
    for (const [name, r] of Object.entries(suites)) {
      expect(r.code, `${name}:\n${r.out}`).toBe(0);
    }
  });

  it('(AC-O27-1) (TC-1) e2e step is pnpm e2e --reporter=list --reporter=json with no --', () => {
    const text = readFileSync(ciYml, 'utf8');
    expect(text).toMatch(/run:\s+pnpm e2e --reporter=list --reporter=json\s*$/m);
    expect(text).not.toMatch(/pnpm e2e\s+--\s+--reporter/);
    expect(suites.workflow.code, suites.workflow.out).toBe(0);
    expect(suites.workflow.out).toMatch(/ci-workflow-check: OK/);
  });

  it('(AC-O27-1) (TC-1) re-adding -- makes ci-workflow-check fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'o027-wf-'));
    try {
      cpSync(join(repo, '.github'), join(dir, '.github'), { recursive: true });
      cpSync(join(repo, '.claude/hooks/pushguard'), join(dir, '.claude/hooks/pushguard'), { recursive: true });
      const ci = join(dir, '.github', 'workflows', 'ci.yml');
      const text = readFileSync(ci, 'utf8');
      const next = text.replace(
        'pnpm e2e --reporter=list --reporter=json',
        'pnpm e2e -- --reporter=list --reporter=json',
      );
      expect(next).not.toBe(text);
      writeFileSync(ci, next);
      const r = run(process.execPath, [join(scripts, 'ci-workflow-check.mjs'), dir]);
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toMatch(/e2e step must run exactly pnpm e2e --reporter=list --reporter=json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(AC-O27-3) (TC-4) --e2e-skipped on pull_request is rejected', () => {
    const r = run(process.execPath, [
      join(repo, 'tooling', 'ac-coverage.mjs'),
      '--branch', 'task/O-901',
      '--results', join(repo, 'tooling', 'fixtures', 'tasks', 'vitest-ok.json'),
      '--tasks-dir', join(repo, 'tooling', 'fixtures', 'tasks'),
      '--event', 'pull_request',
      '--e2e-skipped',
    ]);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/INPUT/);
  });
});

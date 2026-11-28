import { describe, it, expect } from 'vitest';
import { stepsOf, trustedScriptProblems } from './trusted-scripts.mjs';

const T = '${{ runner.temp }}/trusted';
const TOOLING_ENV = `        env:\n          TOOLING_DIR: ${T}/tooling\n`;

const TEMPLATE = `name: run-task
on:
  repository_dispatch:
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
          fetch-depth: 0
      - name: Snapshot trusted scripts
        run: |
          mkdir -p "$RUNNER_TEMP/trusted/.github"
          cp -R .github/scripts "$RUNNER_TEMP/trusted/.github/scripts"
          cp -R tooling "$RUNNER_TEMP/trusted/tooling"
      - name: Validate task id
        env:
          TASK: \${{ github.event.client_payload.task }}
        run: bash .github/scripts/run-task-validate-id.sh
      - name: Task lint
        run: node tooling/task-lint.mjs
      - name: Record branch head before Claude
        run: bash .github/scripts/run-task-pre-head.sh
      - name: Check out existing task branch
        run: |
          git switch task/x
      - name: Run Claude Code
        uses: anthropics/claude-code-action@v1
      - name: Detect Claude usage limit
${TOOLING_ENV}        run: bash "\${RUNNER_TEMP}/trusted/.github/scripts/run-task-usage-limit.sh" detect
      - name: Verify push triggered CI
        run: bash "$RUNNER_TEMP/trusted/.github/scripts/verify-push.sh"
      - name: Report lint and automatic verification summary
${TOOLING_ENV}        run: bash ${T}/.github/scripts/run-task-post-check.sh
      - name: Detect denied-command resplit and post run-task summary
        run: bash "$RUNNER_TEMP/trusted/.github/scripts/run-task-summary-step.sh"
      - name: Notify Grok chief of staff
        if: always()
        run: |
          bash "$RUNNER_TEMP/trusted/.github/scripts/run-task-outcome.sh"
          bash "$RUNNER_TEMP/trusted/.github/scripts/run-task-usage-limit.sh" fields
`;

function mutate(yml, from, to) {
  if (!yml.includes(from)) throw new Error(`mutation anchor not found: ${from}`);
  return yml.replace(from, to);
}
const has = (yml, needle) => trustedScriptProblems(yml).some((p) => p.includes(needle));
const SNAP_BLOCK = TEMPLATE.slice(
  TEMPLATE.indexOf('      - name: Snapshot trusted scripts'),
  TEMPLATE.indexOf('      - name: Validate task id'),
);

describe('trusted-scripts', () => {
  it('(AC-O33-1) (TC-1) a qualified template has no problems', () => {
    expect(stepsOf(TEMPLATE)?.length).toBe(12);
    expect(trustedScriptProblems(TEMPLATE)).toEqual([]);
  });

  it('(AC-O33-1) (TC-2) work-tree relative paths before the switch are allowed', () => {
    expect(TEMPLATE).toContain('node tooling/task-lint.mjs');
    expect(TEMPLATE).toContain('bash .github/scripts/run-task-pre-head.sh');
    expect(trustedScriptProblems(TEMPLATE)).toEqual([]);
  });

  it('(AC-O33-2) (TC-3) Snapshot missing, moved to step 3, or moved after the switch', () => {
    expect(has(mutate(TEMPLATE, SNAP_BLOCK, ''), 'is missing')).toBe(true);
    const validate = TEMPLATE.slice(TEMPLATE.indexOf('      - name: Validate task id'), TEMPLATE.indexOf('      - name: Task lint'));
    const third = mutate(mutate(TEMPLATE, SNAP_BLOCK, ''), validate, validate + SNAP_BLOCK);
    expect(has(third, 'must be step 2')).toBe(true);
    const sw = '      - name: Run Claude Code\n';
    const after = mutate(mutate(TEMPLATE, SNAP_BLOCK, ''), sw, SNAP_BLOCK + sw);
    expect(has(after, 'must be step 2')).toBe(true);
    expect(has(after, 'comes after the branch switch')).toBe(true);
  });

  it('(AC-O33-2) (TC-4) Snapshot content: one copy, wrong destination, if, continue-on-error, task id', () => {
    const cpTooling = '          cp -R tooling "$RUNNER_TEMP/trusted/tooling"\n';
    const cpScripts = '          cp -R .github/scripts "$RUNNER_TEMP/trusted/.github/scripts"\n';
    expect(has(mutate(TEMPLATE, cpTooling, ''), 'no recursive cp of tooling')).toBe(true);
    expect(has(mutate(TEMPLATE, cpScripts, ''), 'no recursive cp of .github/scripts')).toBe(true);
    expect(has(mutate(TEMPLATE, cpTooling, '          cp -R tooling /tmp/x\n'), 'somewhere other than the trusted root')).toBe(true);
    expect(has(mutate(TEMPLATE, cpScripts, '          cp tooling "$RUNNER_TEMP/trusted/x"\n' + cpScripts.replace('-R', '-p')), 'no recursive cp of .github/scripts')).toBe(true);
    expect(has(mutate(TEMPLATE, '      - name: Snapshot trusted scripts\n', '      - name: Snapshot trusted scripts\n        if: always()\n'), 'if or continue-on-error')).toBe(true);
    expect(has(mutate(TEMPLATE, '      - name: Snapshot trusted scripts\n', '      - name: Snapshot trusted scripts\n        continue-on-error: true\n'), 'if or continue-on-error')).toBe(true);
    expect(has(mutate(TEMPLATE, cpTooling, cpTooling + '          echo "${{ github.event.client_payload.task }}"\n'), 'task id')).toBe(true);
  });

  it('(AC-O33-2) (TC-5) the first checkout must not set ref or repository', () => {
    const anchor = '        with:\n          persist-credentials: false\n';
    expect(has(mutate(TEMPLATE, anchor, anchor + '          ref: task/T-035b\n'), 'ref or repository')).toBe(true);
    expect(has(mutate(TEMPLATE, anchor, anchor + '          repository: x/y\n'), 'ref or repository')).toBe(true);
    expect(has(mutate(TEMPLATE, '      - uses: actions/checkout@v4\n', '      - uses: actions/cache@v4\n'), 'step 1 is not actions/checkout')).toBe(true);
  });

  const GUARDS = [
    ['run-task-usage-limit.sh', 'bash "${RUNNER_TEMP}/trusted/.github/scripts/run-task-usage-limit.sh" detect', 'bash .github/scripts/run-task-usage-limit.sh detect', 'Detect Claude usage limit'],
    ['verify-push.sh', 'bash "$RUNNER_TEMP/trusted/.github/scripts/verify-push.sh"', 'bash .github/scripts/verify-push.sh', 'Verify push triggered CI'],
    ['run-task-post-check.sh', `bash ${T}/.github/scripts/run-task-post-check.sh`, 'bash .github/scripts/run-task-post-check.sh', 'Report lint and automatic verification summary'],
    ['run-task-summary-step.sh', 'bash "$RUNNER_TEMP/trusted/.github/scripts/run-task-summary-step.sh"', 'bash ./.github/scripts/run-task-summary-step.sh', 'Detect denied-command resplit'],
    ['run-task-outcome.sh', 'bash "$RUNNER_TEMP/trusted/.github/scripts/run-task-outcome.sh"', 'bash .github/scripts/run-task-outcome.sh', 'Notify Grok chief of staff'],
  ];
  for (const [script, from, to, stepName] of GUARDS) {
    it(`(AC-O33-3) (TC-6) ${script} via a relative path is reported with the step name`, () => {
      const probs = trustedScriptProblems(mutate(TEMPLATE, from, to));
      expect(probs.filter((p) => p.includes(stepName) && p.includes('references work-tree'))).toHaveLength(1);
    });
  }

  it('(AC-O33-3) (TC-7) node tooling/…, bash -c, and a local action are reported', () => {
    const run = '        uses: anthropics/claude-code-action@v1\n';
    expect(has(mutate(TEMPLATE, 'bash "$RUNNER_TEMP/trusted/.github/scripts/verify-push.sh"', 'node tooling/scope-check.mjs'), 'references work-tree')).toBe(true);
    expect(has(mutate(TEMPLATE, 'bash "$RUNNER_TEMP/trusted/.github/scripts/verify-push.sh"', "bash -c 'bash .github/scripts/verify-push.sh'"), 'references work-tree')).toBe(true);
    expect(has(mutate(TEMPLATE, run, '        uses: ./.github/actions/x\n'), 'local action')).toBe(true);
  });

  it('(AC-O33-3) (TC-8) comment-only paths, pre-switch paths and all three trusted-root spellings are fine', () => {
    const commented = mutate(TEMPLATE, '      - name: Verify push triggered CI\n', '      - name: Verify push triggered CI\n        # bash .github/scripts/verify-push.sh and tooling/x.mjs\n');
    expect(trustedScriptProblems(commented)).toEqual([]);
    const inRun = mutate(TEMPLATE, '        run: bash "$RUNNER_TEMP/trusted/.github/scripts/verify-push.sh"\n', '        run: |\n          # tooling/scope-check.mjs\n          bash "$RUNNER_TEMP/trusted/.github/scripts/verify-push.sh"\n');
    expect(trustedScriptProblems(inRun)).toEqual([]);
    const spellings = mutate(TEMPLATE, 'bash "$RUNNER_TEMP/trusted/.github/scripts/verify-push.sh"', 'node ${RUNNER_TEMP}/trusted/tooling/a.mjs; node $RUNNER_TEMP/trusted/tooling/b.mjs; node ${{ runner.temp }}/trusted/tooling/c.mjs');
    expect(trustedScriptProblems(spellings)).toEqual([]);
  });

  it('(AC-O33-4) (TC-9) TOOLING_DIR missing, relative, outside the trusted root, or in another step', () => {
    const line = `          TOOLING_DIR: ${T}/tooling\n`;
    expect(TEMPLATE).toContain(line);
    expect(has(mutate(TEMPLATE, line, '          FOO: 1\n'), 'without TOOLING_DIR')).toBe(true);
    expect(has(mutate(TEMPLATE, line, '          TOOLING_DIR: tooling\n'), 'other than')).toBe(true);
    expect(has(mutate(TEMPLATE, line, '          TOOLING_DIR: /tmp/tooling\n'), 'other than')).toBe(true);
    expect(has(mutate(TEMPLATE, line, `          TOOLING_DIR: ${T}/tooling-old\n`), 'other than')).toBe(true);
    const moved = mutate(mutate(TEMPLATE, line, '          FOO: 1\n'), '      - name: Verify push triggered CI\n', `      - name: Verify push triggered CI\n${TOOLING_ENV}`);
    expect(has(moved, 'without TOOLING_DIR')).toBe(true);
  });

  it('(AC-O33-4) (TC-10) usage-limit fields and Notify do not need TOOLING_DIR', () => {
    expect(TEMPLATE.slice(TEMPLATE.indexOf('Notify Grok'))).not.toContain('TOOLING_DIR');
    expect(trustedScriptProblems(TEMPLATE)).toEqual([]);
  });

  it('(AC-O33-5) (TC-11) no switch step is fail-closed', () => {
    const noSwitch = mutate(TEMPLATE, 'git switch task/x', 'echo hi');
    expect(has(noSwitch, 'no branch-switch step')).toBe(true);
  });

  it('(AC-O33-5) (TC-12) a renamed switch step is still the boundary', () => {
    const renamed = mutate(TEMPLATE, 'name: Check out existing task branch', 'name: Prepare');
    expect(trustedScriptProblems(renamed)).toEqual([]);
    const bad = mutate(renamed, 'bash "$RUNNER_TEMP/trusted/.github/scripts/verify-push.sh"', 'bash .github/scripts/verify-push.sh');
    expect(has(bad, 'references work-tree')).toBe(true);
    for (const cmd of ['git checkout x', 'git reset --hard x', 'git merge x', 'git rebase x', 'git pull', 'git restore .', 'git clean -fd', 'git -C . switch x']) {
      const v = mutate(bad, 'git switch task/x', cmd);
      expect(has(v, 'references work-tree'), cmd).toBe(true);
    }
    const viaAction = mutate(TEMPLATE, '        run: |\n          git switch task/x\n', '        uses: actions/checkout@v4\n');
    expect(trustedScriptProblems(viaAction)).toEqual([]);
  });

  it('(AC-O33-5) (TC-13) bad inputs always yield a non-empty array', () => {
    for (const bad of ['', '   ', 'name: x\njobs: {}\n', null, undefined, 42, {}, []]) {
      const r = trustedScriptProblems(bad);
      expect(Array.isArray(r) && r.length > 0, String(bad)).toBe(true);
    }
    expect(stepsOf('')).toBeNull();
    expect(stepsOf(null)).toBeNull();
    expect(stepsOf('jobs:\n  a:\n    steps:\n')).toBeNull();
  });

  it('(AC-O33-5) (TC-14) a non-Snapshot step writing into the trusted root is reported', () => {
    const cp = mutate(TEMPLATE, 'run: bash .github/scripts/run-task-pre-head.sh', 'run: cp x "$RUNNER_TEMP/trusted/tooling/y"');
    expect(has(cp, 'modifies the trusted root')).toBe(true);
    const rm = mutate(TEMPLATE, 'git switch task/x', 'rm -rf "${RUNNER_TEMP}/trusted"');
    expect(has(rm, 'modifies the trusted root')).toBe(true);
    for (const cmd of ['mv', 'ln -s', 'chmod -R u+w', 'rsync -a']) {
      expect(has(mutate(TEMPLATE, 'git switch task/x', `${cmd} a "$RUNNER_TEMP/trusted/b"`), 'modifies the trusted root'), cmd).toBe(true);
    }
  });

  it('(AC-O33-9) (TC-20) every function-level weakening is caught', () => {
    const cpTooling = '          cp -R tooling "$RUNNER_TEMP/trusted/tooling"\n';
    const cpScripts = '          cp -R .github/scripts "$RUNNER_TEMP/trusted/.github/scripts"\n';
    const snap = '      - name: Snapshot trusted scripts\n';
    const mutants = [
      mutate(TEMPLATE, SNAP_BLOCK, ''),
      mutate(TEMPLATE, snap, snap.replace('Snapshot trusted scripts', 'Snapshot')),
      mutate(TEMPLATE, snap, snap + '        if: always()\n'),
      mutate(TEMPLATE, snap, snap + '        continue-on-error: true\n'),
      mutate(TEMPLATE, cpTooling, ''),
      mutate(TEMPLATE, cpScripts, ''),
      mutate(TEMPLATE, cpTooling, '          cp tooling "$RUNNER_TEMP/trusted/tooling"\n'),
      mutate(TEMPLATE, cpTooling, '          cp -R tooling /tmp/tooling\n'),
      mutate(TEMPLATE, cpTooling, cpTooling + '          echo ${{ github.event.client_payload.task }}\n'),
      mutate(TEMPLATE, '          persist-credentials: false\n', '          persist-credentials: false\n          ref: main\n'),
      mutate(TEMPLATE, '          persist-credentials: false\n', '          persist-credentials: false\n          repository: a/b\n'),
      ...GUARDS.map(([, from, to]) => mutate(TEMPLATE, from, to)),
      mutate(TEMPLATE, 'uses: anthropics/claude-code-action@v1', 'uses: ./.github/actions/x'),
      mutate(TEMPLATE, `          TOOLING_DIR: ${T}/tooling\n`, ''),
      mutate(TEMPLATE, `          TOOLING_DIR: ${T}/tooling\n`, '          TOOLING_DIR: tooling\n'),
      mutate(TEMPLATE, 'git switch task/x', 'echo hi'),
      mutate(TEMPLATE, 'git switch task/x', 'rm -rf "$RUNNER_TEMP/trusted"'),
    ];
    for (const [i, m] of mutants.entries()) {
      expect(trustedScriptProblems(m).length, `mutant ${i}`).toBeGreaterThan(0);
    }
  });

  it('(AC-O33-10) (TC-21) the module has no swallowed failures and bad input never throws', () => {
    for (const bad of [Symbol('x'), () => 1, Object.create(null), 1n]) {
      expect(trustedScriptProblems(bad).length).toBeGreaterThan(0);
    }
  });
});

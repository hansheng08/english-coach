import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, tokenize } from './guard.mjs';

const INDEX = fileURLToPath(new URL('./index.mjs', import.meta.url));
const T = 'task/O-001';
const NONE = null; // 無意見

// [#, 目前分支（null＝detached HEAD）, 指令, 預期 'allow'|'deny'|null]
const TABLE = [
  [1, T, 'git push origin task/O-001', 'allow'],
  [2, T, 'git push -u origin task/O-001', 'allow'],
  [3, T, 'git push --set-upstream origin task/O-001', 'allow'],
  [4, 'fix/Q-001', 'git push -u origin fix/Q-001', 'allow'],
  [5, 'poc/A-001', 'git push -u origin poc/A-001', 'allow'],
  [6, T, 'git push origin task/T-001', 'deny'],
  [7, T, 'git push origin task/O-001:main', 'deny'],
  [8, T, 'git push origin task/O-001:refs/heads/main', 'deny'],
  [9, T, 'git push origin HEAD:main', 'deny'],
  [10, 'poc/A-001', 'git push origin poc/A-001:main', 'deny'],
  [11, T, 'git push origin :task/O-001', 'deny'],
  [12, T, 'git push origin --delete task/O-001', 'deny'],
  [13, T, 'git push -d origin task/O-001', 'deny'],
  [14, T, 'git push --force origin task/O-001', 'deny'],
  [15, T, 'git push -f origin task/O-001', 'deny'],
  [16, T, 'git push --force-with-lease origin task/O-001', 'deny'],
  [17, T, 'git push origin +task/O-001', 'deny'],
  [18, T, 'git push --mirror origin', 'deny'],
  [19, T, 'git push --all origin', 'deny'],
  [20, T, 'git push --tags origin', 'deny'],
  [21, T, 'git push origin v0.1.0', 'deny'],
  [22, T, 'git push origin main', 'deny'],
  [23, 'main', 'git push origin main', 'deny'],
  [24, T, 'git push', 'deny'],
  [25, T, 'git push origin', 'deny'],
  [26, T, 'git push origin HEAD', 'deny'],
  [27, T, 'git push upstream task/O-001', 'deny'],
  [28, T, 'git -C . push origin task/O-001', 'deny'],
  [29, T, 'git -c push.default=current push', 'deny'],
  [30, T, 'git push origin task/O-001 && git push origin main', 'deny'],
  [31, T, 'git status; git push origin task/O-001', 'deny'],
  [32, T, 'sh -c "git push origin main"', 'deny'],
  [33, T, 'GIT_TRACE=1 git push origin task/O-001', 'deny'],
  [34, T, 'git push origin task/O-001 2>&1', 'deny'],
  [35, T, "git push origin 'task/O-001'", 'deny'],
  [36, T, '/usr/bin/git push origin main', 'deny'],
  [37, null, 'git push origin task/O-001', 'deny'],
  [38, T, 'git merge origin/main', 'deny'],
  [39, T, 'git -C . merge task/T-001', 'deny'],
  [40, T, 'git pull', 'deny'],
  [41, T, 'git pull --ff-only', NONE],
  [42, 'main', 'git commit -m "x"', 'deny'],
  [43, T, 'git commit -m "push fix"', NONE],
  [44, T, 'gh pr create --fill', 'deny'],
  [45, T, 'gh pr merge 1 --squash', 'deny'],
  [46, T, 'gh api repos/o/r/pulls -X POST', 'deny'],
  [47, T, 'bash -c "gh pr create"', 'deny'],
  [48, T, 'gh run list', NONE],
  [49, T, 'gh pr checks 1', NONE],
  [50, T, 'git status', NONE],
  [51, T, 'echo push', NONE],
  [52, T, 'git switch -c task/O-001 origin/main --no-track', NONE],
];

for (const [n, branch, command, expected] of TABLE) {
  test(`#${n} [${branch ?? 'detached'}] ${command} → ${expected ?? 'no opinion'}`, () => {
    const r = evaluate({ command, getBranch: () => branch });
    assert.equal(r?.decision ?? null, expected);
    if (expected === 'deny') assert.match(r.reason, /^pushguard: .+/);
  });
}

// 額外：繞過嘗試
const EXTRA = [
  ['git push origin task/O-001;', 'deny'],
  ['git push origin task/O-001\ngit push origin main', 'deny'],
  ['env git push origin task/O-001', 'deny'],
  ['timeout 5 git push origin main', 'deny'],
  ['(git push origin main)', 'deny'],
  ['echo $(git push origin main)', 'deny'],
  ['echo `git push origin main`', 'deny'],
  ['git push origin "task/O-001', 'deny'], // 引號不成對
  ['git push origin task/O-001 ~', 'deny'],
  ['git push origin task/O-001.lock', 'deny'],
  ['git push origin task/../main', 'deny'],
  ['git --git-dir=x push origin task/O-001', 'deny'],
  ['git merge --abort', 'deny'],
  ['git push origin task/O-001 | cat', 'deny'],
  ['gh auth token', 'deny'],
  ['gh workflow run ci.yml', 'deny'],
  ['pwsh -Command "git push origin main"', 'deny'],
  ['git log --oneline | head', 'deny'],  // settings deny list: use Read, not head
];
for (const [command, expected] of EXTRA) {
  test(`extra: ${JSON.stringify(command)} → ${expected ?? 'no opinion'}`, () => {
    const r = evaluate({ command, getBranch: () => T });
    assert.equal(r?.decision ?? null, expected);
  });
}

test('branch lookup is lazy: not called for unrelated commands', () => {
  let calls = 0;
  evaluate({ command: 'git status', getBranch: () => (calls++, T) });
  assert.equal(calls, 0);
});

test('tokenize handles quotes and operators', () => {
  assert.deepEqual(tokenize('a "b c" \'d e\' f\\ g && h | i'), [['a', 'b c', 'd e', 'f g'], ['h'], ['i']]);
  assert.equal(tokenize('echo "x'), null);
});

// 對照表 53～55：經由 index.mjs（stdin → stdout／exit code）
function runHook(stdin) {
  return spawnSync(process.execPath, [INDEX], { input: stdin, encoding: 'utf8' });
}
test('#53 invalid JSON containing git and push → deny', () => {
  const r = runHook('not json: git push origin main');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
test('#54 invalid JSON without git/gh → no output, exit 0', () => {
  const r = runHook('not json at all');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
test('#55 tool_name Read → no output, exit 0', () => {
  const r = runHook(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' }, cwd: '.' }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
test('index: command not a string → deny; output is a single JSON object', () => {
  const r = runHook(JSON.stringify({ tool_name: 'Bash', tool_input: {}, cwd: '.' }));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('settings deny list: cat/grep/head/ls/sed are denied, including compounds', () => {
  for (const command of [
    'cat contracts/src/validation.ts',
    'grep -n export contracts/src/index.ts',
    'head -40 contracts/src/index.ts',
    'ls domain/src contracts/src',
    'sed -n 1,30p domain/src/srs.test.ts',
    'cd packages; cat contracts/src/validation.ts; grep -n export contracts/src/index.ts | head -40; ls domain/src; sed -n 1,30p domain/src/srs.test.ts',
  ]) {
    const r = evaluate({ command, getBranch: () => T });
    assert.equal(r?.decision, 'deny', command);
    assert.match(r.reason, /settings\.json deny list/);
    assert.match(r.reason, /charter v6 §13 rule #12/);
  }
});

test('git ls-files and Read-equivalent git commands stay unblocked by the file-tool deny', () => {
  const r = evaluate({ command: 'git ls-files packages/domain', getBranch: () => T });
  assert.equal(r?.decision ?? null, null);
});

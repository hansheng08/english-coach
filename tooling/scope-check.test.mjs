import { describe, it, expect } from 'vitest';
import { checkScope } from './scope-check.mjs';

const task = (id, branch, allow, deny = [], withDo = true) => ({
  id,
  path: `docs/tasks/${id}.md`,
  text: [
    `# ${id}：x`,
    '## 分支',
    `\`${branch}\``,
    '## 檔案範圍',
    ...(withDo ? ['### 要做', ...allow.map((a) => `- \`${a}\`（新增）`)] : []),
    '### 範圍外',
    ...deny.map((d) => `- \`${d}\``),
    '',
  ].join('\n'),
});
const check = (tasks, changed, branch = 'task/O-901') => checkScope({ branch, tasks, changed });
const rules = (fs) => fs.map((f) => f.rule);

describe('scope-check', () => {
  it('(AC-O8-5) (TC-18) files inside the allow list (including implicit report) pass', () => {
    const t = task('O-901', 'task/O-901', ['tooling/*.mjs']);
    const qa = [{ sha: 'a'.repeat(40), authorEmail: 'qa@example.com', committerEmail: 'qa@example.com', subject: '[QA] O-901 mutants', files: [{ status: 'M', paths: ['docs/qa/mutants/O-901.json'] }] }];
    const changed = ['tooling/a.mjs', 'docs/reports/O-901.md', 'docs/qa/mutants/O-901.json'];
    expect(checkScope({ branch: 'task/O-901', tasks: [t], changed, commits: qa })).toEqual([]);
  });

  it('(AC-O8-5) (TC-19) file outside the allow list -> SC-OUT; deny list wins -> SC-DENY', () => {
    const t = task('O-901', 'task/O-901', ['tooling/*.mjs', 'apps/**'], ['apps/secret/**']);
    expect(rules(check([t], ['tooling/a.mjs', 'x/y.ts']))).toEqual(['SC-OUT']);
    expect(rules(check([t], ['apps/secret/a.ts']))).toEqual(['SC-DENY']);
    expect(rules(check([t], ['apps/ok.ts']))).toEqual([]);
  });

  it('(AC-O8-5) (TC-20) glob: * does not cross /, ** does', () => {
    const star = task('O-901', 'task/O-901', ['tooling/*.mjs']);
    const globstar = task('O-901', 'task/O-901', ['tooling/**']);
    expect(rules(check([star], ['tooling/sub/a.mjs']))).toEqual(['SC-OUT']);
    expect(rules(check([globstar], ['tooling/sub/a.mjs']))).toEqual([]);
    expect(rules(check([task('O-901', 'task/O-901', ['a/**/b.ts'])], ['a/b.ts', 'a/x/y/b.ts']))).toEqual([]);
    expect(rules(check([task('O-901', 'task/O-901', ['a?.ts'])], ['ab.ts', 'a/.ts']))).toEqual(['SC-OUT']);
  });

  it('(AC-O8-5) (TC-21) empty list, missing task, parse failure, and fix-task union', () => {
    const t = task('O-901', 'task/O-901', ['tooling/*.mjs']);
    expect(rules(check([t], []))).toEqual(['SC-EMPTY']);
    expect(rules(check([t], ['', '  ']))).toEqual(['SC-EMPTY']);
    expect(rules(check([t], ['tooling/a.mjs'], 'task/NOPE'))).toEqual(['SC-NOTASK']);
    expect(rules(check([task('O-901', 'task/O-901', [], [], false)], ['tooling/a.mjs']))).toEqual(['SC-PARSE']);
    const fix = task('O-901-fix1', 'task/O-901', ['docs/extra.md']);
    expect(check([t, fix], ['tooling/a.mjs', 'docs/extra.md', 'docs/reports/O-901-fix1.md'])).toEqual([]);
    expect(rules(check([t], ['docs/extra.md']))).toEqual(['SC-OUT']);
  });
});

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { lintComments, run } from './comment-lint.mjs';

const FIX = fileURLToPath(new URL('./fixtures/o009', import.meta.url));
const c = (body, id = 1) => ({ id, body });
const rules = (body) => lintComments([c(body)]).map((f) => f.rule);

describe('comment-lint', () => {
  it('(AC-O9-6) (TC-19) TechLead Review openers -> CM-TECHLEAD', () => {
    for (const body of ['TechLead Review：核准（head abc）', '**TechLead Review**', '## techlead review', '> `TECHLEADREVIEW`', '【TechLead Review】']) {
      expect(rules(body), body).toEqual(['CM-TECHLEAD']);
    }
    const f = lintComments([c('TechLead Review', 'abc')])[0];
    expect([f.file, f.line]).toEqual(['comment/abc', 1]);
  });

  it('(AC-O9-6) (TC-20) QA comments that re-run commands locally -> CM-QA-RERUN', () => {
    expect(rules('QA 通過\n本機重跑 pnpm check')).toEqual(['CM-QA-RERUN']);
    expect(rules('**QA 退件**\nbox 上 pg_prove')).toEqual(['CM-QA-RERUN']);
    expect(rules('QA: ran locally supabase test db')).toEqual(['CM-QA-RERUN']);
    expect(rules('QA\nre-run pnpm db:test')).toEqual(['CM-QA-RERUN']);
  });

  it('(AC-O9-6) (TC-21) CI-only QA comments, run-task summaries, verify summaries and lookalikes are not flagged', () => {
    expect(rules('QA 通過\n引用 CI run 的 pnpm check')).toEqual([]);
    expect(rules('## 自動驗證摘要（O-902 @ abc1234）\n- 本機 pnpm check')).toEqual([]);
    expect(rules('QAT 測試\n本機重跑 pnpm check')).toEqual([]);
    expect(rules('QA 通過\n本機看過\npnpm check 在 CI 綠')).toEqual([]);
    expect(rules('')).toEqual([]);
    expect(lintComments([c(null)])).toEqual([]);
    const empty = run(['--comments', `${FIX}/comments-ok.json`]);
    expect([empty.code, empty.stdout]).toEqual([0, 'comment-lint: OK 3 comment(s)\n']);
  });

  it('(AC-O9-6) (TC-21) an empty array is OK 0 comment(s); bad comments fail through the CLI', () => {
    expect(lintComments([])).toEqual([]);
    const bad = run(['--comments', `${FIX}/comments-bad.json`]);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toBe('');
    expect(bad.stderr).toMatch(/comment-lint: FAIL comment\/11:1: CM-TECHLEAD: /);
    expect(bad.stderr).toMatch(/comment\/12:1: CM-QA-RERUN/);
    expect(bad.stderr.trim().split('\n').at(-1)).toBe('comment-lint: 2 error(s)');
  });

  it('(AC-O9-6) (TC-22) known limitations are pinned', () => {
    expect(rules('看過了\nTechLead Review：核准')).toEqual([]);
    expect(rules('QA 通過\n不在本機重跑 pnpm check')).toEqual(['CM-QA-RERUN']);
  });

  it('(AC-O9-6) (AC-O9-8) malformed input -> INPUT', () => {
    for (const bad of [{}, 'x', [1], [{ body: 'x' }], [{ id: 1 }], [{ id: 1, body: 5 }], [{ id: {}, body: 'x' }]]) {
      expect(lintComments(bad).map((f) => f.rule), JSON.stringify(bad)).toEqual(['INPUT']);
    }
  });
});

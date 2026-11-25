import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintPrBody, workflowsChanged } from './pr-body-lint.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures', 'o016');
const cli = join(here, 'pr-body-lint.mjs');
const exec = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

const PLACEHOLDER = '（改到 .github/workflows/** 時必填：預估每月增減的分鐘數與算法，或「無影響：理由」）';
const WF = ['.github/workflows/ci.yml', 'docs/a.md'];
const section = (content) => `## 摘要\n改 CI\n\n## Actions 分鐘數影響\n${content}\n\n## 風險\n低\n`;
const lint = (body) => lintPrBody(body, WF);

describe('lintPrBody', () => {
  it('(AC-O16-5) (TC-16) 沒改 workflow → 任何 body 都 ok', () => {
    expect(workflowsChanged(['.github/scripts/x.sh', 'docs/a.md'])).toBe(false);
    expect(workflowsChanged(WF)).toBe(true);
    for (const body of ['', null, '## Actions 分鐘數影響\n-']) {
      expect(lintPrBody(body, ['.github/scripts/x.sh', 'docs/a.md'])).toMatchObject({ ok: true, rule: null });
    }
  });

  it('(AC-O16-5) (TC-17) 缺節或 body 為 null → PB-MISSING', () => {
    expect(lint('## 摘要\n改 CI\n').rule).toBe('PB-MISSING');
    expect(lint(null).rule).toBe('PB-MISSING');
    expect(lintPrBody('x', 'not-an-array').rule).toBe('INPUT');
  });

  it('(AC-O16-5) (TC-18) 佔位與空 → PB-PLACEHOLDER／PB-EMPTY', () => {
    expect(lint(section(PLACEHOLDER)).rule).toBe('PB-PLACEHOLDER');
    expect(lint(section('-')).rule).toBe('PB-EMPTY');
    expect(lint(section('無')).rule).toBe('PB-EMPTY');
    expect(lint(section('<!-- 請填寫 -->')).rule).toBe('PB-EMPTY');
  });

  it('(AC-O16-5) (TC-19) 沒有數字的敘述 → PB-VAGUE', () => {
    const r = lint(section('會變少'));
    expect(r.ok).toBe(false);
    expect(r.rule).toBe('PB-VAGUE');
  });

  it('(AC-O16-5) (TC-20) 已填 → ok', () => {
    for (const c of ['-120 分鐘／月：算法…', '約 600 分鐘', '無影響：只改註解', `${PLACEHOLDER}\n-120 分鐘／月`]) {
      expect(lint(section(c)), c).toMatchObject({ ok: true, rule: null });
    }
    expect(lint(section('無影響：')).rule).toBe('PB-VAGUE');
  });
});

describe('pr-body-lint CLI', () => {
  it('(AC-O16-6) (TC-21) 讀不到 body → INPUT；缺 --changed → USAGE；正常 → exit 0＋OK', () => {
    const changed = join(fx, 'changed-workflow.txt');
    const missing = exec(['--body', join(fx, 'nope.md'), '--changed', changed]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('pr-body-lint: FAIL INPUT');
    const noChanged = exec(['--body', join(fx, 'pr-filled.md')]);
    expect(noChanged.status).toBe(1);
    expect(noChanged.stderr).toContain('pr-body-lint: FAIL USAGE');
    const dup = exec(['--body', join(fx, 'pr-filled.md'), '--body', join(fx, 'pr-filled.md'), '--changed', changed]);
    expect(dup.stderr).toContain('FAIL USAGE');
    const good = exec(['--body', join(fx, 'pr-filled.md'), '--changed', changed]);
    expect(good.status).toBe(0);
    expect(good.stdout).toContain('pr-body-lint: OK');
    const placeholder = exec(['--body', join(fx, 'pr-placeholder.md'), '--changed', changed]);
    expect(placeholder.status).toBe(1);
    expect(placeholder.stderr).toContain('pr-body-lint: FAIL PB-PLACEHOLDER');
    const docsOnly = exec(['--body', join(fx, 'pr-placeholder.md'), '--changed', join(fx, 'changed-docs.txt')]);
    expect(docsOnly.status).toBe(0);
  });
});

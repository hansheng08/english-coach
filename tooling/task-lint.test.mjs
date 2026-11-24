import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lintTask } from './task-lint.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const BASE = read('./fixtures/tasks/O-901.md').split('\n').slice(0, -1);

const lint = (lines, id = 'O-901') => lintTask({ id, path: `${id}.md`, text: `${lines.join('\n')}\n` });
const rulesOf = (fs) => fs.map((f) => f.rule);
const idx = (lines, prefix) => lines.findIndex((l) => l.startsWith(prefix));
const insertAfter = (lines, prefix, extra) => {
  const out = [...lines];
  out.splice(idx(out, prefix) + 1, 0, ...extra);
  return out;
};
const dropSection = (lines, heading) => {
  const s = idx(lines, heading);
  let e = lines.findIndex((l, i) => i > s && l.startsWith('## '));
  if (e < 0) e = lines.length;
  return [...lines.slice(0, s), ...lines.slice(e)];
};
const block = (n, lang = 'text') => [`\`\`\`${lang}`, ...Array.from({ length: n }, (_, i) => `row ${String(i)}`), '```'];
const withBlocks = (...blocks) => insertAfter(BASE, '## 介面', blocks.flat());
const padTo = (lines, n) => insertAfter(lines, '## 背景', Array.from({ length: n - lines.length }, () => 'pad'));

describe('task-lint', () => {
  it('(AC-O8-1) (TC-1) minimal valid task passes with no findings', () => {
    expect(lint(BASE)).toEqual([]);
  });

  it('(AC-O8-1) (TC-2) docs/tasks/O-008.md lints clean (self check)', () => {
    const text = read('../docs/tasks/O-008.md');
    expect(lintTask({ id: 'O-008', path: 'docs/tasks/O-008.md', text })).toEqual([]);
  });

  it('(AC-O8-2) (TC-3) title id differing from file name -> TL-TITLE on line 1', () => {
    const fs = lint(['# T-002：x', ...BASE.slice(1)], 'T-001');
    expect(fs.filter((f) => f.rule === 'TL-TITLE').map((f) => f.line)).toEqual([1]);
    expect(rulesOf(lint(['## no title', ...BASE.slice(1)]))).toContain('TL-TITLE');
  });

  it('(AC-O8-2) (TC-4) missing rules header or missing rule 7 -> TL-RULES', () => {
    expect(rulesOf(lint(BASE.filter((l) => !l.startsWith('> ## ⚠️'))))).toContain('TL-RULES');
    expect(rulesOf(lint(BASE.filter((l) => !l.startsWith('> 7.'))))).toContain('TL-RULES');
    expect(rulesOf(lint(BASE.map((l) => (l.startsWith('> 12.') ? '> 11. dup' : l))))).toContain('TL-RULES');
  });

  it('(AC-O8-2) (TC-5) missing ## 介面 -> TL-SECTION', () => {
    const fs = lint(dropSection(BASE, '## 介面'));
    expect(fs.filter((f) => f.rule === 'TL-SECTION')).toHaveLength(1);
  });

  it('(AC-O8-2) (TC-6) banned headings -> TL-HEADING with the heading line', () => {
    for (const title of ['## 本單特別規則', '### AC 對突變表']) {
      const lines = insertAfter(BASE, '## 背景', [title]);
      const hit = lint(lines).filter((f) => f.rule === 'TL-HEADING');
      expect(hit.map((f) => f.line)).toEqual([idx(lines, title) + 1]);
    }
  });

  it('(AC-O8-3) (TC-7) unclosed fence -> TL-FENCE at the opener', () => {
    const lines = insertAfter(BASE, '## 介面', ['```ts', 'type A = 1;']);
    const hit = lint(lines).filter((f) => f.rule === 'TL-FENCE');
    expect(hit.map((f) => f.line)).toEqual([idx(lines, '```ts') + 1]);
  });

  it('(AC-O8-3) (TC-8) single block: 15 lines pass, 16 lines fail TL-BLOCK-SIZE', () => {
    expect(lint(withBlocks(block(15)))).toEqual([]);
    expect(rulesOf(lint(withBlocks(block(16))))).toEqual(['TL-BLOCK-SIZE']);
  });

  it('(AC-O8-3) (TC-9) block total: 40 lines pass, 41 lines fail TL-BLOCK-TOTAL', () => {
    expect(lint(withBlocks(block(14), block(13), block(13)))).toEqual([]);
    expect(rulesOf(lint(withBlocks(block(14), block(14), block(13))))).toEqual(['TL-BLOCK-TOTAL']);
  });

  it('(AC-O8-3) (TC-10) SQL fences (any case) -> TL-SQL', () => {
    for (const lang of ['SQL', 'plpgsql', 'pgsql', 'psql']) {
      expect(rulesOf(lint(withBlocks(['```' + lang, 'select 1;', '```'])))).toEqual(['TL-SQL']);
    }
  });

  it('(AC-O8-3) (TC-11) implementation code in any fence -> TL-CODE', () => {
    for (const body of ['return x;', 'expect(a).toBe(b);', 'const f = () => {', 'INSERT INTO t values (1);']) {
      expect(rulesOf(lint(withBlocks(['```', body, '```'])))).toEqual(['TL-CODE']);
    }
  });

  it('(AC-O8-3) (TC-12) signatures are not mistaken for code', () => {
    expect(lint(withBlocks(['```ts', 'submit(x: A): B;', 'type R = { ok: true };', '```']))).toEqual([]);
  });

  it('(AC-O8-3) (TC-13) whole file: 250 lines pass, 251 lines fail TL-LINES', () => {
    expect(lint(padTo(BASE, 250))).toEqual([]);
    expect(rulesOf(lint(padTo(BASE, 251)))).toEqual(['TL-LINES']);
  });

  it('(AC-O8-4) (TC-14) banned phrases outside blocks -> TL-PHRASE', () => {
    for (const parts of [['照', '抄'], ['逐字', '寫出'], ['逐位', '元組'], ['逐字', '照貼'], ['自核', '數字']]) {
      const lines = insertAfter(BASE, '## 背景', [`請${parts.join('')}`]);
      expect(rulesOf(lint(lines))).toEqual(['TL-PHRASE']);
    }
  });

  it('(AC-O8-4) (TC-15) AC and TC table defects -> TL-AC or TL-TC', () => {
    const noAc = BASE.map((l) => (l.startsWith('- **AC-') ? '- 沒有編號' : l));
    expect(rulesOf(lint(noAc))).toContain('TL-AC');
    const dupTc = BASE.map((l) => (l.startsWith('| TC-2 ') ? l.replace('TC-2', 'TC-1') : l));
    expect(rulesOf(lint(dupTc))).toContain('TL-TC');
    const undefinedAc = BASE.map((l) => (l.startsWith('| TC-2 ') ? l.replace('AC-O901-2', 'AC-O901-9') : l));
    expect(rulesOf(lint(undefinedAc))).toContain('TL-TC');
    const acWithoutTc = insertAfter(BASE, '- **AC-O901-2**', ['- **AC-O901-3** 沒有測試']);
    expect(rulesOf(lint(acWithoutTc))).toEqual(['TL-TC']);
    const badHeader = BASE.map((l) => (l.startsWith('| TC | ') ? l.replace('對應 AC', '對應') : l));
    expect(rulesOf(lint(badHeader))).toContain('TL-TC');
    const dupAc = insertAfter(BASE, '- **AC-O901-2**', ['- **AC-O901-2** 重複']);
    expect(rulesOf(lint(dupAc))).toContain('TL-AC');
    const otherPrefix = insertAfter(BASE, '- **AC-O901-2**', ['- 說明 AC-T5-1']);
    expect(rulesOf(lint(otherPrefix))).toContain('TL-AC');
  });

  it('(AC-O8-4) (TC-16) several defects are all listed with the right count', () => {
    const lines = dropSection(withBlocks(['```sql', 'select 1;', '```']), '## 限制');
    const fs = lint(lines);
    expect(rulesOf(fs).sort()).toEqual(['TL-SECTION', 'TL-SQL']);
  });

  it('(AC-O8-4) (TC-17) file scope without ### 要做 -> TL-SCOPE', () => {
    const noDo = BASE.filter((l) => !l.startsWith('### 要做') && !l.startsWith('- `tooling/*.mjs`'));
    expect(rulesOf(lint(noDo))).toEqual(['TL-SCOPE']);
    const noItems = BASE.filter((l) => !l.startsWith('- `tooling/*.mjs`'));
    expect(rulesOf(lint(noItems))).toEqual(['TL-SCOPE']);
  });
});

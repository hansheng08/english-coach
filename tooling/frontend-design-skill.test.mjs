import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SKILL_SNIPPETS } from '../.github/scripts/claude-permission-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, '.claude', 'skills', 'frontend-design');
const read = (p) => readFileSync(p, 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const SKILL_SHA = 'd91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3';
const LICENSE_SHA = '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594';
const COMMIT = 'e4bb5d960d87126ff3b3a8af1a104b7db67560ba';

describe('frontend-design skill', () => {
  it('(AC-O24-1) (TC-1) upstream files match pinned sha256, frontmatter and Apache-2.0', () => {
    expect(existsSync(join(dir, 'SKILL.md')), 'SKILL.md missing').toBe(true);
    expect(existsSync(join(dir, 'LICENSE.txt')), 'LICENSE.txt missing').toBe(true);
    expect(sha(join(dir, 'SKILL.md'))).toBe(SKILL_SHA);
    expect(sha(join(dir, 'LICENSE.txt'))).toBe(LICENSE_SHA);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(join(dir, 'SKILL.md')));
    expect(fm).not.toBeNull();
    expect(fm[1]).toMatch(/^name:\s*frontend-design\s*$/m);
    expect(fm[1]).toMatch(/^license:.*LICENSE\.txt/m);
    expect(read(join(dir, 'LICENSE.txt'))).toContain('Apache License');
  });

  it('(AC-O24-2) (TC-2) PROJECT.md has precedence and constraints', () => {
    const md = read(join(dir, 'PROJECT.md'));
    for (const s of ['DESIGN.md', 'tokens.json', '§9.1', 'ADR-014', '系統字', 'Q-35', 'prefers-reduced-motion', 'system', 'light', 'dark', '§15.4', '以後者為準']) {
      expect(md, s).toContain(s);
    }
  });

  it('(AC-O24-3) (TC-3) run-task loads the skill and keeps required snippets', () => {
    const md = read(join(root, '.claude', 'skills', 'run-task', 'SKILL.md'));
    expect(md).toContain('.claude/skills/frontend-design/SKILL.md');
    expect(md).toContain('.claude/skills/frontend-design/PROJECT.md');
    expect(md).toContain('以 DESIGN.md 為準');
    for (const s of REQUIRED_SKILL_SNIPPETS) expect(md, s).toContain(s);
  });

  it('(AC-O24-4) (TC-4) new files contain no secret-looking strings', () => {
    const files = ['PROJECT.md', 'SOURCE.md'].map((f) => join(dir, f));
    for (const f of files) {
      expect(read(f)).not.toMatch(/(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY)/);
    }
  });

  it('(AC-O24-5) (TC-5) SOURCE.md records provenance', () => {
    const md = read(join(dir, 'SOURCE.md'));
    for (const s of ['https://github.com/anthropics/skills', 'skills/frontend-design/', COMMIT, 'Apache', SKILL_SHA, LICENSE_SHA]) {
      expect(md, s).toContain(s);
    }
    expect(sha(join(dir, 'SKILL.md'))).toBe(SKILL_SHA);
  });

  it('(AC-O24-6) (TC-6) test names carry AC and TC ids', () => {
    const src = read(join(root, 'tooling', 'frontend-design-skill.test.mjs'));
    for (let i = 1; i <= 6; i++) expect(src).toMatch(new RegExp(`\\(AC-O24-${i}\\) \\(TC-${i}\\)`));
  });
});

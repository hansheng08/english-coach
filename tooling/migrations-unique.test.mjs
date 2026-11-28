// T-032-fix3: static checks on supabase/migrations file names (no network, no clock, no Supabase).
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(repo, 'supabase', 'migrations');
const NEW_NAME = '20261128100001_t032_card_review_date_record_review.sql';
const OLD_NAME = '20261128100000_t032_card_review_date_record_review.sql';

const sqlFiles = () => readdirSync(dir).filter((f) => f.endsWith('.sql'));

describe('supabase/migrations file names (static)', () => {
  it('(AC-T32-20) (TC-32) the T-032 migration uses the new name and the old name is gone', () => {
    expect(existsSync(join(dir, NEW_NAME))).toBe(true);
    expect(existsSync(join(dir, OLD_NAME))).toBe(false);
  });

  it('(AC-T32-21) (TC-33) migration timestamps (first 14 digits) are unique', () => {
    const files = sqlFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    const seen = new Map();
    const dups = [];
    for (const f of files) {
      const ts = f.slice(0, 14);
      const prev = seen.get(ts);
      if (prev !== undefined) dups.push(`${prev} <-> ${f}`);
      else seen.set(ts, f);
    }
    expect(dups, `duplicate migration timestamps: ${dups.join('; ')}`).toEqual([]);
  });

  it('(AC-T32-21) (TC-34) every migration file name matches 14 digits + underscore + lowercase name', () => {
    const bad = sqlFiles().filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
    expect(bad).toEqual([]);
  });

  it('(AC-T32-22) (TC-35) references point at the new migration name only', () => {
    const schemaTest = readFileSync(join(repo, 'tooling', 'db-schema-t032.test.ts'), 'utf8');
    const report = readFileSync(join(repo, 'docs', 'reports', 'T-032.md'), 'utf8');
    expect(schemaTest).toContain(NEW_NAME);
    expect(schemaTest).not.toContain(OLD_NAME);
    expect(report).not.toContain(OLD_NAME);
  });
});

// QA probes for T-050: shape of supabase/tests/t004_rls_test.sql and supabase/tests/t050_seed_chunk_test.sql (read with ?raw).
import { describe, expect, it } from 'vitest';
import t004 from '../supabase/tests/t004_rls_test.sql?raw';
import t050 from '../supabase/tests/t050_seed_chunk_test.sql?raw';

describe('QA T-050 t004 and t050 pgTAP text', () => {
  it('(QA-20) t004 still has 47 assertions, one plan(47), 99 newlines and no circle back or touch base', () => {
    const lines = t004.split('\n');
    expect(lines.length - 1).toBe(99);
    expect(lines.filter((l) => l.startsWith('select ') && /'\(AC-T4-\d+\)/.test(l))).toHaveLength(47);
    expect(t004.split('select plan(47);')).toHaveLength(2);
    expect(t004).not.toMatch(/circle back|touch base/);
  });

  it('(QA-21) the t050 pgTAP plan equals its assertion count and every description carries the AC and TC tags', () => {
    const asserts = t050.split('\n').filter((l) => /^select (is|ok)\(/.test(l));
    expect(asserts).toHaveLength(5);
    expect(t050).toContain('select plan(5);');
    for (const l of asserts) expect(l).toContain("'(AC-T50-10) (TC-15) ");
  });
  it('(QA-25) the five lines AC-T50-11 allows to change are exactly the expected text at lines 14, 15, 74, 77 and 78', () => {
    const lines = t004.split('\n');
    const idOne = 'e0000000-0000-4000-8000-000000000051';
    const idTwo = 'e0000000-0000-4000-8000-000000000052';
    const user = 'a0000000-0000-4000-8000-000000000001';
    expect(lines[13]).toBe(`  ('${idOne}', 't004 fixture one', '測試資料一', 'This is t004 fixture one.', '{meeting}', 1),`);
    expect(lines[14]).toBe(`  ('${idTwo}', 't004 fixture two', '測試資料二', 'This is t004 fixture two.', '{meeting}', 1);`);
    expect(lines[73]).toBe(`select results_eq($$select count(*)::int from public.seed_chunk where id in ('${idOne}', '${idTwo}')$$, array[2], '(AC-T4-5) authenticated can read seed_chunk');`);
    expect(lines[76]).toBe(`select lives_ok($$insert into public.card (user_id, chunk, source_type, seed_chunk_id) values ('${user}', 't004 fixture one', 'seed', '${idOne}')$$, '(AC-T4-5) a seed card can point to an unused seed');`);
    expect(lines[77]).toBe(`select throws_ok($$insert into public.card (user_id, chunk, source_type, seed_chunk_id) values ('${user}', 't004 fixture one', 'seed', '${idOne}')$$, '23505', null, '(AC-T4-5) the same seed_chunk_id cannot back two cards');`);
  });
});

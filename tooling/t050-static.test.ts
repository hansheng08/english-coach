import { describe, expect, it } from 'vitest';
import t004 from '../supabase/tests/t004_rls_test.sql?raw';

const ID_ONE = 'e0000000-0000-4000-8000-000000000051';
const ID_TWO = 'e0000000-0000-4000-8000-000000000052';

describe('T-050 t004 pgTAP compatibility', () => {
  it('(AC-T50-11) (TC-16) t004 fixtures no longer collide with seed data and the file keeps its shape', () => {
    expect(t004).not.toContain('circle back');
    expect(t004).not.toContain('touch base');
    const lines = t004.split('\n');
    const rowOne = lines.find((l) => l.includes(`'${ID_ONE}', 't004 fixture`)) ?? '';
    const rowTwo = lines.find((l) => l.includes(`'${ID_TWO}', 't004 fixture`)) ?? '';
    expect(rowOne).toContain("'t004 fixture one', '測試資料一', 'This is t004 fixture one.'");
    expect(rowTwo).toContain("'t004 fixture two', '測試資料二', 'This is t004 fixture two.'");
    const cardInserts = lines.filter((l) => l.includes('insert into public.card') && l.includes(`'${ID_ONE}'`));
    expect(cardInserts).toHaveLength(2);
    for (const line of cardInserts) expect(line).toContain("'t004 fixture one', 'seed'");
    const count = lines.find((l) => l.includes('(AC-T4-5) authenticated can read seed_chunk')) ?? '';
    expect(count).toContain(ID_ONE);
    expect(count).toContain(ID_TWO);
    expect(count).toContain('array[2]');
    expect(t004.split('\n')).toHaveLength(100);
    expect(t004.split('select plan(47);')).toHaveLength(2);
  });
});

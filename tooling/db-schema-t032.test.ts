import { describe, expect, it } from 'vitest';
import migration from '../supabase/migrations/20261128100000_t032_card_review_date_record_review.sql?raw';

const SIGNATURE = /public\.record_card_review\(([^)]*)\)/;
const typeList = (line: string | undefined): string => SIGNATURE.exec(line ?? '')?.[1]?.replace(/\s+/g, ' ').trim() ?? '';

describe('T-032 migration (static text)', () => {
  it('(AC-T32-9) (TC-14) review_date is added, backfilled in Taipei time, made not null and unique per card', () => {
    expect(migration).toMatch(/alter table public\.card_review add column review_date date;/);
    expect(migration).toMatch(/set review_date = \(reviewed_at at time zone 'Asia\/Taipei'\)::date/);
    expect(migration).toMatch(/alter column review_date set not null/);
    expect(migration).toMatch(/constraint card_review_card_id_review_date_key unique \(card_id, review_date\)/);
  });

  it('(AC-T32-9) (TC-14) record_card_review has the documented parameter types, security invoker, empty search_path and returns card', () => {
    const create = /create function public\.record_card_review\(([\s\S]*?)\) returns public\.card/.exec(migration);
    expect(create).not.toBeNull();
    const types = (create?.[1] ?? '')
      .split(',')
      .map((p) => p.trim().split(/\s+/)[1])
      .join(', ');
    expect(types).toBe('uuid, date, text, text, text, integer, smallint, date, text, integer, smallint, date, integer');
    expect(migration).toMatch(/returns public\.card\s+language plpgsql\s+security invoker\s+set search_path = ''/);
  });

  it('(AC-T32-9) (TC-14) revoke from public, anon and grant to authenticated use the same type list', () => {
    const revoke = migration.split('\n').find((l) => l.startsWith('revoke all on function public.record_card_review('));
    const grant = migration.split('\n').find((l) => l.startsWith('grant execute on function public.record_card_review('));
    expect(revoke).toMatch(/ from public, anon;$/);
    expect(grant).toMatch(/ to authenticated;$/);
    expect(typeList(revoke)).not.toBe('');
    expect(typeList(revoke)).toBe(typeList(grant));
  });
});

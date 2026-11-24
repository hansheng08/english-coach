// T-004: static checks on migration 1 and its pgTAP file. The CI db job runs them for real
// (`supabase db reset` + `supabase test db`, AC-T4-8); these tests let run-task catch mistakes without Docker.
import { describe, expect, it } from 'vitest';
import migration from '../supabase/migrations/20261124140000_t004_profile_card_review_seed_chunk.sql?raw';
import pgtap from '../supabase/tests/t004_rls_test.sql?raw';

const TABLES = ['profile', 'seed_chunk', 'card', 'card_review'] as const;

const migrationLines: string[] = migration.split('\n').map((l) => l.trim());

/** Trimmed lines between `create table public.<name> (` and the closing `);`. */
function tableLines(name: string): string[] {
  const start = migrationLines.indexOf(`create table public.${name} (`);
  if (start < 0) return [];
  const end = migrationLines.indexOf(');', start);
  return end < 0 ? [] : migrationLines.slice(start + 1, end);
}

const linesStartingWith = (prefix: string): string[] => migrationLines.filter((l) => l.startsWith(prefix));

const ASSERTION = /^select (col_type_is|col_is_null|col_is_unique|col_default_is|fk_ok|is|table_privs_are|throws_ok|results_eq|is_empty|lives_ok)\(/;

describe('migration 1 schema (T-004)', () => {
  it('(AC-T4-1) profile columns match ARCHITECTURE §4', () => {
    expect(tableLines('profile')).toEqual([
      'user_id uuid primary key references auth.users (id) on delete cascade,',
      "timezone text not null default 'Asia/Taipei' constraint profile_timezone_check check (timezone = 'Asia/Taipei'),",
      "slot_start jsonb not null default '{}'::jsonb constraint profile_slot_start_check check (jsonb_typeof(slot_start) = 'object'),",
      "settings jsonb not null default '{}'::jsonb constraint profile_settings_check check (jsonb_typeof(settings) = 'object'),",
      'created_at timestamptz not null default now()',
    ]);
  });

  it('(AC-T4-1) card columns match ARCHITECTURE §4, §4.4 and ADR-011', () => {
    const card = tableLines('card');
    expect({
      userId: card.includes('user_id uuid not null references auth.users (id) on delete cascade,'),
      dueDateNullable: card.includes('due_date date,'),
      correctCount: card.includes('correct_count integer not null default 0,'),
      intervalStep: card.includes(
        'interval_step smallint not null default 0 constraint card_interval_step_check check (interval_step between 0 and 4),',
      ),
      seedChunkUnique: card.includes(
        'seed_chunk_id uuid constraint card_seed_chunk_id_key unique references public.seed_chunk (id) on delete restrict,',
      ),
      ownerKey: card.includes('constraint card_id_user_id_key unique (id, user_id),'),
    }).toEqual({
      userId: true,
      dueDateNullable: true,
      correctCount: true,
      intervalStep: true,
      seedChunkUnique: true,
      ownerKey: true,
    });
  });

  it('(AC-T4-1) every table exists exactly once', () => {
    expect(TABLES.map((t) => linesStartingWith(`create table public.${t} (`).length)).toEqual([1, 1, 1, 1]);
  });
});

describe('migration 1 RLS and privileges (T-004)', () => {
  it('(AC-T4-2) RLS is enabled on every table and nothing is security definer', () => {
    expect({
      rls: TABLES.map((t) => migrationLines.filter((l) => l === `alter table public.${t} enable row level security;`).length),
      securityDefiner: migration.toLowerCase().includes('security definer'),
      forceRls: migration.toLowerCase().includes('force row level security'),
    }).toEqual({ rls: [1, 1, 1, 1], securityDefiner: false, forceRls: false });
  });

  it('(AC-T4-2) grants and revokes are exactly the T-004 matrix', () => {
    expect([...linesStartingWith('grant '), ...linesStartingWith('revoke ')].sort()).toEqual(
      [
        'grant select, insert, update on table public.profile to authenticated;',
        'grant select on table public.seed_chunk to authenticated;',
        'grant select, insert, update on table public.card to authenticated;',
        'grant select, insert on table public.card_review to authenticated;',
        'grant all on table public.profile, public.seed_chunk, public.card, public.card_review to service_role;',
        'revoke all on function public.card_correct_count_guard() from public, anon, authenticated;',
        'revoke all on table public.profile, public.seed_chunk, public.card, public.card_review from anon;',
        'revoke all on table public.profile, public.seed_chunk, public.card, public.card_review from authenticated;',
      ].sort(),
    );
  });

  it('(AC-T4-3) policies are owner-only for user tables and read-only for seed_chunk', () => {
    const own = 'user_id = (select auth.uid())';
    expect(linesStartingWith('create policy ')).toEqual([
      `create policy profile_select_own on public.profile for select to authenticated using (${own});`,
      `create policy profile_insert_own on public.profile for insert to authenticated with check (${own});`,
      `create policy profile_update_own on public.profile for update to authenticated using (${own}) with check (${own});`,
      'create policy seed_chunk_select_authenticated on public.seed_chunk for select to authenticated using (true);',
      `create policy card_select_own on public.card for select to authenticated using (${own});`,
      `create policy card_insert_own on public.card for insert to authenticated with check (${own});`,
      `create policy card_update_own on public.card for update to authenticated using (${own}) with check (${own});`,
      `create policy card_review_select_own on public.card_review for select to authenticated using (${own});`,
      `create policy card_review_insert_own on public.card_review for insert to authenticated with check (${own});`,
    ]);
  });
});

describe('migration 1 card rules (T-004)', () => {
  it('(AC-T4-4) card_schedule_check mirrors CardScheduleSchema (ARCHITECTURE §4.3)', () => {
    const card = tableLines('card');
    const start = card.indexOf('constraint card_schedule_check check (');
    expect(card.slice(start, start + 6)).toEqual([
      'constraint card_schedule_check check (',
      "(state = 'collected' and correct_count = 0 and interval_step = 0)",
      "or (state = 'learning' and correct_count >= 1 and interval_step = 0 and due_date is not null)",
      "or (state = 'reviewing' and correct_count >= 2 and interval_step between 1 and 4 and due_date is not null)",
      "or (state = 'mastered' and correct_count >= 2 and interval_step between 1 and 4 and due_date is null)",
      ')',
    ]);
  });

  it('(AC-T4-4) correct_count can never decrease', () => {
    expect({
      condition: migrationLines.includes('if new.correct_count < old.correct_count then'),
      trigger: migrationLines.includes(
        'create trigger card_correct_count_guard before update of correct_count on public.card',
      ),
    }).toEqual({ condition: true, trigger: true });
  });

  it('(AC-T4-5) seed_chunk batch is 1..6 and seed cards point to a seed', () => {
    expect({
      batch: tableLines('seed_chunk').includes(
        'batch smallint not null constraint seed_chunk_batch_check check (batch between 1 and 6),',
      ),
      seedSource: tableLines('card').includes(
        "constraint card_seed_source_check check ((source_type = 'seed') = (seed_chunk_id is not null)),",
      ),
    }).toEqual({ batch: true, seedSource: true });
  });

  it('(AC-T4-6) card_review belongs to the owner of its card and keeps interval_days_applied', () => {
    const review = tableLines('card_review');
    expect({
      ownerFk: review.includes(
        'constraint card_review_card_owner_fkey foreign key (card_id, user_id) references public.card (id, user_id) on delete cascade',
      ),
      interval: review.includes(
        'interval_days_applied integer not null constraint card_review_interval_days_applied_check check (interval_days_applied between 1 and 365),',
      ),
    }).toEqual({ ownerFk: true, interval: true });
  });

  it('(AC-T4-7) SRS / news defaults are not written into SQL (CLAUDE.md §5 #11)', () => {
    expect({
      srsOrNewsKeys: ['step_days', 'after_last_days', 'forgot_days', 'rotation_order', 'anchor_date'].filter((k) =>
        migration.includes(k),
      ),
      settingsDefault: tableLines('profile').includes(
        "settings jsonb not null default '{}'::jsonb constraint profile_settings_check check (jsonb_typeof(settings) = 'object'),",
      ),
    }).toEqual({ srsOrNewsKeys: [], settingsDefault: true });
  });
});

describe('pgTAP file structure (T-004)', () => {
  const lines = pgtap.split('\n');
  const assertions = lines.filter((l) => ASSERTION.test(l));

  it('(AC-T4-8) plan(N) equals the number of assertions and the file is one rolled-back transaction', () => {
    const plan = /^select plan\((\d+)\);$/m.exec(pgtap);
    expect({
      begin: lines.filter((l) => l === 'begin;').length,
      plan: plan === null ? -1 : Number(plan[1]),
      ending: pgtap.endsWith('select * from finish();\nrollback;\n'),
    }).toEqual({ begin: 1, plan: assertions.length, ending: true });
  });

  it('(AC-T4-8) every assertion names its AC and AC-T4-1..7 are all covered', () => {
    const acs = assertions.map((l) => /'\((AC-T4-\d)\) /.exec(l)?.[1] ?? 'missing');
    expect({
      missing: acs.filter((a) => a === 'missing').length,
      covered: [...new Set(acs)].sort(),
      roles: ['anon', 'authenticated', 'service_role'].map((r) => lines.filter((l) => l === `set local role ${r};`).length),
      resets: lines.filter((l) => l === 'reset role;').length,
    }).toEqual({
      missing: 0,
      covered: ['AC-T4-1', 'AC-T4-2', 'AC-T4-3', 'AC-T4-4', 'AC-T4-5', 'AC-T4-6', 'AC-T4-7'],
      roles: [1, 1, 1],
      resets: 3,
    });
  });
});

// T-006: static checks on migration 3 and its pgTAP file. The CI db job runs them for real
// (`supabase db reset` + `supabase test db`, AC-T6-13); these tests let run-task catch mistakes without Docker.
// B-023: AC-T6-11 checks that every security object in the migration also has a real-database pgTAP assertion.
import { describe, expect, it } from 'vitest';
import migration from '../supabase/migrations/20261124160000_t006_attempts_answers_checkins_metrics.sql?raw';
import t004pgtap from '../supabase/tests/t004_rls_test.sql?raw';
import pgtap from '../supabase/tests/t006_rls_test.sql?raw';

const TABLES = ['shadow_attempt', 'evening_answer', 'slot_checkin', 'provider_call'] as const;
const TABLE_LIST = TABLES.map((t) => `public.${t}`).join(', ');
const FUNCTIONS = ['card_mastered_guard', 'profile_paid_consent_guard', 'set_paid_consent', 'evening_answer_question_guard'] as const;

const migrationLines: string[] = migration.split('\n').map((l) => l.trim());
const pgtapLines: string[] = pgtap.split('\n');

/** Trimmed lines between `create table public.<name> (` and the closing `);`. */
function tableLines(name: string): string[] {
  const start = migrationLines.indexOf(`create table public.${name} (`);
  if (start < 0) return [];
  const end = migrationLines.indexOf(');', start);
  return end < 0 ? [] : migrationLines.slice(start + 1, end);
}

/** Trimmed lines from `first` up to and including the first line equal to `last` (or ending with `;` when last is ';'). */
function blockLines(first: string, last: string): string[] {
  const start = migrationLines.indexOf(first);
  if (start < 0) return [];
  const end = migrationLines.findIndex((l, i) => i >= start && (last === ';' ? l.endsWith(';') : l === last));
  return end < 0 ? [] : migrationLines.slice(start, end + 1);
}

const linesStartingWith = (prefix: string): string[] => migrationLines.filter((l) => l.startsWith(prefix));

const ASSERTION =
  /^select (columns_are|col_type_is|fk_ok|col_is_unique|col_default_is|results_eq|table_privs_are|is|throws_ok|is_empty|lives_ok|trigger_is|function_returns)\(/;

describe('migration 3 schema (T-006)', () => {
  it('(AC-T6-1) shadow_attempt, slot_checkin and provider_call columns match ARCHITECTURE §4 / §4.8.3', () => {
    expect({ shadowAttempt: tableLines('shadow_attempt'), slotCheckin: tableLines('slot_checkin'), providerCall: tableLines('provider_call') }).toEqual({
      shadowAttempt: [
        'id uuid primary key default gen_random_uuid(),',
        'user_id uuid not null references auth.users (id) on delete cascade,',
        'plan_date date not null,',
        'item_index smallint not null constraint shadow_attempt_item_index_check check (item_index between 0 and 4),',
        "audio_path text constraint shadow_attempt_audio_path_check check (starts_with(audio_path, user_id::text || '/')),",
        "audio_expires_at timestamptz not null default (now() + interval '90 days'),",
        'recognized_text text not null,',
        'accuracy numeric not null constraint shadow_attempt_accuracy_check check (accuracy between 0 and 1),',
        'speed_ratio numeric not null constraint shadow_attempt_speed_ratio_check check (speed_ratio >= 0),',
        'pron_score numeric constraint shadow_attempt_pron_score_check check (pron_score between 0 and 100),',
        'stt_provider text not null,',
        'pron_provider text,',
        'passed boolean not null,',
        'created_at timestamptz not null default now(),',
        "constraint shadow_attempt_audio_expires_at_check check (audio_expires_at = created_at + interval '90 days'),",
        'constraint shadow_attempt_plan_fkey foreign key (user_id, plan_date) references public.daily_plan (user_id, plan_date) on delete cascade',
      ],
      slotCheckin: [
        'id uuid primary key default gen_random_uuid(),',
        'user_id uuid not null references auth.users (id) on delete cascade,',
        'plan_date date not null,',
        "slot text not null constraint slot_checkin_slot_check check (slot in ('morning', 'noon', 'evening')),",
        "step text not null constraint slot_checkin_step_check check (step ~ '^[a-z][a-z_]{0,31}$'),",
        "status text not null constraint slot_checkin_status_check check (status in ('opened', 'completed', 'skipped')),",
        'recorded_at timestamptz not null default now(),',
        "constraint slot_checkin_open_step_check check ((status = 'opened') = (step = 'slot')),",
        'constraint slot_checkin_event_key unique (user_id, plan_date, slot, step, status)',
      ],
      providerCall: [
        'id uuid primary key default gen_random_uuid(),',
        'user_id uuid not null references auth.users (id) on delete cascade,',
        "capability text not null constraint provider_call_capability_check check (capability in ('llm', 'stt', 'pronunciation', 'tts')),",
        "provider text not null constraint provider_call_provider_check check (provider ~ '^[a-z][a-z0-9-]{0,31}$'),",
        'model text,',
        "tier text not null constraint provider_call_tier_check check (tier in ('free', 'paid')),",
        "status text not null constraint provider_call_status_check check (status in ('ok', 'error')),",
        "error_kind text constraint provider_call_error_kind_check check (error_kind ~ '^[a-z][a-z_]{0,31}$'),",
        'latency_ms integer not null constraint provider_call_latency_ms_check check (latency_ms >= 0),',
        'created_at timestamptz not null default now(),',
        "constraint provider_call_error_status_check check ((status = 'error') = (error_kind is not null))",
      ],
    });
  });

  it('(AC-T6-1) evening_answer columns and constraints match ARCHITECTURE §4 / §4.8.2', () => {
    expect(tableLines('evening_answer')).toEqual([
      'id uuid primary key default gen_random_uuid(),',
      'user_id uuid not null references auth.users (id) on delete cascade,',
      'question_id uuid not null references public.question (id) on delete restrict,',
      "kind text not null constraint evening_answer_kind_check check (kind in ('first', 'no_script')),",
      "status text not null default 'uploaded' constraint evening_answer_status_check check (status in ('uploaded', 'transcribed', 'diagnosed', 'failed')),",
      "failure jsonb constraint evening_answer_failure_check check (jsonb_typeof(failure) = 'object'),",
      "audio_path text constraint evening_answer_audio_path_check check (starts_with(audio_path, user_id::text || '/')),",
      "audio_expires_at timestamptz not null default (now() + interval '90 days'),",
      'transcript text,',
      "word_timings jsonb constraint evening_answer_word_timings_check check (jsonb_typeof(word_timings) = 'array'),",
      'pause_count integer constraint evening_answer_pause_count_check check (pause_count >= 0),',
      'filler_count integer constraint evening_answer_filler_count_check check (filler_count >= 0),',
      'wpm numeric constraint evening_answer_wpm_check check (wpm >= 0),',
      "diagnosis jsonb constraint evening_answer_diagnosis_check check (jsonb_typeof(diagnosis) = 'object'),",
      'rewrite_text text,',
      "upgrade_chunks jsonb constraint evening_answer_upgrade_chunks_check check (jsonb_typeof(upgrade_chunks) = 'array'),",
      "chunk_hits jsonb constraint evening_answer_chunk_hits_check check (jsonb_typeof(chunk_hits) = 'array'),",
      'speech_duration_ms integer constraint evening_answer_speech_duration_ms_check check (speech_duration_ms >= 0),',
      'chunk_target_count smallint constraint evening_answer_chunk_target_count_check check (chunk_target_count >= 0),',
      'chunk_full_hit_count smallint constraint evening_answer_chunk_full_hit_count_check check (chunk_full_hit_count >= 0),',
      'llm_model text,',
      'stt_provider text,',
      'created_at timestamptz not null default now(),',
      "constraint evening_answer_failure_status_check check ((status = 'failed') = (failure is not null)),",
      "constraint evening_answer_transcript_status_check check (status not in ('transcribed', 'diagnosed') or transcript is not null),",
      'constraint evening_answer_speech_duration_status_check',
      "check (status not in ('transcribed', 'diagnosed') or speech_duration_ms is not null),",
      'constraint evening_answer_chunk_counts_check',
      'check ((chunk_target_count is null) = (chunk_full_hit_count is null)',
      'and (chunk_full_hit_count is null or chunk_full_hit_count <= chunk_target_count)),',
      "constraint evening_answer_audio_expires_at_check check (audio_expires_at = created_at + interval '90 days')",
    ]);
  });

  it('(AC-T6-1) every new table exists exactly once and provider_call stores no content', () => {
    expect({
      counts: TABLES.map((t) => linesStartingWith(`create table public.${t} (`).length),
      contentColumns: tableLines('provider_call').filter((l) => /^(prompt|request|response|input|output|content|body|text|transcript)\b/.test(l)),
    }).toEqual({ counts: [1, 1, 1, 1], contentColumns: [] });
  });
});

describe('migration 3 RLS and privileges (T-006)', () => {
  it('(AC-T6-2) RLS is enabled on every new table; no SQL line is security definer; set_paid_consent is the one security invoker', () => {
    expect({
      rls: TABLES.map((t) => migrationLines.filter((l) => l === `alter table public.${t} enable row level security;`).length),
      securityDefiner: migrationLines.filter((l) => !l.startsWith('--') && l.toLowerCase().includes('security definer')).length,
      securityInvoker: migrationLines.filter((l) => l === 'security invoker').length,
      forceRls: migration.toLowerCase().includes('force row level security'),
    }).toEqual({ rls: [1, 1, 1, 1], securityDefiner: 0, securityInvoker: 1, forceRls: false });
  });

  it('(AC-T6-2) grants and revokes are exactly the T-006 matrix', () => {
    expect([...linesStartingWith('grant '), ...linesStartingWith('revoke ')].sort()).toEqual([
      'grant all on table public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call to service_role;',
      'grant execute on function public.set_paid_consent(uuid, boolean, integer) to service_role;',
      'grant insert (user_id, capability, provider, model, tier, status, error_kind, latency_ms) on table public.provider_call to authenticated;',
      'grant insert (user_id, plan_date, item_index, audio_path, recognized_text, accuracy, speed_ratio, pron_score, stt_provider, pron_provider, passed) on table public.shadow_attempt to authenticated;',
      'grant insert (user_id, plan_date, slot, step, status) on table public.slot_checkin to authenticated;',
      'grant insert (user_id, question_id, kind, status, failure, audio_path, transcript, word_timings, pause_count, filler_count, wpm, speech_duration_ms, stt_provider) on table public.evening_answer to authenticated;',
      'grant select on table public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call to authenticated;',
      'grant select on table public.weekly_metric to authenticated, service_role;',
      'grant update (status, failure, transcript, word_timings, pause_count, filler_count, wpm, diagnosis, rewrite_text, upgrade_chunks, chunk_hits, speech_duration_ms, chunk_target_count, chunk_full_hit_count, llm_model, stt_provider) on table public.evening_answer to authenticated;',
      'revoke all on function public.card_mastered_guard() from public, anon, authenticated;',
      'revoke all on function public.evening_answer_question_guard() from public, anon, authenticated;',
      'revoke all on function public.profile_paid_consent_guard() from public, anon, authenticated;',
      'revoke all on function public.set_paid_consent(uuid, boolean, integer) from public, anon, authenticated;',
      'revoke all on table public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call from anon;',
      'revoke all on table public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call from authenticated;',
      'revoke all on table public.weekly_metric from anon, authenticated, service_role;',
    ]);
  });

  it('(AC-T6-3) policies are owner-only; evening_answer update has using and with check; no update/delete policies elsewhere', () => {
    expect(linesStartingWith('create policy ')).toEqual([
      'create policy shadow_attempt_select_own on public.shadow_attempt for select to authenticated using (user_id = (select auth.uid()));',
      'create policy shadow_attempt_insert_own on public.shadow_attempt for insert to authenticated with check (user_id = (select auth.uid()));',
      'create policy evening_answer_select_own on public.evening_answer for select to authenticated using (user_id = (select auth.uid()));',
      'create policy evening_answer_insert_own on public.evening_answer for insert to authenticated with check (user_id = (select auth.uid()));',
      'create policy evening_answer_update_own on public.evening_answer for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));',
      'create policy slot_checkin_select_own on public.slot_checkin for select to authenticated using (user_id = (select auth.uid()));',
      'create policy slot_checkin_insert_own on public.slot_checkin for insert to authenticated with check (user_id = (select auth.uid()));',
      'create policy provider_call_select_own on public.provider_call for select to authenticated using (user_id = (select auth.uid()));',
      'create policy provider_call_insert_own on public.provider_call for insert to authenticated with check (user_id = (select auth.uid()));',
    ]);
  });
});

describe('migration 3 triggers and functions (T-006)', () => {
  it('(AC-T6-4) card_mastered_guard follows ARCHITECTURE §4.8.1 and the T-004 test no longer inserts a mastered card', () => {
    expect({
      column: migrationLines.includes('alter table public.card add column mastered_at timestamptz;'),
      check: migrationLines.includes("alter table public.card add constraint card_mastered_at_check check ((state = 'mastered') = (mastered_at is not null));"),
      fn: blockLines('create function public.card_mastered_guard() returns trigger', '$$;'),
      t004: {
        oldAllowed: t004pgtap.includes("'(AC-T4-4) mastered card with null due_date is allowed'"),
        newRejected: t004pgtap.includes("'23514', 'card must not be inserted as mastered', '(AC-T4-4) a card cannot be inserted as mastered"),
      },
    }).toEqual({
      column: true,
      check: true,
      fn: [
        'create function public.card_mastered_guard() returns trigger',
        'language plpgsql',
        "set search_path = ''",
        'as $$',
        'begin',
        "if tg_op = 'INSERT' then",
        "if new.state = 'mastered' then",
        "raise exception 'card must not be inserted as mastered' using errcode = 'check_violation';",
        'end if;',
        'new.mastered_at := null;',
        'return new;',
        'end if;',
        "if old.state = 'mastered' then",
        "if new.state <> 'mastered' or new.mastered_at is distinct from old.mastered_at then",
        "raise exception 'mastered card is terminal' using errcode = 'check_violation';",
        'end if;',
        "elsif new.state = 'mastered' then",
        "if old.state <> 'reviewing' then",
        "raise exception 'only reviewing cards can become mastered' using errcode = 'check_violation';",
        'end if;',
        'new.mastered_at := now();',
        'else',
        'new.mastered_at := null;',
        'end if;',
        'return new;',
        'end;',
        '$$;',
      ],
      t004: { oldAllowed: false, newRejected: true },
    });
  });

  it('(AC-T6-5) profile_paid_consent_guard checks current_user and is not security definer (ARCHITECTURE §4.9)', () => {
    expect(blockLines('create function public.profile_paid_consent_guard() returns trigger', '$$;')).toEqual([
      'create function public.profile_paid_consent_guard() returns trigger',
      'language plpgsql',
      "set search_path = ''",
      'as $$',
      'begin',
      "if current_user in ('service_role', 'postgres') then",
      'return new;',
      'end if;',
      "if (new.settings -> 'paid_consent_at') is distinct from (case when tg_op = 'UPDATE' then old.settings -> 'paid_consent_at' end)",
      "or (new.settings -> 'monthly_paid_cap_ntd') is distinct from (case when tg_op = 'UPDATE' then old.settings -> 'monthly_paid_cap_ntd' end) then",
      "raise exception 'paid consent can only be changed by POST /settings' using errcode = 'insufficient_privilege';",
      'end if;',
      'return new;',
      'end;',
      '$$;',
    ]);
  });

  it('(AC-T6-6) set_paid_consent is a security invoker SQL function executable by service_role only', () => {
    expect(blockLines('create function public.set_paid_consent(p_user_id uuid, p_granted boolean, p_monthly_cap_ntd integer)', '$$;')).toEqual([
      'create function public.set_paid_consent(p_user_id uuid, p_granted boolean, p_monthly_cap_ntd integer)',
      'returns jsonb',
      'language sql',
      'security invoker',
      "set search_path = ''",
      'as $$',
      'update public.profile',
      'set settings = case when p_granted',
      "then settings || jsonb_build_object('paid_consent_at', to_jsonb(now()), 'monthly_paid_cap_ntd', p_monthly_cap_ntd)",
      "else settings - 'paid_consent_at' - 'monthly_paid_cap_ntd' end",
      'where user_id = p_user_id',
      'returning settings;',
      '$$;',
    ]);
  });

  it('(AC-T6-7) evening_answer_question_guard allows bank or own questions only; triggers are wired as specified', () => {
    expect({
      fn: blockLines('create function public.evening_answer_question_guard() returns trigger', '$$;'),
      triggers: linesStartingWith('create trigger '),
    }).toEqual({
      fn: [
        'create function public.evening_answer_question_guard() returns trigger',
        'language plpgsql',
        "set search_path = ''",
        'as $$',
        'begin',
        'if not exists (',
        'select 1 from public.question q',
        'where q.id = new.question_id and (q.user_id is null or q.user_id = new.user_id)',
        ') then',
        "raise exception 'evening_answer.question_id must be a bank question or the owner''s question' using errcode = 'foreign_key_violation';",
        'end if;',
        'return new;',
        'end;',
        '$$;',
      ],
      triggers: [
        'create trigger card_mastered_guard before insert or update on public.card',
        'create trigger profile_paid_consent_guard before insert or update of settings on public.profile',
        'create trigger evening_answer_question_guard before insert or update of question_id, user_id on public.evening_answer',
      ],
    });
  });
});

describe('migration 3 weekly_metric (T-006)', () => {
  it('(AC-T6-10) weekly_metric is security_invoker and computes Taipei weeks per ARCHITECTURE §4.8.4', () => {
    expect(blockLines('create view public.weekly_metric with (security_invoker = true) as', ';')).toEqual([
      'create view public.weekly_metric with (security_invoker = true) as',
      'with weeks as (',
      'select p.user_id, w::date as week_start',
      'from public.profile p',
      'cross join lateral generate_series(',
      "date_trunc('week', p.created_at at time zone 'Asia/Taipei'),",
      "date_trunc('week', now() at time zone 'Asia/Taipei'),",
      "interval '7 days'",
      ') as w',
      '),',
      'mastered as (',
      "select c.user_id, date_trunc('week', c.mastered_at at time zone 'Asia/Taipei')::date as week_start, count(*) as mastered_new",
      'from public.card c',
      'where c.mastered_at is not null',
      'group by 1, 2',
      '),',
      'first_answer as (',
      "select e.user_id, date_trunc('week', e.created_at at time zone 'Asia/Taipei')::date as week_start,",
      'count(*) as answer_count,',
      'sum(e.pause_count + e.filler_count) as pause_filler_sum,',
      'sum(e.speech_duration_ms) as speech_duration_ms_sum,',
      'sum(e.wpm * e.speech_duration_ms) as wpm_duration_sum',
      'from public.evening_answer e',
      "where e.kind = 'first' and e.pause_count is not null and e.filler_count is not null and e.wpm is not null",
      'and e.speech_duration_ms is not null and e.speech_duration_ms > 0',
      'group by 1, 2',
      '),',
      'no_script as (',
      "select e.user_id, date_trunc('week', e.created_at at time zone 'Asia/Taipei')::date as week_start,",
      'coalesce(sum(e.chunk_target_count), 0) as chunk_targets,',
      'coalesce(sum(e.chunk_full_hit_count), 0) as chunk_spoken',
      'from public.evening_answer e',
      "where e.kind = 'no_script'",
      'group by 1, 2',
      ')',
      'select',
      'w.user_id,',
      'w.week_start,',
      'coalesce(m.mastered_new, 0)::integer as mastered_new,',
      '(select count(*) from public.card c',
      "where c.user_id = w.user_id and c.mastered_at < ((w.week_start + 7)::timestamp at time zone 'Asia/Taipei'))::integer as mastered_cumulative,",
      'coalesce(f.answer_count, 0)::integer as first_answer_count,',
      'f.pause_filler_sum::numeric / (f.speech_duration_ms_sum::numeric / 60000) as pause_filler_per_minute,',
      'f.pause_filler_sum::numeric / f.answer_count as pause_filler_count_avg,',
      'f.wpm_duration_sum / f.speech_duration_ms_sum as wpm_avg,',
      'coalesce(n.chunk_targets, 0)::integer as no_script_chunk_targets,',
      'coalesce(n.chunk_spoken, 0)::integer as no_script_chunk_spoken,',
      'n.chunk_spoken::numeric / nullif(n.chunk_targets, 0) as no_script_chunk_spoken_rate',
      'from weeks w',
      'left join mastered m on m.user_id = w.user_id and m.week_start = w.week_start',
      'left join first_answer f on f.user_id = w.user_id and f.week_start = w.week_start',
      'left join no_script n on n.user_id = w.user_id and n.week_start = w.week_start;',
    ]);
  });
});

describe('pgTAP coverage of security properties (T-006, B-023)', () => {
  it('(AC-T6-11) every function, table, policy and the view has a real-database pgTAP assertion', () => {
    const has = (s: string): boolean => pgtap.includes(s);
    const policyNames = linesStartingWith('create policy ').map((l) => l.split(' ')[2] ?? '');
    expect({
      functionsInMigration: linesStartingWith('create function public.').map((l) => /^create function public\.(\w+)\(/.exec(l)?.[1] ?? ''),
      definer: FUNCTIONS.filter((f) => !has(`select prosecdef, proconfig collate "default" from pg_proc where oid = 'public.${f}(`)),
      execute: FUNCTIONS.filter((f) => !has(`has_function_privilege('anon', 'public.${f}(`) || !has(`has_function_privilege('authenticated', 'public.${f}(`)),
      anonPrivs: TABLES.filter((t) => !has(`table_privs_are('public', '${t}', 'anon', array[]::text[]`)),
      authPrivs: TABLES.filter((t) => !has(`table_privs_are('public', '${t}', 'authenticated', array['SELECT']`)),
      policyCatalog: TABLES.filter((t) => !has(`from pg_policies where schemaname = 'public' and tablename = '${t}' order by policyname`)),
      policiesAsserted: policyNames.filter((p) => !has(`('${p}', `)),
      view: [has("select is((select reloptions from pg_class where oid = 'public.weekly_metric'::regclass), array['security_invoker=true']"), has("table_privs_are('public', 'weekly_metric', 'anon', array[]::text[]")],
      formatChecks: linesStartingWith('').filter((l) => / constraint \w+_check check \((starts_with\(|\w+ ~ )/.test(` ${l}`)).map((l) => /constraint (\w+_check)/.exec(l)?.[1] ?? '').filter((c) => !has(`violates check constraint "${c}"'`)),
    }).toEqual({
      functionsInMigration: [...FUNCTIONS],
      definer: [],
      execute: [],
      anonPrivs: [],
      authPrivs: [],
      policyCatalog: [],
      policiesAsserted: [],
      view: [true, true],
      formatChecks: [],
    });
  });
});

describe('pgTAP file structure (T-006)', () => {
  const assertions = pgtapLines.filter((l) => ASSERTION.test(l));

  it('(AC-T6-13) plan(N) equals the number of assertions and the file is one rolled-back transaction', () => {
    const plan = /^select plan\((\d+)\);$/m.exec(pgtap);
    expect({
      begin: pgtapLines.filter((l) => l === 'begin;').length,
      plan: plan === null ? -1 : Number(plan[1]),
      ending: pgtap.endsWith('select * from finish();\nrollback;\n'),
    }).toEqual({ begin: 1, plan: assertions.length, ending: true });
  });

  it('(AC-T6-13) every assertion names its AC and AC-T6-1..10 are all covered', () => {
    const acs = assertions.map((l) => /'\((AC-T6-\d+)\) /.exec(l)?.[1] ?? 'missing');
    expect({
      missing: acs.filter((a) => a === 'missing').length,
      covered: [...new Set(acs)].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))),
      table: TABLE_LIST,
    }).toEqual({
      missing: 0,
      covered: ['AC-T6-1', 'AC-T6-2', 'AC-T6-3', 'AC-T6-4', 'AC-T6-5', 'AC-T6-6', 'AC-T6-7', 'AC-T6-8', 'AC-T6-9', 'AC-T6-10'],
      table: 'public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call',
    });
  });
});

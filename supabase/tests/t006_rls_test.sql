-- T-006 pgTAP: schema, grants, RLS, triggers, set_paid_consent() and weekly_metric on the real database.
-- Run by the CI db job (`supabase test db`, which enables pgtap in schema extensions); each file is one transaction.
-- B-023: every security property (definer/invoker, revoke/grant, RLS using + with check, view security_invoker, format checks) is asserted here, not only in Vitest.
begin;
select plan(134);

-- Fixtures (inserted by the migration owner `postgres`; RLS does not apply to the table owner).
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 't006-user-a@example.com'),
  ('b0000000-0000-4000-8000-000000000002', 't006-user-b@example.com'),
  ('c0000000-0000-4000-8000-000000000003', 't006-user-c@example.com');
insert into public.profile (user_id, settings, created_at) values
  ('a0000000-0000-4000-8000-000000000001', '{"srs":{"forgot_days":2}}', '2026-11-01 10:00:00+00'),
  ('b0000000-0000-4000-8000-000000000002', '{}', '2026-11-01 10:00:00+00');
insert into public.daily_plan (user_id, plan_date, planned_category) values
  ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'ai'),
  ('b0000000-0000-4000-8000-000000000002', '2026-11-21', 'ai');
insert into public.resume (user_id, storage_path, redacted_text) values
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002/resume.pdf', 'redacted resume B');
insert into public.question (id, user_id, resume_id, source, category, text, cited_experience) values
  ('e0000000-0000-4000-8000-000000000061', null, null, 'bank', 'behavioral', 'Tell me about a conflict at work.', null),
  ('b0000000-0000-4000-8000-000000000062', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'resume', 'intro', 'Walk me through project X.', 'Project X');
insert into public.card (id, user_id, chunk, source_type, state, correct_count, interval_step, due_date) values
  ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001', 'move the needle', 'manual', 'reviewing', 2, 1, '2026-12-01'),
  ('a0000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-000000000001', 'push back on sth', 'manual', 'learning', 1, 0, '2026-12-01'),
  ('a0000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-000000000001', 'get buy-in', 'news', 'reviewing', 3, 2, '2026-12-01');
-- Historical mastered cards: the trigger would stamp now(), so it is disabled only for these fixture rows (rolled back).
alter table public.card disable trigger card_mastered_guard;
insert into public.card (id, user_id, chunk, source_type, state, correct_count, interval_step, due_date, mastered_at) values
  ('a0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-000000000001', 'circle back', 'manual', 'mastered', 2, 4, null, '2026-10-27 02:00:00+00'),
  ('a0000000-0000-4000-8000-0000000000d2', 'a0000000-0000-4000-8000-000000000001', 'touch base', 'manual', 'mastered', 2, 4, null, '2026-11-15 15:59:59+00'),
  ('a0000000-0000-4000-8000-0000000000d3', 'a0000000-0000-4000-8000-000000000001', 'loop in', 'manual', 'mastered', 2, 4, null, '2026-11-15 16:00:00+00'),
  ('a0000000-0000-4000-8000-0000000000d4', 'a0000000-0000-4000-8000-000000000001', 'drill down', 'manual', 'mastered', 2, 4, null, '2026-11-18 03:00:00+00'),
  ('b0000000-0000-4000-8000-0000000000d5', 'b0000000-0000-4000-8000-000000000002', 'ramp up', 'manual', 'mastered', 2, 4, null, '2026-11-17 00:00:00+00');
alter table public.card enable trigger card_mastered_guard;
insert into public.evening_answer (user_id, question_id, kind, status, transcript, pause_count, filler_count, wpm, speech_duration_ms, chunk_target_count, chunk_full_hit_count, created_at, audio_expires_at)
select v.user_id, 'e0000000-0000-4000-8000-000000000061', v.kind, v.status, v.transcript, v.pause_count, v.filler_count, v.wpm, v.speech_duration_ms, v.chunk_target_count, v.chunk_full_hit_count, v.created_at, v.created_at + interval '90 days'
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'first', 'transcribed', 'a1', 3, 2, 100::numeric, 60000, null::smallint, null::smallint, '2026-11-10 01:00:00+00'::timestamptz),
  ('a0000000-0000-4000-8000-000000000001', 'first', 'transcribed', 'a2', 1, 0, 130, 30000, null, null, '2026-11-15 15:59:59+00'),
  ('a0000000-0000-4000-8000-000000000001', 'first', 'transcribed', 'a3', 0, 0, 0, 0, null, null, '2026-11-11 01:00:00+00'),
  ('a0000000-0000-4000-8000-000000000001', 'first', 'uploaded', null, null, null, null, null, null, null, '2026-11-12 01:00:00+00'),
  ('a0000000-0000-4000-8000-000000000001', 'first', 'transcribed', 'a5', 2, 2, 90, 120000, null, null, '2026-11-15 16:00:00+00'),
  ('a0000000-0000-4000-8000-000000000001', 'no_script', 'transcribed', 'n1', null, null, null, 50000, 5, 3, '2026-11-17 01:00:00+00'),
  ('a0000000-0000-4000-8000-000000000001', 'no_script', 'transcribed', 'n2', null, null, null, 40000, 3, 1, '2026-11-18 01:00:00+00'),
  ('a0000000-0000-4000-8000-000000000001', 'no_script', 'transcribed', 'n3', null, null, null, 10000, 0, 0, '2026-11-10 02:00:00+00'),
  ('a0000000-0000-4000-8000-000000000001', 'no_script', 'uploaded', null, null, null, null, null, null, null, '2026-11-13 01:00:00+00'),
  ('b0000000-0000-4000-8000-000000000002', 'first', 'transcribed', 'b1', 9, 9, 50, 60000, null, null, '2026-11-17 01:00:00+00'),
  ('b0000000-0000-4000-8000-000000000002', 'no_script', 'transcribed', 'b2', null, null, null, 30000, 4, 4, '2026-11-17 02:00:00+00')
) as v (user_id, kind, status, transcript, pause_count, filler_count, wpm, speech_duration_ms, chunk_target_count, chunk_full_hit_count, created_at);
insert into public.evening_answer (id, user_id, question_id, kind) values
  ('a0000000-0000-4000-8000-0000000000e0', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000061', 'first'),
  ('b0000000-0000-4000-8000-0000000000e0', 'b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000061', 'first');
insert into public.shadow_attempt (user_id, plan_date, item_index, audio_path, recognized_text, accuracy, speed_ratio, stt_provider, passed) values
  ('b0000000-0000-4000-8000-000000000002', '2026-11-21', 0, 'b0000000-0000-4000-8000-000000000002/shadow/0.wav', 'b text', 0.9, 0.8, 'azure-speech', true);
insert into public.slot_checkin (user_id, plan_date, slot, step, status) values
  ('b0000000-0000-4000-8000-000000000002', '2026-11-21', 'morning', 'slot', 'opened');
insert into public.provider_call (user_id, capability, provider, model, tier, status, latency_ms) values
  ('b0000000-0000-4000-8000-000000000002', 'llm', 'gemini', 'gemini-3.5-flash-lite', 'free', 'ok', 120);

-- AC-T6-1: columns and keys (ARCHITECTURE §4, §4.8)
select columns_are('public', 'shadow_attempt', array['id', 'user_id', 'plan_date', 'item_index', 'audio_path', 'audio_expires_at', 'recognized_text', 'accuracy', 'speed_ratio', 'pron_score', 'stt_provider', 'pron_provider', 'passed', 'created_at'], '(AC-T6-1) shadow_attempt has exactly the §4 columns');
select columns_are('public', 'evening_answer', array['id', 'user_id', 'question_id', 'kind', 'status', 'failure', 'audio_path', 'audio_expires_at', 'transcript', 'word_timings', 'pause_count', 'filler_count', 'wpm', 'diagnosis', 'rewrite_text', 'upgrade_chunks', 'chunk_hits', 'speech_duration_ms', 'chunk_target_count', 'chunk_full_hit_count', 'llm_model', 'stt_provider', 'created_at'], '(AC-T6-1) evening_answer has exactly the §4/§4.8.2 columns');
select columns_are('public', 'slot_checkin', array['id', 'user_id', 'plan_date', 'slot', 'step', 'status', 'recorded_at'], '(AC-T6-1) slot_checkin has exactly the §4.8.3 columns');
select columns_are('public', 'provider_call', array['id', 'user_id', 'capability', 'provider', 'model', 'tier', 'status', 'error_kind', 'latency_ms', 'created_at'], '(AC-T6-1) provider_call has exactly the §4 columns (no content)');
select columns_are('public', 'weekly_metric', array['user_id', 'week_start', 'mastered_new', 'mastered_cumulative', 'first_answer_count', 'pause_filler_per_minute', 'pause_filler_count_avg', 'wpm_avg', 'no_script_chunk_targets', 'no_script_chunk_spoken', 'no_script_chunk_spoken_rate'], '(AC-T6-1) weekly_metric has exactly the §4.8.4 columns');
select col_type_is('public', 'card', 'mastered_at', 'timestamp with time zone', '(AC-T6-1) card.mastered_at is timestamptz');
select fk_ok('public', 'shadow_attempt', array['user_id', 'plan_date'], 'public', 'daily_plan', array['user_id', 'plan_date'], '(AC-T6-1) shadow_attempt (user_id, plan_date) references daily_plan');
select fk_ok('public', 'evening_answer', 'question_id', 'public', 'question', 'id', '(AC-T6-1) evening_answer.question_id references question.id');
select col_is_unique('public', 'slot_checkin', array['user_id', 'plan_date', 'slot', 'step', 'status'], '(AC-T6-1) slot_checkin event key is unique');
select col_default_is('public', 'evening_answer', 'status', 'uploaded'::text, '(AC-T6-1) evening_answer.status defaults to uploaded');

-- AC-T6-2: RLS enabled and the grant matrix (real catalog, not only static text)
select results_eq($$select relname::text collate "default" from pg_class where relnamespace = 'public'::regnamespace and relname in ('shadow_attempt', 'evening_answer', 'slot_checkin', 'provider_call') and relrowsecurity and not relforcerowsecurity order by 1$$, $$values ('evening_answer'), ('provider_call'), ('shadow_attempt'), ('slot_checkin')$$, '(AC-T6-2) RLS is enabled (not forced) on the 4 new tables');
select table_privs_are('public', 'shadow_attempt', 'anon', array[]::text[], '(AC-T6-2) anon has no privileges on shadow_attempt');
select table_privs_are('public', 'evening_answer', 'anon', array[]::text[], '(AC-T6-2) anon has no privileges on evening_answer');
select table_privs_are('public', 'slot_checkin', 'anon', array[]::text[], '(AC-T6-2) anon has no privileges on slot_checkin');
select table_privs_are('public', 'provider_call', 'anon', array[]::text[], '(AC-T6-2) anon has no privileges on provider_call');
select table_privs_are('public', 'weekly_metric', 'anon', array[]::text[], '(AC-T6-2) anon has no privileges on weekly_metric');
select table_privs_are('public', 'shadow_attempt', 'authenticated', array['SELECT'], '(AC-T6-2) authenticated: shadow_attempt table-level SELECT only');
select table_privs_are('public', 'evening_answer', 'authenticated', array['SELECT'], '(AC-T6-2) authenticated: evening_answer table-level SELECT only');
select table_privs_are('public', 'slot_checkin', 'authenticated', array['SELECT'], '(AC-T6-2) authenticated: slot_checkin table-level SELECT only');
select table_privs_are('public', 'provider_call', 'authenticated', array['SELECT'], '(AC-T6-2) authenticated: provider_call table-level SELECT only');
select table_privs_are('public', 'weekly_metric', 'authenticated', array['SELECT'], '(AC-T6-2) authenticated: weekly_metric SELECT only');
select table_privs_are('public', 'weekly_metric', 'service_role', array['SELECT'], '(AC-T6-2) service_role: weekly_metric SELECT only');
select results_eq($$select a.attname::text collate "default" from pg_attribute a where a.attrelid = 'public.shadow_attempt'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT') order by a.attnum$$, $$values ('user_id'), ('plan_date'), ('item_index'), ('audio_path'), ('recognized_text'), ('accuracy'), ('speed_ratio'), ('pron_score'), ('stt_provider'), ('pron_provider'), ('passed')$$, '(AC-T6-2) authenticated may INSERT only these shadow_attempt columns (no id/audio_expires_at/created_at)');
select results_eq($$select a.attname::text collate "default" from pg_attribute a where a.attrelid = 'public.evening_answer'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT') order by a.attnum$$, $$values ('user_id'), ('question_id'), ('kind'), ('status'), ('failure'), ('audio_path'), ('transcript'), ('word_timings'), ('pause_count'), ('filler_count'), ('wpm'), ('speech_duration_ms'), ('stt_provider')$$, '(AC-T6-2) authenticated may INSERT only these evening_answer columns (no id/audio_expires_at/created_at)');
select results_eq($$select a.attname::text collate "default" from pg_attribute a where a.attrelid = 'public.evening_answer'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') order by a.attnum$$, $$values ('status'), ('failure'), ('transcript'), ('word_timings'), ('pause_count'), ('filler_count'), ('wpm'), ('diagnosis'), ('rewrite_text'), ('upgrade_chunks'), ('chunk_hits'), ('speech_duration_ms'), ('chunk_target_count'), ('chunk_full_hit_count'), ('llm_model'), ('stt_provider')$$, '(AC-T6-2) authenticated may UPDATE only the result columns of evening_answer (not user_id/question_id/kind/audio_*/created_at)');
select results_eq($$select a.attname::text collate "default" from pg_attribute a where a.attrelid = 'public.slot_checkin'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT') order by a.attnum$$, $$values ('user_id'), ('plan_date'), ('slot'), ('step'), ('status')$$, '(AC-T6-2) authenticated may INSERT only these slot_checkin columns (recorded_at always defaults)');
select results_eq($$select a.attname::text collate "default" from pg_attribute a where a.attrelid = 'public.provider_call'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT') order by a.attnum$$, $$values ('user_id'), ('capability'), ('provider'), ('model'), ('tier'), ('status'), ('error_kind'), ('latency_ms')$$, '(AC-T6-2) authenticated may INSERT only these provider_call columns (created_at always defaults)');
select is((select count(*)::int from pg_attribute a where a.attrelid in ('public.shadow_attempt'::regclass, 'public.slot_checkin'::regclass, 'public.provider_call'::regclass) and a.attnum > 0 and not a.attisdropped and (has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') or has_column_privilege('authenticated', a.attrelid, a.attnum, 'REFERENCES'))), 0, '(AC-T6-2) authenticated has no UPDATE on any column of shadow_attempt / slot_checkin / provider_call');
set local role anon;
select throws_ok($$select count(*) from public.slot_checkin$$, '42501', 'permission denied for table slot_checkin', '(AC-T6-2) anon cannot read slot_checkin');
select throws_ok($$select count(*) from public.weekly_metric$$, '42501', 'permission denied for view weekly_metric', '(AC-T6-2) anon cannot read weekly_metric');
reset role;

-- AC-T6-3: owner-only RLS (using + with check), as stored in the catalog and as enforced
select results_eq($$select policyname::text collate "default", cmd, roles::text[] collate "default", qual collate "default", with_check collate "default" from pg_policies where schemaname = 'public' and tablename = 'shadow_attempt' order by policyname$$, $$values ('shadow_attempt_insert_own', 'INSERT', array['authenticated'], null, '(user_id = ( SELECT auth.uid() AS uid))'), ('shadow_attempt_select_own', 'SELECT', array['authenticated'], '(user_id = ( SELECT auth.uid() AS uid))', null)$$, '(AC-T6-3) shadow_attempt policies are exactly select/insert own');
select results_eq($$select policyname::text collate "default", cmd, roles::text[] collate "default", qual collate "default", with_check collate "default" from pg_policies where schemaname = 'public' and tablename = 'evening_answer' order by policyname$$, $$values ('evening_answer_insert_own', 'INSERT', array['authenticated'], null, '(user_id = ( SELECT auth.uid() AS uid))'), ('evening_answer_select_own', 'SELECT', array['authenticated'], '(user_id = ( SELECT auth.uid() AS uid))', null), ('evening_answer_update_own', 'UPDATE', array['authenticated'], '(user_id = ( SELECT auth.uid() AS uid))', '(user_id = ( SELECT auth.uid() AS uid))')$$, '(AC-T6-3) evening_answer policies are select/insert/update own; update has both using and with check');
select results_eq($$select policyname::text collate "default", cmd, roles::text[] collate "default", qual collate "default", with_check collate "default" from pg_policies where schemaname = 'public' and tablename = 'slot_checkin' order by policyname$$, $$values ('slot_checkin_insert_own', 'INSERT', array['authenticated'], null, '(user_id = ( SELECT auth.uid() AS uid))'), ('slot_checkin_select_own', 'SELECT', array['authenticated'], '(user_id = ( SELECT auth.uid() AS uid))', null)$$, '(AC-T6-3) slot_checkin policies are exactly select/insert own (append-only)');
select results_eq($$select policyname::text collate "default", cmd, roles::text[] collate "default", qual collate "default", with_check collate "default" from pg_policies where schemaname = 'public' and tablename = 'provider_call' order by policyname$$, $$values ('provider_call_insert_own', 'INSERT', array['authenticated'], null, '(user_id = ( SELECT auth.uid() AS uid))'), ('provider_call_select_own', 'SELECT', array['authenticated'], '(user_id = ( SELECT auth.uid() AS uid))', null)$$, '(AC-T6-3) provider_call policies are exactly select/insert own');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is_empty($$select 1 from public.shadow_attempt where user_id = 'b0000000-0000-4000-8000-000000000002'$$, '(AC-T6-3) A cannot read B shadow attempts');
select is_empty($$select 1 from public.evening_answer where user_id = 'b0000000-0000-4000-8000-000000000002'$$, '(AC-T6-3) A cannot read B evening answers');
select is_empty($$select 1 from public.slot_checkin where user_id = 'b0000000-0000-4000-8000-000000000002'$$, '(AC-T6-3) A cannot read B check-ins');
select is_empty($$select 1 from public.provider_call where user_id = 'b0000000-0000-4000-8000-000000000002'$$, '(AC-T6-3) A cannot read B provider calls');
select throws_ok($$insert into public.shadow_attempt (user_id, plan_date, item_index, recognized_text, accuracy, speed_ratio, stt_provider, passed) values ('b0000000-0000-4000-8000-000000000002', '2026-11-21', 1, 'x', 0.5, 0.5, 'azure-speech', false)$$, '42501', 'new row violates row-level security policy for table "shadow_attempt"', '(AC-T6-3) A cannot insert a shadow attempt for B');
select throws_ok($$insert into public.evening_answer (user_id, question_id, kind) values ('b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000061', 'first')$$, '42501', 'new row violates row-level security policy for table "evening_answer"', '(AC-T6-3) A cannot insert an evening answer for B');
select throws_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('b0000000-0000-4000-8000-000000000002', '2026-11-21', 'noon', 'slot', 'opened')$$, '42501', 'new row violates row-level security policy for table "slot_checkin"', '(AC-T6-3) A cannot insert a check-in for B');
select throws_ok($$insert into public.provider_call (user_id, capability, provider, tier, status, latency_ms) values ('b0000000-0000-4000-8000-000000000002', 'stt', 'groq', 'free', 'ok', 10)$$, '42501', 'new row violates row-level security policy for table "provider_call"', '(AC-T6-3) A cannot insert a provider call for B');
select results_eq($$with u as (update public.evening_answer set status = 'failed', failure = '{"kind":"internal"}' where id = 'b0000000-0000-4000-8000-0000000000e0' returning 1) select count(*)::int from u$$, array[0], '(AC-T6-3) A cannot update B evening answer (using)');
select throws_ok($$update public.evening_answer set user_id = 'b0000000-0000-4000-8000-000000000002' where id = 'a0000000-0000-4000-8000-0000000000e0'$$, '42501', 'permission denied for table evening_answer', '(AC-T6-3) A cannot move an own evening answer to B');
select throws_ok($$update public.slot_checkin set status = 'completed' where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '42501', 'permission denied for table slot_checkin', '(AC-T6-3) check-ins cannot be updated (append-only)');
select throws_ok($$delete from public.slot_checkin$$, '42501', 'permission denied for table slot_checkin', '(AC-T6-3) check-ins cannot be deleted (append-only)');
select throws_ok($$update public.shadow_attempt set passed = true$$, '42501', 'permission denied for table shadow_attempt', '(AC-T6-3) shadow attempts cannot be updated by authenticated');
select throws_ok($$delete from public.evening_answer$$, '42501', 'permission denied for table evening_answer', '(AC-T6-3) evening answers cannot be deleted by authenticated');
select throws_ok($$update public.provider_call set latency_ms = 0$$, '42501', 'permission denied for table provider_call', '(AC-T6-3) provider calls cannot be updated by authenticated');
reset role;

-- AC-T6-4: card.mastered_at is written only by card_mastered_guard (Q-28, ARCHITECTURE §4.8.1)
select results_eq($$select prosecdef, proconfig collate "default" from pg_proc where oid = 'public.card_mastered_guard()'::regprocedure$$, $$values (false, array['search_path=""'])$$, '(AC-T6-4) card_mastered_guard is security invoker with search_path ''''');
select is(array[has_function_privilege('anon', 'public.card_mastered_guard()', 'execute'), has_function_privilege('authenticated', 'public.card_mastered_guard()', 'execute')], array[false, false], '(AC-T6-4) anon/authenticated (and PUBLIC) cannot execute card_mastered_guard');
select trigger_is('public', 'card', 'card_mastered_guard', 'public', 'card_mastered_guard', '(AC-T6-4) card has the card_mastered_guard trigger');
alter table public.card disable trigger card_mastered_guard;
select throws_ok($$insert into public.card (user_id, chunk, source_type, state, correct_count, interval_step, due_date) values ('a0000000-0000-4000-8000-000000000001', 'no stamp', 'manual', 'mastered', 2, 4, null)$$, '23514', 'new row for relation "card" violates check constraint "card_mastered_at_check"', '(AC-T6-4) card_mastered_at_check itself rejects mastered without mastered_at');
alter table public.card enable trigger card_mastered_guard;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$insert into public.card (user_id, chunk, source_type, mastered_at) values ('a0000000-0000-4000-8000-000000000001', 'stamp ignored', 'manual', '2026-01-01 00:00:00+00') returning mastered_at$$, $$values (null::timestamptz)$$, '(AC-T6-4) an app-supplied mastered_at on insert is cleared');
select throws_ok($$insert into public.card (user_id, chunk, source_type, state, correct_count, interval_step, due_date) values ('a0000000-0000-4000-8000-000000000001', 'born mastered', 'manual', 'mastered', 2, 4, null)$$, '23514', 'card must not be inserted as mastered', '(AC-T6-4) a card cannot be inserted as mastered');
select results_eq($$update public.card set state = 'mastered', due_date = null where id = 'a0000000-0000-4000-8000-0000000000c1' returning mastered_at = now()$$, $$values (true)$$, '(AC-T6-4) A can move an own reviewing card to mastered and mastered_at = now()');
select throws_ok($$update public.card set state = 'mastered', interval_step = 1, due_date = null where id = 'a0000000-0000-4000-8000-0000000000c2'$$, '23514', 'only reviewing cards can become mastered', '(AC-T6-4) a learning card cannot become mastered');
select throws_ok($$update public.card set state = 'reviewing', due_date = '2026-12-10' where id = 'a0000000-0000-4000-8000-0000000000c1'$$, '23514', 'mastered card is terminal', '(AC-T6-4) a mastered card cannot leave mastered');
select throws_ok($$update public.card set mastered_at = '2026-01-01 00:00:00+00' where id = 'a0000000-0000-4000-8000-0000000000c1'$$, '23514', 'mastered card is terminal', '(AC-T6-4) mastered_at cannot be reset');
select results_eq($$update public.card set mastered_at = now() where id = 'a0000000-0000-4000-8000-0000000000c2' returning mastered_at$$, $$values (null::timestamptz)$$, '(AC-T6-4) mastered_at on a non-mastered card is cleared');
reset role;
set local role service_role;
select results_eq($$update public.card set state = 'mastered', due_date = null, mastered_at = '2000-01-01 00:00:00+00' where id = 'a0000000-0000-4000-8000-0000000000c3' returning mastered_at = now()$$, $$values (true)$$, '(AC-T6-4) secret key: a supplied mastered_at is overwritten with now()');
select throws_ok($$update public.card set state = 'reviewing', due_date = '2026-12-10' where id = 'a0000000-0000-4000-8000-0000000000c3'$$, '23514', 'mastered card is terminal', '(AC-T6-4) secret key also cannot leave mastered (trigger ignores identity)');
reset role;

-- AC-T6-5: profile_paid_consent_guard role check (ARCHITECTURE §4.9, ADR-010 revision 1; Architect: unverified until this test)
select results_eq($$select prosecdef, proconfig collate "default" from pg_proc where oid = 'public.profile_paid_consent_guard()'::regprocedure$$, $$values (false, array['search_path=""'])$$, '(AC-T6-5) profile_paid_consent_guard is NOT security definer (current_user stays the caller) and pins search_path');
select is(array[has_function_privilege('anon', 'public.profile_paid_consent_guard()', 'execute'), has_function_privilege('authenticated', 'public.profile_paid_consent_guard()', 'execute')], array[false, false], '(AC-T6-5) anon/authenticated (and PUBLIC) cannot execute profile_paid_consent_guard');
select trigger_is('public', 'profile', 'profile_paid_consent_guard', 'public', 'profile_paid_consent_guard', '(AC-T6-5) profile has the profile_paid_consent_guard trigger');
select is(current_user::text, 'postgres', '(AC-T6-5) supabase test db runs as postgres');
select results_eq($$select c.relname::text collate "default", pg_get_userbyid(c.relowner)::text collate "default" from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('shadow_attempt', 'evening_answer', 'slot_checkin', 'provider_call', 'weekly_metric') order by 1$$, $$values ('evening_answer', 'postgres'), ('provider_call', 'postgres'), ('shadow_attempt', 'postgres'), ('slot_checkin', 'postgres'), ('weekly_metric', 'postgres')$$, '(AC-T6-5) the T-006 migration ran as postgres (it owns every object it created)');
select lives_ok($$update public.profile set settings = settings || '{"monthly_paid_cap_ntd": 1}' where user_id = 'b0000000-0000-4000-8000-000000000002'$$, '(AC-T6-5) postgres (migration role) may change the paid-consent keys');
update public.profile set settings = '{}' where user_id = 'b0000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$update public.profile set settings = settings || '{"paid_consent_at": "2026-11-24T00:00:00Z"}' where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '42501', 'paid consent can only be changed by POST /settings', '(AC-T6-5) authenticated cannot set paid_consent_at directly');
select throws_ok($$update public.profile set settings = settings || '{"monthly_paid_cap_ntd": 9999}' where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '42501', 'paid consent can only be changed by POST /settings', '(AC-T6-5) authenticated cannot set monthly_paid_cap_ntd directly');
select results_eq($$update public.profile set settings = settings || '{"news": {"lookback_hours": 48}}' where user_id = 'a0000000-0000-4000-8000-000000000001' returning settings$$, $$values ('{"srs": {"forgot_days": 2}, "news": {"lookback_hours": 48}}'::jsonb)$$, '(AC-T6-5) authenticated can still change other settings keys');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$insert into public.profile (user_id, settings) values ('c0000000-0000-4000-8000-000000000003', '{"paid_consent_at": "2026-11-24T00:00:00Z"}')$$, '42501', 'paid consent can only be changed by POST /settings', '(AC-T6-5) authenticated cannot insert a profile that already has paid consent');
select lives_ok($$insert into public.profile (user_id, settings) values ('c0000000-0000-4000-8000-000000000003', '{"srs": {}}')$$, '(AC-T6-5) authenticated can insert a profile without paid-consent keys');
reset role;
set local role service_role;
select is(current_user::text, 'service_role', '(AC-T6-5) a secret-key (PostgREST service_role) request runs as current_user service_role');
select lives_ok($$update public.profile set settings = settings || '{"monthly_paid_cap_ntd": 200}' where user_id = 'c0000000-0000-4000-8000-000000000003'$$, '(AC-T6-5) service_role may change the paid-consent keys directly');
reset role;

-- AC-T6-6: set_paid_consent() (ARCHITECTURE §4.9; Architect: unverified until this test)
select function_returns('public', 'set_paid_consent', array['uuid', 'boolean', 'integer'], 'jsonb', '(AC-T6-6) set_paid_consent(uuid, boolean, integer) returns jsonb');
select results_eq($$select prosecdef, proconfig collate "default" from pg_proc where oid = 'public.set_paid_consent(uuid, boolean, integer)'::regprocedure$$, $$values (false, array['search_path=""'])$$, '(AC-T6-6) set_paid_consent is security invoker with search_path ''''');
select is(array[has_function_privilege('anon', 'public.set_paid_consent(uuid, boolean, integer)', 'execute'), has_function_privilege('authenticated', 'public.set_paid_consent(uuid, boolean, integer)', 'execute'), has_function_privilege('service_role', 'public.set_paid_consent(uuid, boolean, integer)', 'execute')], array[false, false, true], '(AC-T6-6) only service_role can execute set_paid_consent (PUBLIC/anon/authenticated revoked)');
set local role anon;
select throws_ok($$select public.set_paid_consent('a0000000-0000-4000-8000-000000000001', true, 300)$$, '42501', 'permission denied for function set_paid_consent', '(AC-T6-6) anon cannot call set_paid_consent');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.set_paid_consent('a0000000-0000-4000-8000-000000000001', true, 300)$$, '42501', 'permission denied for function set_paid_consent', '(AC-T6-6) authenticated cannot call set_paid_consent');
reset role;
set local role service_role;
select results_eq($$select (s ->> 'paid_consent_at')::timestamptz = now(), (s ->> 'monthly_paid_cap_ntd')::int, s -> 'srs' from public.set_paid_consent('a0000000-0000-4000-8000-000000000001', true, 500) as s$$, $$values (true, 500, '{"forgot_days": 2}'::jsonb)$$, '(AC-T6-6) service_role grant: paid_consent_at = now(), cap set, other keys kept');
select is((select settings from public.profile where user_id = 'b0000000-0000-4000-8000-000000000002'), '{}'::jsonb, '(AC-T6-6) set_paid_consent only touches p_user_id');
select is(public.set_paid_consent('d0000000-0000-4000-8000-000000000004', true, 100), null::jsonb, '(AC-T6-6) no profile row -> returns null and inserts nothing');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$update public.profile set settings = settings - 'paid_consent_at' where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '42501', 'paid consent can only be changed by POST /settings', '(AC-T6-5) authenticated cannot remove an existing paid_consent_at');
select lives_ok($$update public.profile set settings = settings || '{"news": {"lookback_hours": 24}}' where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '(AC-T6-5) authenticated can change other keys while paid consent stays unchanged');
reset role;
set local role service_role;
select results_eq($$select s from public.set_paid_consent('a0000000-0000-4000-8000-000000000001', false, null) as s$$, $$values ('{"srs": {"forgot_days": 2}, "news": {"lookback_hours": 24}}'::jsonb)$$, '(AC-T6-6) service_role withdraw removes both keys and keeps the others');
reset role;

-- AC-T6-7: shadow_attempt / evening_answer rules (AC-06, AC-14, Q-29, ARCHITECTURE §4.8.2)
select results_eq($$select prosecdef, proconfig collate "default" from pg_proc where oid = 'public.evening_answer_question_guard()'::regprocedure$$, $$values (false, array['search_path=""'])$$, '(AC-T6-7) evening_answer_question_guard is security invoker with search_path ''''');
select is(array[has_function_privilege('anon', 'public.evening_answer_question_guard()', 'execute'), has_function_privilege('authenticated', 'public.evening_answer_question_guard()', 'execute')], array[false, false], '(AC-T6-7) anon/authenticated (and PUBLIC) cannot execute evening_answer_question_guard');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$insert into public.shadow_attempt (user_id, plan_date, item_index, audio_path, recognized_text, accuracy, speed_ratio, pron_score, stt_provider, pron_provider, passed) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 0, 'a0000000-0000-4000-8000-000000000001/shadow/0.wav', 'we need to move the needle', 0.85, 0.75, 88, 'azure-speech', 'azure-speech', true) returning audio_expires_at = created_at + interval '90 days'$$, $$values (true)$$, '(AC-T6-7) A records an own shadow attempt; audio_expires_at = created_at + 90 days');
select throws_ok($$insert into public.shadow_attempt (user_id, plan_date, item_index, recognized_text, accuracy, speed_ratio, stt_provider, passed, audio_expires_at) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 1, 'x', 0.5, 0.5, 'azure-speech', false, '2099-01-01 00:00:00+00')$$, '42501', 'permission denied for table shadow_attempt', '(AC-T6-7) A cannot choose audio_expires_at');
select throws_ok($$insert into public.shadow_attempt (user_id, plan_date, item_index, recognized_text, accuracy, speed_ratio, stt_provider, passed) values ('a0000000-0000-4000-8000-000000000001', '2026-11-21', 1, 'x', 0.5, 0.5, 'azure-speech', false)$$, '23503', null, '(AC-T6-7) a shadow attempt needs an own daily_plan for that date');
select throws_ok($$insert into public.shadow_attempt (user_id, plan_date, item_index, recognized_text, accuracy, speed_ratio, stt_provider, passed) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 5, 'x', 0.5, 0.5, 'azure-speech', false)$$, '23514', 'new row for relation "shadow_attempt" violates check constraint "shadow_attempt_item_index_check"', '(AC-T6-7) item_index is 0-4');
select throws_ok($$insert into public.shadow_attempt (user_id, plan_date, item_index, recognized_text, accuracy, speed_ratio, stt_provider, passed) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 1, 'x', 1.5, 0.5, 'azure-speech', false)$$, '23514', 'new row for relation "shadow_attempt" violates check constraint "shadow_attempt_accuracy_check"', '(AC-T6-7) accuracy is 0-1');
select throws_ok($$insert into public.shadow_attempt (user_id, plan_date, item_index, audio_path, recognized_text, accuracy, speed_ratio, stt_provider, passed) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 1, 'b0000000-0000-4000-8000-000000000002/shadow/1.wav', 'x', 0.5, 0.5, 'azure-speech', false)$$, '23514', 'new row for relation "shadow_attempt" violates check constraint "shadow_attempt_audio_path_check"', '(AC-T6-7) shadow audio_path must be under the owner folder');
select results_eq($$insert into public.evening_answer (user_id, question_id, kind, audio_path) values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000061', 'first', 'a0000000-0000-4000-8000-000000000001/evening/1.webm') returning status, audio_expires_at = created_at + interval '90 days'$$, $$values ('uploaded', true)$$, '(AC-T6-7) A uploads an own first answer to a bank question; status uploaded; audio_expires_at = created_at + 90 days');
select throws_ok($$insert into public.evening_answer (user_id, question_id, kind) values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000062', 'first')$$, '23503', 'evening_answer.question_id must be a bank question or the owner''s question', '(AC-T6-7) A cannot answer B resume question');
select throws_ok($$insert into public.evening_answer (user_id, question_id, kind, created_at) values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000061', 'first', '2026-01-01 00:00:00+00')$$, '42501', 'permission denied for table evening_answer', '(AC-T6-7) A cannot backdate created_at (weekly_metric integrity)');
select throws_ok($$insert into public.evening_answer (user_id, question_id, kind, audio_path) values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000061', 'first', 'b0000000-0000-4000-8000-000000000002/evening/1.webm')$$, '23514', 'new row for relation "evening_answer" violates check constraint "evening_answer_audio_path_check"', '(AC-T6-7) evening audio_path must be under the owner folder');
select throws_ok($$update public.evening_answer set status = 'transcribed', transcript = 'hello' where id = 'a0000000-0000-4000-8000-0000000000e0'$$, '23514', 'new row for relation "evening_answer" violates check constraint "evening_answer_speech_duration_status_check"', '(AC-T6-7) transcribed needs speech_duration_ms');
select throws_ok($$update public.evening_answer set status = 'transcribed', speech_duration_ms = 1000 where id = 'a0000000-0000-4000-8000-0000000000e0'$$, '23514', 'new row for relation "evening_answer" violates check constraint "evening_answer_transcript_status_check"', '(AC-T6-7) transcribed needs a transcript');
select throws_ok($$update public.evening_answer set speech_duration_ms = -1 where id = 'a0000000-0000-4000-8000-0000000000e0'$$, '23514', 'new row for relation "evening_answer" violates check constraint "evening_answer_speech_duration_ms_check"', '(AC-T6-7) speech_duration_ms >= 0');
select throws_ok($$update public.evening_answer set chunk_target_count = 3, chunk_full_hit_count = 4 where id = 'a0000000-0000-4000-8000-0000000000e0'$$, '23514', 'new row for relation "evening_answer" violates check constraint "evening_answer_chunk_counts_check"', '(AC-T6-7) full hits cannot exceed targets');
select throws_ok($$update public.evening_answer set chunk_target_count = 3 where id = 'a0000000-0000-4000-8000-0000000000e0'$$, '23514', 'new row for relation "evening_answer" violates check constraint "evening_answer_chunk_counts_check"', '(AC-T6-7) chunk counts are set together');
select throws_ok($$update public.evening_answer set status = 'failed' where id = 'a0000000-0000-4000-8000-0000000000e0'$$, '23514', 'new row for relation "evening_answer" violates check constraint "evening_answer_failure_status_check"', '(AC-T6-7) failed needs failure');
select results_eq($$update public.evening_answer set status = 'transcribed', transcript = 'hello', speech_duration_ms = 1000, pause_count = 1, filler_count = 0, wpm = 120 where id = 'a0000000-0000-4000-8000-0000000000e0' returning status$$, $$values ('transcribed')$$, '(AC-T6-7) A can record an own transcription');
reset role;
set local role service_role;
select throws_ok($$insert into public.evening_answer (user_id, question_id, kind) values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000062', 'first')$$, '23503', 'evening_answer.question_id must be a bank question or the owner''s question', '(AC-T6-7) secret key also cannot attach B question to A answer');
select throws_ok($$insert into public.evening_answer (user_id, question_id, kind, audio_expires_at) values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000061', 'first', now() + interval '1 day')$$, '23514', 'new row for relation "evening_answer" violates check constraint "evening_answer_audio_expires_at_check"', '(AC-T6-7) audio_expires_at must be created_at + 90 days, even for the secret key');
select results_eq($$with u as (update public.evening_answer set audio_path = null where audio_path is not null returning 1) select count(*)::int from u$$, array[1], '(AC-T6-7) purge-audio (secret key) can clear audio_path');
reset role;

-- AC-T6-8: slot_checkin events (Q-30, ARCHITECTURE §4.8.3)
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'morning', 'slot', 'opened') returning recorded_at = now()$$, $$values (true)$$, '(AC-T6-8) A records "morning opened"; recorded_at defaults to now()');
select throws_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'morning', 'slot', 'opened')$$, '23505', 'duplicate key value violates unique constraint "slot_checkin_event_key"', '(AC-T6-8) the same event twice -> 23505 (POST /checkins treats it as success)');
select throws_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status, recorded_at) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'noon', 'slot', 'opened', '2026-01-01 00:00:00+00')$$, '42501', 'permission denied for table slot_checkin', '(AC-T6-8) A cannot choose recorded_at');
select throws_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'morning', 'slot', 'completed')$$, '23514', 'new row for relation "slot_checkin" violates check constraint "slot_checkin_open_step_check"', '(AC-T6-8) the reserved step slot only goes with opened');
select throws_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'morning', 'reading', 'opened')$$, '23514', 'new row for relation "slot_checkin" violates check constraint "slot_checkin_open_step_check"', '(AC-T6-8) opened only goes with the reserved step slot');
select throws_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'morning', 'Reading', 'completed')$$, '23514', 'new row for relation "slot_checkin" violates check constraint "slot_checkin_step_check"', '(AC-T6-8) step must match ^[a-z][a-z_]{0,31}$');
select throws_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'night', 'slot', 'opened')$$, '23514', 'new row for relation "slot_checkin" violates check constraint "slot_checkin_slot_check"', '(AC-T6-8) slot is morning/noon/evening');
select throws_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'morning', 'reading', 'done')$$, '23514', 'new row for relation "slot_checkin" violates check constraint "slot_checkin_status_check"', '(AC-T6-8) status is opened/completed/skipped');
select lives_ok($$insert into public.slot_checkin (user_id, plan_date, slot, step, status) values ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'morning', 'shadowing', 'skipped'), ('a0000000-0000-4000-8000-000000000001', '2026-11-20', 'morning', 'shadowing', 'completed')$$, '(AC-T6-8) a skipped step can later be completed (two events)');
reset role;
set local role service_role;
select results_eq($$select user_id::text, count(*)::int from public.slot_checkin group by 1 order by 1$$, $$values ('a0000000-0000-4000-8000-000000000001', 3), ('b0000000-0000-4000-8000-000000000002', 1)$$, '(AC-T6-8) service_role sees both users events');
reset role;

-- AC-T6-9: provider_call keeps metadata only (ARCHITECTURE §4, AC-24)
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$insert into public.provider_call (user_id, capability, provider, model, tier, status, error_kind, latency_ms) values ('a0000000-0000-4000-8000-000000000001', 'stt', 'groq', null, 'free', 'error', 'rate_limited', 850) returning created_at = now()$$, $$values (true)$$, '(AC-T6-9) A logs an own provider call; created_at defaults to now()');
select throws_ok($$insert into public.provider_call (user_id, capability, provider, tier, status, latency_ms) values ('a0000000-0000-4000-8000-000000000001', 'llm', 'gemini', 'free', 'error', 10)$$, '23514', 'new row for relation "provider_call" violates check constraint "provider_call_error_status_check"', '(AC-T6-9) error needs error_kind');
select throws_ok($$insert into public.provider_call (user_id, capability, provider, tier, status, error_kind, latency_ms) values ('a0000000-0000-4000-8000-000000000001', 'llm', 'gemini', 'free', 'error', 'Timeout!', 10)$$, '23514', 'new row for relation "provider_call" violates check constraint "provider_call_error_kind_check"', '(AC-T6-9) error_kind must match ^[a-z][a-z_]{0,31}$');
select throws_ok($$insert into public.provider_call (user_id, capability, provider, tier, status, latency_ms) values ('a0000000-0000-4000-8000-000000000001', 'llm', 'Gemini Paid', 'paid', 'ok', 10)$$, '23514', 'new row for relation "provider_call" violates check constraint "provider_call_provider_check"', '(AC-T6-9) provider must match ^[a-z][a-z0-9-]{0,31}$');
select throws_ok($$insert into public.provider_call (user_id, capability, provider, tier, status, latency_ms) values ('a0000000-0000-4000-8000-000000000001', 'vision', 'gemini', 'free', 'ok', 10)$$, '23514', 'new row for relation "provider_call" violates check constraint "provider_call_capability_check"', '(AC-T6-9) capability is llm/stt/pronunciation/tts');
select throws_ok($$insert into public.provider_call (user_id, capability, provider, tier, status, latency_ms) values ('a0000000-0000-4000-8000-000000000001', 'llm', 'gemini', 'premium', 'ok', 10)$$, '23514', 'new row for relation "provider_call" violates check constraint "provider_call_tier_check"', '(AC-T6-9) tier is free/paid');
select throws_ok($$insert into public.provider_call (user_id, capability, provider, tier, status, latency_ms, created_at) values ('a0000000-0000-4000-8000-000000000001', 'llm', 'gemini', 'free', 'ok', 10, '2026-01-01 00:00:00+00')$$, '42501', 'permission denied for table provider_call', '(AC-T6-9) A cannot choose created_at');
reset role;

-- AC-T6-10: weekly_metric values, security_invoker and no cross-user leakage (ARCHITECTURE §4.8.4)
select is((select reloptions from pg_class where oid = 'public.weekly_metric'::regclass), array['security_invoker=true'], '(AC-T6-10) weekly_metric is security_invoker = true');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$select week_start from public.weekly_metric where week_start <= '2026-11-16' order by 1$$, $$values ('2026-10-26'::date), ('2026-11-02'::date), ('2026-11-09'::date), ('2026-11-16'::date)$$, '(AC-T6-10) A sees one row per Taipei week from the profile week (2026-11-01 18:00 Taipei -> 2026-10-26), empty week included, only own rows');
select is((select max(week_start) from public.weekly_metric), date_trunc('week', now() at time zone 'Asia/Taipei')::date, '(AC-T6-10) the last row is the current Taipei week');
select results_eq($$select week_start, mastered_new, mastered_cumulative from public.weekly_metric where week_start <= '2026-11-16' order by 1$$, $$values ('2026-10-26'::date, 1, 1), ('2026-11-02'::date, 0, 1), ('2026-11-09'::date, 1, 2), ('2026-11-16'::date, 2, 4)$$, '(AC-T6-10) mastered new / cumulative per week; UTC Sun 15:59:59 stays in the previous week, UTC Sun 16:00 = Taipei Mon 00:00 starts the next');
select results_eq($$select week_start, first_answer_count, pause_filler_per_minute, pause_filler_count_avg, wpm_avg from public.weekly_metric where week_start <= '2026-11-16' order by 1$$, $$values ('2026-10-26'::date, 0, null::numeric, null::numeric, null::numeric), ('2026-11-02'::date, 0, null, null, null), ('2026-11-09'::date, 2, 4, 3, 110), ('2026-11-16'::date, 1, 2, 4, 90)$$, '(AC-T6-10) first answers: per minute = sum / minutes, count avg, duration-weighted wpm; zero-length and untranscribed answers excluded');
select results_eq($$select week_start, no_script_chunk_targets, no_script_chunk_spoken, no_script_chunk_spoken_rate from public.weekly_metric where week_start <= '2026-11-16' order by 1$$, $$values ('2026-10-26'::date, 0, 0, null::numeric), ('2026-11-02'::date, 0, 0, null), ('2026-11-09'::date, 0, 0, null), ('2026-11-16'::date, 8, 4, 0.5)$$, '(AC-T6-10) no-script spoken rate = spoken / targets, null when targets = 0');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is_empty($$select 1 from public.weekly_metric where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '(AC-T6-10) B cannot see A weekly_metric rows');
select results_eq($$select mastered_new, mastered_cumulative, first_answer_count, pause_filler_count_avg, no_script_chunk_targets, no_script_chunk_spoken, no_script_chunk_spoken_rate from public.weekly_metric where week_start = '2026-11-16'$$, $$values (1, 1, 1, 18::numeric, 4, 4, 1::numeric)$$, '(AC-T6-10) B own week contains only B data (no A cards or answers aggregated)');
reset role;
set local role service_role;
select results_eq($$select count(distinct user_id)::int from public.weekly_metric where user_id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002')$$, array[2], '(AC-T6-10) service_role sees both users');
reset role;

select * from finish();
rollback;

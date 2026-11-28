-- T-004 pgTAP: schema, grants and RLS for profile / seed_chunk / card / card_review.
-- Run by the CI db job (`supabase test db`, which enables pgtap in schema extensions); each file is one transaction.
begin;
select plan(47);

-- Fixtures (inserted by the migration owner; RLS does not apply to the table owner).
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 't004-user-a@example.com'),
  ('b0000000-0000-4000-8000-000000000002', 't004-user-b@example.com');
insert into public.profile (user_id) values
  ('a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002');
insert into public.seed_chunk (id, chunk, meaning_zh, example_en, tags, batch) values
  ('e0000000-0000-4000-8000-000000000051', 'circle back', '回頭再討論', 'Let me circle back on this tomorrow.', '{meeting}', 1),
  ('e0000000-0000-4000-8000-000000000052', 'touch base', '簡短聯繫', 'We should touch base before the demo.', '{meeting}', 1);
insert into public.card (id, user_id, chunk, source_type) values
  ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001', 'move the needle', 'manual'),
  ('b0000000-0000-4000-8000-0000000000c2', 'b0000000-0000-4000-8000-000000000002', 'get buy-in from sb', 'manual');
insert into public.card (id, user_id, chunk, source_type, state, correct_count, interval_step, due_date) values
  ('a0000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-000000000001', 'push back on sth', 'news', 'reviewing', 5, 2, '2026-12-01');
insert into public.card_review (user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied) values
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-0000000000c2', '2026-11-20', 'A', 'fast', 'collected', 'learning', 1);

-- AC-T4-1: columns and keys
select col_type_is('public', 'profile', 'settings', 'jsonb', '(AC-T4-1) profile.settings is jsonb');
select col_is_null('public', 'card', 'due_date', '(AC-T4-1) card.due_date is nullable');
select col_is_unique('public', 'card', 'seed_chunk_id', '(AC-T4-1) card.seed_chunk_id is unique');
select fk_ok('public', 'card', 'seed_chunk_id', 'public', 'seed_chunk', 'id', '(AC-T4-1) card.seed_chunk_id references seed_chunk.id');
select col_type_is('public', 'card_review', 'interval_days_applied', 'integer', '(AC-T4-1) card_review.interval_days_applied is integer');
select col_default_is('public', 'profile', 'settings', '{}'::text, '(AC-T4-7) profile.settings defaults to an empty object (SRS defaults live in contracts)');

-- AC-T4-2: RLS enabled and table privileges
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('profile', 'seed_chunk', 'card', 'card_review') and c.relkind = 'r' and c.relrowsecurity), 4, '(AC-T4-2) RLS is enabled on all 4 tables');
select table_privs_are('public', 'profile', 'anon', array[]::text[], '(AC-T4-2) anon has no privileges on profile');
select table_privs_are('public', 'seed_chunk', 'anon', array[]::text[], '(AC-T4-2) anon has no privileges on seed_chunk');
select table_privs_are('public', 'card', 'anon', array[]::text[], '(AC-T4-2) anon has no privileges on card');
select table_privs_are('public', 'card_review', 'anon', array[]::text[], '(AC-T4-2) anon has no privileges on card_review');
select table_privs_are('public', 'profile', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'], '(AC-T4-2) authenticated: profile SELECT/INSERT/UPDATE only');
select table_privs_are('public', 'seed_chunk', 'authenticated', array['SELECT'], '(AC-T4-2) authenticated: seed_chunk SELECT only');
select table_privs_are('public', 'card', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'], '(AC-T4-2) authenticated: card SELECT/INSERT/UPDATE only');
select table_privs_are('public', 'card_review', 'authenticated', array['SELECT', 'INSERT'], '(AC-T4-2) authenticated: card_review SELECT/INSERT only');

-- AC-T4-2: anon is refused at the privilege level
set local role anon;
select throws_ok('select count(*) from public.profile', '42501', null, '(AC-T4-2) anon cannot read profile');
select throws_ok('select count(*) from public.seed_chunk', '42501', null, '(AC-T4-2) anon cannot read seed_chunk');
reset role;

-- Signed in as user A
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- AC-T4-3: owner isolation
select results_eq('select user_id from public.profile', $$values ('a0000000-0000-4000-8000-000000000001'::uuid)$$, '(AC-T4-3) A reads only own profile');
select results_eq('select id from public.card order by id', $$values ('a0000000-0000-4000-8000-0000000000c1'::uuid), ('a0000000-0000-4000-8000-0000000000c3'::uuid)$$, '(AC-T4-3) A reads only own cards');
select is_empty('select id from public.card_review', '(AC-T4-3) A cannot read B card_review');
select results_eq($$with u as (update public.profile set settings = '{"x":1}' where user_id = 'b0000000-0000-4000-8000-000000000002' returning 1) select count(*)::int from u$$, array[0], '(AC-T4-3) A cannot update B profile');
select results_eq($$with u as (update public.card set priority_new = true where id = 'b0000000-0000-4000-8000-0000000000c2' returning 1) select count(*)::int from u$$, array[0], '(AC-T4-3) A cannot update B card');
select throws_ok($$insert into public.card (user_id, chunk, source_type) values ('b0000000-0000-4000-8000-000000000002', 'x', 'manual')$$, '42501', null, '(AC-T4-3) A cannot insert a card for B');
select throws_ok($$update public.card set user_id = 'b0000000-0000-4000-8000-000000000002' where id = 'a0000000-0000-4000-8000-0000000000c1'$$, '42501', null, '(AC-T4-3) A cannot move own card to B');
select throws_ok('delete from public.profile', '42501', null, '(AC-T4-3) A cannot delete profile');
select throws_ok('delete from public.card', '42501', null, '(AC-T4-3) A cannot delete cards');

-- AC-T4-4: card schedule matches CardScheduleSchema (ARCHITECTURE §4.3)
select lives_ok($$insert into public.card (user_id, chunk, source_type) values ('a0000000-0000-4000-8000-000000000001', 'new card', 'manual')$$, '(AC-T4-4) collected card without due_date is allowed');
select throws_ok($$insert into public.card (user_id, chunk, source_type, state, correct_count, interval_step, due_date) values ('a0000000-0000-4000-8000-000000000001', 'mastered card', 'manual', 'mastered', 2, 3, null)$$, '23514', 'card must not be inserted as mastered', '(AC-T4-4) a card cannot be inserted as mastered (T-006 card_mastered_guard, ARCHITECTURE §4.8.1)');
select throws_ok($$insert into public.card (user_id, chunk, source_type, state, correct_count, interval_step, due_date) values ('a0000000-0000-4000-8000-000000000001', 'bad mastered', 'manual', 'mastered', 2, 3, '2026-12-01')$$, '23514', null, '(AC-T4-4) mastered card with a due_date is rejected');
select throws_ok($$insert into public.card (user_id, chunk, source_type, state, correct_count, interval_step, due_date) values ('a0000000-0000-4000-8000-000000000001', 'bad learning', 'manual', 'learning', 1, 0, null)$$, '23514', null, '(AC-T4-4) learning card without due_date is rejected');
select throws_ok($$insert into public.card (user_id, chunk, source_type, state, correct_count, interval_step, due_date) values ('a0000000-0000-4000-8000-000000000001', 'bad reviewing', 'manual', 'reviewing', 2, 0, '2026-12-01')$$, '23514', null, '(AC-T4-4) reviewing card with interval_step 0 is rejected');
select throws_ok($$insert into public.card (user_id, chunk, source_type, correct_count) values ('a0000000-0000-4000-8000-000000000001', 'bad collected', 'manual', 1)$$, '23514', null, '(AC-T4-4) collected card with correct_count 1 is rejected');
select throws_ok($$update public.card set correct_count = 3 where id = 'a0000000-0000-4000-8000-0000000000c3'$$, '23514', null, '(AC-T4-4) correct_count cannot decrease');

-- AC-T4-5: seed_chunk is read-only for users; one card per seed
select results_eq('select count(*)::int from public.seed_chunk', array[2], '(AC-T4-5) authenticated can read seed_chunk');
select throws_ok($$insert into public.seed_chunk (chunk, meaning_zh, example_en, batch) values ('x', 'x', 'x', 1)$$, '42501', null, '(AC-T4-5) authenticated cannot insert seed_chunk');
select throws_ok($$update public.seed_chunk set batch = 2$$, '42501', null, '(AC-T4-5) authenticated cannot update seed_chunk');
select lives_ok($$insert into public.card (user_id, chunk, source_type, seed_chunk_id) values ('a0000000-0000-4000-8000-000000000001', 'circle back', 'seed', 'e0000000-0000-4000-8000-000000000051')$$, '(AC-T4-5) a seed card can point to an unused seed');
select throws_ok($$insert into public.card (user_id, chunk, source_type, seed_chunk_id) values ('a0000000-0000-4000-8000-000000000001', 'circle back', 'seed', 'e0000000-0000-4000-8000-000000000051')$$, '23505', null, '(AC-T4-5) the same seed_chunk_id cannot back two cards');
select throws_ok($$insert into public.card (user_id, chunk, source_type) values ('a0000000-0000-4000-8000-000000000001', 'no seed', 'seed')$$, '23514', null, '(AC-T4-5) a seed card must have seed_chunk_id');

-- AC-T4-6: card_review is append-only for users and tied to the owner's card
select lives_ok($$insert into public.card_review (user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied) values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000c1', '2026-11-21', 'B', 'hesitant', 'collected', 'learning', 1)$$, '(AC-T4-6) A can log a review of own card');
select throws_ok($$insert into public.card_review (user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied) values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-0000000000c2', '2026-11-22', 'A', 'fast', 'collected', 'learning', 1)$$, '23503', null, '(AC-T4-6) A cannot log a review of B card');
select throws_ok($$insert into public.card_review (user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied) values ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-0000000000c2', '2026-11-23', 'A', 'fast', 'collected', 'learning', 1)$$, '42501', null, '(AC-T4-6) A cannot log a review as B');
select throws_ok($$update public.card_review set rating = 'forgot'$$, '42501', null, '(AC-T4-6) card_review cannot be updated');
select throws_ok('delete from public.card_review', '42501', null, '(AC-T4-6) card_review cannot be deleted');
select throws_ok($$insert into public.card_review (user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied) values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000c1', '2026-11-24', 'A', 'fast', 'collected', 'learning', 0)$$, '23514', null, '(AC-T4-6) interval_days_applied must be 1..365');
reset role;

-- AC-T4-2: service_role (secret key; daily-prep / purge-audio only) bypasses RLS
set local role service_role;
select results_eq('select count(distinct user_id)::int from public.card', array[2], '(AC-T4-2) service_role sees every user''s cards');
reset role;

-- AC-T4-5: seed batch range (checked as the migration owner, like a seed-import migration)
select throws_ok($$insert into public.seed_chunk (chunk, meaning_zh, example_en, batch) values ('batch seven', 'x', 'x', 7)$$, '23514', null, '(AC-T4-5) seed_chunk.batch must be 1..6');

select * from finish();
rollback;

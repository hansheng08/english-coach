-- T-032 pgTAP: card_review.review_date unique per card and record_card_review() (ARCHITECTURE §4.11).
-- Run by the CI db job (`supabase test db`); each file is one transaction.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000032', 't032-user-a@example.com'),
  ('b0000000-0000-4000-8000-000000000033', 't032-user-b@example.com');
insert into public.profile (user_id) values
  ('a0000000-0000-4000-8000-000000000032'),
  ('b0000000-0000-4000-8000-000000000033');
insert into public.card (id, user_id, chunk, source_type, state, correct_count, interval_step, due_date) values
  ('a0000000-0000-4000-8000-0000000032c1', 'a0000000-0000-4000-8000-000000000032', 'move the needle', 'manual', 'learning', 1, 0, '2026-11-27'),
  ('a0000000-0000-4000-8000-0000000032c2', 'a0000000-0000-4000-8000-000000000032', 'push back on sth', 'manual', 'learning', 1, 0, '2026-11-27'),
  ('a0000000-0000-4000-8000-0000000032c3', 'a0000000-0000-4000-8000-000000000032', 'circle back', 'manual', 'learning', 1, 0, '2026-11-27'),
  ('b0000000-0000-4000-8000-0000000032c4', 'b0000000-0000-4000-8000-000000000033', 'touch base', 'manual', 'learning', 1, 0, '2026-11-27');

-- Static: function and constraint exist, anon cannot execute.
select has_function('public', 'record_card_review', 'T-032 record_card_review exists');
select is(
  (select prosecdef from pg_proc where proname = 'record_card_review' and pronamespace = 'public'::regnamespace),
  false, '(AC-T32-10) record_card_review is security invoker');
select ok(
  not has_function_privilege('anon', 'public.record_card_review(uuid, date, text, text, text, integer, smallint, date, text, integer, smallint, date, integer)', 'execute'),
  '(AC-T32-10) (TC-17) anon cannot execute record_card_review');
select ok(
  has_function_privilege('authenticated', 'public.record_card_review(uuid, date, text, text, text, integer, smallint, date, text, integer, smallint, date, integer)', 'execute'),
  '(AC-T32-10) authenticated can execute record_card_review');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000032","role":"authenticated"}';

-- TC-15: a normal call updates card and writes one card_review with today's Taipei date.
select lives_ok(
  $$select public.record_card_review('a0000000-0000-4000-8000-0000000032c1', (now() at time zone 'Asia/Taipei')::date, 'A', 'fast',
      'learning', 1, 0::smallint, '2026-11-27', 'reviewing', 2, 1::smallint, ((now() at time zone 'Asia/Taipei')::date + 3), 3)$$,
  '(AC-T32-10) (TC-15) first review succeeds');
select results_eq(
  $$select state, correct_count, interval_step, due_date from public.card where id = 'a0000000-0000-4000-8000-0000000032c1'$$,
  $$values ('reviewing'::text, 2, 1::smallint, ((now() at time zone 'Asia/Taipei')::date + 3))$$,
  '(AC-T32-10) (TC-15) card holds the new schedule');
select results_eq(
  $$select count(*)::int, min(review_date) from public.card_review where card_id = 'a0000000-0000-4000-8000-0000000032c1'$$,
  $$values (1, (now() at time zone 'Asia/Taipei')::date)$$,
  '(AC-T32-10) (TC-15) one card_review row with the Taipei review_date');
select throws_ok(
  $$select public.record_card_review('a0000000-0000-4000-8000-0000000032c1', (now() at time zone 'Asia/Taipei')::date, 'A', 'fast',
      'reviewing', 2, 1::smallint, ((now() at time zone 'Asia/Taipei')::date + 3), 'reviewing', 3, 2::smallint, ((now() at time zone 'Asia/Taipei')::date + 7), 7)$$,
  '23505', null, '(AC-T32-10) (TC-15) a second review on the same day is 23505');
select results_eq(
  $$select correct_count from public.card where id = 'a0000000-0000-4000-8000-0000000032c1'$$,
  array[2], '(AC-T32-10) (TC-15) the failed second review left card unchanged');

-- TC-16: stale old values and a wrong review_date are 40001 and change nothing.
reset role;
update public.card set correct_count = 2 where id = 'a0000000-0000-4000-8000-0000000032c2';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000032","role":"authenticated"}';
select throws_ok(
  $$select public.record_card_review('a0000000-0000-4000-8000-0000000032c2', (now() at time zone 'Asia/Taipei')::date, 'A', 'fast',
      'learning', 1, 0::smallint, '2026-11-27', 'reviewing', 2, 1::smallint, ((now() at time zone 'Asia/Taipei')::date + 3), 3)$$,
  '40001', 'card_review_stale', '(AC-T32-10) (TC-16) stale old values are 40001');
select throws_ok(
  $$select public.record_card_review('a0000000-0000-4000-8000-0000000032c3', ((now() at time zone 'Asia/Taipei')::date - 1), 'A', 'fast',
      'learning', 1, 0::smallint, '2026-11-27', 'reviewing', 2, 1::smallint, ((now() at time zone 'Asia/Taipei')::date + 3), 3)$$,
  '40001', 'review_date_mismatch', '(AC-T32-10) (TC-16) a review_date that is not Taipei today is 40001');
select results_eq(
  $$select count(*)::int from public.card_review where card_id in ('a0000000-0000-4000-8000-0000000032c2', 'a0000000-0000-4000-8000-0000000032c3')$$,
  array[0], '(AC-T32-10) (TC-16) no card_review rows were written by the failed calls');
select results_eq(
  $$select state from public.card where id = 'a0000000-0000-4000-8000-0000000032c3'$$,
  array['learning'], '(AC-T32-10) (TC-16) the card of the failed call is unchanged');

-- TC-17: another user's card, direct duplicate insert.
select throws_ok(
  $$select public.record_card_review('b0000000-0000-4000-8000-0000000032c4', (now() at time zone 'Asia/Taipei')::date, 'A', 'fast',
      'learning', 1, 0::smallint, '2026-11-27', 'reviewing', 2, 1::smallint, ((now() at time zone 'Asia/Taipei')::date + 3), 3)$$,
  'P0002', null, '(AC-T32-10) (TC-17) another user''s card is P0002');
select lives_ok(
  $$insert into public.card_review (user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied) values ('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-0000000032c3', '2026-11-20', 'A', 'fast', 'learning', 'reviewing', 3)$$,
  '(AC-T32-10) (TC-17) a direct card_review insert works once');
select throws_ok(
  $$insert into public.card_review (user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied) values ('a0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-0000000032c3', '2026-11-20', 'B', 'hesitant', 'learning', 'reviewing', 3)$$,
  '23505', null, '(AC-T32-10) (TC-17) a second direct insert for the same card and date is 23505');

select * from finish();
rollback;

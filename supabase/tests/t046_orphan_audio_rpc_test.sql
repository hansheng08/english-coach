-- T-046 pgTAP (TC-39, TC-40, AC-T46-18): list_orphan_audio_objects and audio_paths_in_use.
-- Part 1 (must): privileges, security definer, search_path, cursor argument check.
-- Part 2 (best effort): behaviour against fixture rows inserted into storage.objects.
begin;
select plan(27);

-- ① privileges (function_privs_are)
select function_privs_are('public', 'list_orphan_audio_objects', array['timestamp with time zone', 'integer', 'timestamp with time zone', 'text'], 'anon', array[]::text[], '(AC-T46-18) (TC-39) anon has no privilege on list_orphan_audio_objects');
select function_privs_are('public', 'list_orphan_audio_objects', array['timestamp with time zone', 'integer', 'timestamp with time zone', 'text'], 'authenticated', array[]::text[], '(AC-T46-18) (TC-39) authenticated has no privilege on list_orphan_audio_objects');
select function_privs_are('public', 'list_orphan_audio_objects', array['timestamp with time zone', 'integer', 'timestamp with time zone', 'text'], 'service_role', array['EXECUTE'], '(AC-T46-18) (TC-39) service_role has EXECUTE on list_orphan_audio_objects');
select function_privs_are('public', 'audio_paths_in_use', array['text[]'], 'anon', array[]::text[], '(AC-T46-18) (TC-39) anon has no privilege on audio_paths_in_use');
select function_privs_are('public', 'audio_paths_in_use', array['text[]'], 'authenticated', array[]::text[], '(AC-T46-18) (TC-39) authenticated has no privilege on audio_paths_in_use');
select function_privs_are('public', 'audio_paths_in_use', array['text[]'], 'service_role', array['EXECUTE'], '(AC-T46-18) (TC-39) service_role has EXECUTE on audio_paths_in_use');

-- PUBLIC (grantee 0) must not have EXECUTE (checked on pg_proc.proacl)
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.list_orphan_audio_objects(timestamptz, integer, timestamptz, text)'::regprocedure and a.grantee = 0),
  0,
  '(AC-T46-18) (TC-39) PUBLIC has no EXECUTE on list_orphan_audio_objects'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.audio_paths_in_use(text[])'::regprocedure and a.grantee = 0),
  0,
  '(AC-T46-18) (TC-39) PUBLIC has no EXECUTE on audio_paths_in_use'
);

-- ② roles: anon and authenticated are refused, service_role may call
set local role anon;
select throws_ok($$select * from public.list_orphan_audio_objects(now(), 1)$$, '42501', null, '(AC-T46-18) (TC-39) anon cannot call list_orphan_audio_objects');
select throws_ok($$select * from public.audio_paths_in_use(array['x'])$$, '42501', null, '(AC-T46-18) (TC-39) anon cannot call audio_paths_in_use');
reset role;
set local role authenticated;
select throws_ok($$select * from public.list_orphan_audio_objects(now(), 1)$$, '42501', null, '(AC-T46-18) (TC-39) authenticated cannot call list_orphan_audio_objects');
select throws_ok($$select * from public.audio_paths_in_use(array['x'])$$, '42501', null, '(AC-T46-18) (TC-39) authenticated cannot call audio_paths_in_use');
reset role;
set local role service_role;
select lives_ok($$select * from public.list_orphan_audio_objects(now(), 1)$$, '(AC-T46-18) (TC-39) service_role can call list_orphan_audio_objects');
select lives_ok($$select * from public.audio_paths_in_use(array['x'])$$, '(AC-T46-18) (TC-39) service_role can call audio_paths_in_use');

-- ④ cursor: exactly one of the two cursor arguments is refused with 22023 (still service_role)
select throws_ok($$select * from public.list_orphan_audio_objects(now(), 1, now(), null)$$, '22023', null, '(AC-T46-18) (TC-39) only p_after_created_at is refused');
select throws_ok($$select * from public.list_orphan_audio_objects(now(), 1, null, 'x')$$, '22023', null, '(AC-T46-18) (TC-39) only p_after_name is refused');
select lives_ok($$select * from public.list_orphan_audio_objects(now(), 1, now(), 'x')$$, '(AC-T46-18) (TC-39) both cursor arguments are accepted');
select lives_ok($$select * from public.list_orphan_audio_objects(now(), 1, null, null)$$, '(AC-T46-18) (TC-39) no cursor is accepted');
reset role;

-- ③ security definer and empty search_path
select is_definer('public', 'list_orphan_audio_objects', array['timestamp with time zone', 'integer', 'timestamp with time zone', 'text'], '(AC-T46-18) (TC-39) list_orphan_audio_objects is security definer');
select is_definer('public', 'audio_paths_in_use', array['text[]'], '(AC-T46-18) (TC-39) audio_paths_in_use is security definer');

-- ③ continued: proconfig holds the empty search_path
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc where oid = 'public.list_orphan_audio_objects(timestamptz, integer, timestamptz, text)'::regprocedure),
  '(AC-T46-18) (TC-39) list_orphan_audio_objects has an empty search_path'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc where oid = 'public.audio_paths_in_use(text[])'::regprocedure),
  '(AC-T46-18) (TC-39) audio_paths_in_use has an empty search_path'
);

-- Part 2 (best effort, TC-40): fixtures. If these inserts fail in CI, stop and hand this group to the G4 manual check (see report).
select lives_ok($$
  insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000046', 't046-user@example.com');
  insert into public.question (id, user_id, resume_id, source, category, text, cited_experience)
    values ('e0000000-0000-4000-8000-000000000046', null, null, 'bank', 'behavioral', 'T-046 question', null);
  insert into public.evening_answer (id, user_id, question_id, kind, audio_path)
    values ('c0000000-0000-4000-8000-000000000046', 'a0000000-0000-4000-8000-000000000046', 'e0000000-0000-4000-8000-000000000046', 'first',
            'a0000000-0000-4000-8000-000000000046/evening/c0000000-0000-4000-8000-000000000046.webm');
$$, '(AC-T46-18) (TC-40) fixture rows (user, question, evening_answer) insert');

select lives_ok($$
  insert into storage.objects (bucket_id, name, created_at) values
    ('audio', 'a0000000-0000-4000-8000-000000000046/evening/orphan-a1.webm', timestamptz '2026-11-18 00:00+00'),
    ('audio', 'a0000000-0000-4000-8000-000000000046/evening/c0000000-0000-4000-8000-000000000046.webm', timestamptz '2026-11-18 00:00+00'),
    ('audio', 'a0000000-0000-4000-8000-000000000046/shadow/2026-11-19/0-orphan-a3.wav', timestamptz '2026-11-19 00:00+00'),
    ('audio', 'a0000000-0000-4000-8000-000000000046/evening/exact-cutoff.webm', timestamptz '2026-11-20 00:00+00'),
    ('audio', 'a0000000-0000-4000-8000-000000000046/evening/extra/segment.webm', timestamptz '2026-11-18 00:00+00'),
    ('audio', 'a0000000-0000-4000-8000-000000000046/shadow/two-segments.wav', timestamptz '2026-11-18 00:00+00');
$$, '(AC-T46-18) (TC-40) fixture objects insert into storage.objects');

select is(
  (select array_agg(object_name order by created_at, object_name)
   from public.list_orphan_audio_objects(timestamptz '2026-11-20 00:00+00', 100)),
  array[
    'a0000000-0000-4000-8000-000000000046/evening/orphan-a1.webm',
    'a0000000-0000-4000-8000-000000000046/shadow/2026-11-19/0-orphan-a3.wav'
  ],
  '(AC-T46-18) (TC-40) only old orphans with the right path shape; rows in use, created_at = cutoff and wrong segment counts are excluded'
);
select is(
  (select count(*)::int from public.list_orphan_audio_objects(timestamptz '2026-11-20 00:00+00', 1)),
  1,
  '(AC-T46-18) (TC-40) p_limit caps the result'
);
select is(
  (select array_agg(object_name) from public.list_orphan_audio_objects(
     timestamptz '2026-11-20 00:00+00', 100, timestamptz '2026-11-18 00:00+00', 'a0000000-0000-4000-8000-000000000046/evening/orphan-a1.webm')),
  array['a0000000-0000-4000-8000-000000000046/shadow/2026-11-19/0-orphan-a3.wav'],
  '(AC-T46-18) (TC-40) the cursor is strictly greater than (created_at, name)'
);

select * from finish();
rollback;

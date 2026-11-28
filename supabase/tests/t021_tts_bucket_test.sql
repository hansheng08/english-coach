-- T-021 pgTAP (TC-13, AC-T21-10): `tts` bucket and Storage policies.
-- Run by the CI db job; each file is one transaction.
begin;
select plan(6);

select is((select count(*)::int from storage.buckets where id = 'tts'), 1, '(AC-T21-10) (TC-13) tts bucket exists');
select is((select public from storage.buckets where id = 'tts'), false, '(AC-T21-10) (TC-13) tts bucket is private');
select is((select file_size_limit from storage.buckets where id = 'tts'), 2097152::bigint, '(AC-T21-10) (TC-13) tts bucket limit is 2 MB');

select is(
  (select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tts_select_own'),
  'SELECT',
  '(AC-T21-10) (TC-13) tts_select_own is a SELECT policy'
);
select is(
  (select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tts_insert_own'),
  'INSERT',
  '(AC-T21-10) (TC-13) tts_insert_own is an INSERT policy'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'tts\_%' and cmd in ('UPDATE', 'DELETE')),
  0,
  '(AC-T21-10) (TC-13) tts has no UPDATE or DELETE policy'
);

select * from finish();
rollback;

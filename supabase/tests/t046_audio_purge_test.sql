-- T-046 pgTAP (TC-21, AC-T46-10): `audio` bucket, Storage policies and the purge-audio cron job.
-- Run by the CI db job; each file is one transaction. The two orphan RPCs are tested in t046_orphan_audio_rpc_test.sql.
begin;
select plan(7);

select is((select count(*)::int from storage.buckets where id = 'audio'), 1, '(AC-T46-10) (TC-21) audio bucket exists');
select is((select public from storage.buckets where id = 'audio'), false, '(AC-T46-10) (TC-21) audio bucket is private');
select is((select file_size_limit from storage.buckets where id = 'audio'), 5242880::bigint, '(AC-T46-10) (TC-21) audio bucket limit is 5 MB');

select is(
  (select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'audio_select_own'),
  'SELECT',
  '(AC-T46-10) (TC-21) audio_select_own is a SELECT policy'
);
select is(
  (select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'audio_insert_own'),
  'INSERT',
  '(AC-T46-10) (TC-21) audio_insert_own is an INSERT policy'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'audio\_%' and cmd in ('UPDATE', 'DELETE')),
  0,
  '(AC-T46-10) (TC-21) audio has no UPDATE or DELETE policy'
);

select is(
  (select schedule from cron.job where jobname = 'purge-audio-daily'),
  '30 19 * * *',
  '(AC-T46-10) (TC-21) cron job purge-audio-daily runs at 30 19 * * * UTC'
);

select * from finish();
rollback;

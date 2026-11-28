-- T-050 pgTAP: seed_chunk content loaded by the t050 migrations (batches 1 to 6, 100 rows each).
-- Run by the CI db job (`supabase test db`); each file is one transaction.
begin;
select plan(5);

select is((select count(*)::int from public.seed_chunk where batch not between 1 and 6), 0, '(AC-T50-10) (TC-15) every batch is between 1 and 6');
select is((select count(*)::int from (select batch from public.seed_chunk where batch between 1 and 6 group by batch having count(*) <> 100) bad), 0, '(AC-T50-10) (TC-15) every batch present has exactly 100 rows');
select is((select count(*)::int from public.seed_chunk where not (tags <@ array['meeting','presentation','negotiation','interview','email','project','technical','small-talk']::text[])), 0, '(AC-T50-10) (TC-15) every tags value is a subset of SEED_TAGS');
select is((select count(*)::int from public.seed_chunk where coalesce(array_length(tags, 1), 0) > 3), 0, '(AC-T50-10) (TC-15) no row has more than 3 tags');
select ok((select count(distinct batch) from public.seed_chunk where batch between 1 and 6) < 6 or (select count(*) from public.seed_chunk where batch between 1 and 6) = 600, '(AC-T50-10) (TC-15) when all 6 batches exist there are exactly 600 rows');

select * from finish();
rollback;

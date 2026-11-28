-- T-025a pgTAP: daily_plan claim lease, failure check, seed_remaining and the daily-prep cron job.
-- Run by the CI db job (`supabase test db`); each file is one transaction. Not runnable locally (no database).
-- Row counts of data-modifying statements are taken with GET DIAGNOSTICS in DO blocks (a DML statement cannot sit in a subquery).
begin;
select plan(10);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000f1', 't025a-user@example.com');
delete from public.news_source;
insert into public.news_source (id, name, feed_url, category, priority, fetch_mode) values
  ('e0000000-0000-4000-8000-0000000000f1', 'Example AI', 'https://news.example.com/t025a/feed/', 'ai', 1, 'rss_full');
insert into public.news_article (id, user_id, source_id, category, original_url, original_sha256, title, published_at, rewritten_text, chunks, sentences) values
  ('a0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-0000000000f1', 'e0000000-0000-4000-8000-0000000000f1', 'ai', 'https://news.example.com/t025a/1', repeat('c', 64), 'Article', '2026-11-28 05:00+08', 'Rewritten.', '[{},{},{},{},{}]', '[]');

create temp table t25_rows (k text primary key, n int not null);

-- the claim insert (twice), the reclaim update (fresh, expired, ready)
do $$
declare c int;
begin
  insert into public.daily_plan (user_id, plan_date, planned_category, status, claimed_at)
  values ('a0000000-0000-4000-8000-0000000000f1', '2026-11-28', 'ai', 'pending', now())
  on conflict (user_id, plan_date) do nothing;
  get diagnostics c = row_count;
  insert into t25_rows values ('insert1', c);

  insert into public.daily_plan (user_id, plan_date, planned_category, status, claimed_at)
  values ('a0000000-0000-4000-8000-0000000000f1', '2026-11-28', 'ai', 'pending', now())
  on conflict (user_id, plan_date) do nothing;
  get diagnostics c = row_count;
  insert into t25_rows values ('insert2', c);

  update public.daily_plan set status = 'pending', error = null, failure = null, claimed_at = now()
  where user_id = 'a0000000-0000-4000-8000-0000000000f1' and plan_date = '2026-11-28'
    and (status = 'failed' or (status = 'pending' and claimed_at < now() - interval '180 seconds'));
  get diagnostics c = row_count;
  insert into t25_rows values ('fresh', c);

  update public.daily_plan set claimed_at = now() - interval '181 seconds'
  where user_id = 'a0000000-0000-4000-8000-0000000000f1' and plan_date = '2026-11-28';
  update public.daily_plan set status = 'pending', error = null, failure = null, claimed_at = now()
  where user_id = 'a0000000-0000-4000-8000-0000000000f1' and plan_date = '2026-11-28'
    and (status = 'failed' or (status = 'pending' and claimed_at < now() - interval '180 seconds'));
  get diagnostics c = row_count;
  insert into t25_rows values ('expired', c);

  update public.daily_plan set status = 'ready', actual_category = 'ai', article_id = 'a0000000-0000-4000-8000-0000000000f2'
  where user_id = 'a0000000-0000-4000-8000-0000000000f1' and plan_date = '2026-11-28';
  update public.daily_plan set status = 'pending', error = null, failure = null, claimed_at = now()
  where user_id = 'a0000000-0000-4000-8000-0000000000f1' and plan_date = '2026-11-28'
    and (status = 'failed' or (status = 'pending' and claimed_at < now() - interval '180 seconds'));
  get diagnostics c = row_count;
  insert into t25_rows values ('ready', c);
end;
$$;

select is((select n from t25_rows where k = 'insert1'), 1, '(AC-T25-16) (TC-25) the first insert returns a row');
select is((select n from t25_rows where k = 'insert2'), 0, '(AC-T25-16) (TC-25) a second insert for the same (user_id, plan_date) returns no row');
select is((select n from t25_rows where k = 'fresh'), 0, '(AC-T25-16) (TC-25) a pending lease younger than 180 seconds is not reclaimed');
select is((select n from t25_rows where k = 'expired'), 1, '(AC-T25-16) (TC-25) an expired pending lease is reclaimed');
select is((select n from t25_rows where k = 'ready'), 0, '(AC-T25-16) (TC-25) a ready plan is not reclaimed');

-- failure and status go together
select throws_ok(
  $$insert into public.daily_plan (user_id, plan_date, planned_category, status, error)
    values ('a0000000-0000-4000-8000-0000000000f1', '2026-11-29', 'ai', 'failed', 'internal')$$,
  '23514', null, '(AC-T25-16) (TC-25) status failed without failure is rejected');
select throws_ok(
  $$update public.daily_plan set failure = '{"step":"news"}'::jsonb, status = 'ready'
    where user_id = 'a0000000-0000-4000-8000-0000000000f1' and plan_date = '2026-11-28'$$,
  '23514', null, '(AC-T25-16) (TC-25) status ready with a failure is rejected');
select lives_ok(
  $$insert into public.daily_plan (user_id, plan_date, planned_category, status, error, failure)
    values ('a0000000-0000-4000-8000-0000000000f1', '2026-11-30', 'ai', 'failed', 'news_unavailable', '{"step":"news"}'::jsonb)$$,
  '(AC-T25-16) (TC-25) status failed with a failure is accepted');

-- seed_remaining is not negative
select throws_ok(
  $$update public.daily_plan set seed_remaining = -1
    where user_id = 'a0000000-0000-4000-8000-0000000000f1' and plan_date = '2026-11-28'$$,
  '23514', null, '(AC-T25-16) (TC-25) seed_remaining -1 is rejected');

-- the cron job
select is(
  (select schedule from cron.job where jobname = 'daily-prep-daily'),
  '0 21 * * *',
  '(AC-T25-16) (TC-25) cron job daily-prep-daily exists and runs at 0 21 * * * (UTC)');

select * from finish();
rollback;

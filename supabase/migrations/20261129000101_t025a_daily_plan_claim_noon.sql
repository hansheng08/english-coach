-- T-025a: daily_plan claim lease, noon items, failure reason, seed_remaining, and the daily-prep cron.
-- ARCHITECTURE §4.13.1 (failure, error check, seed_remaining), §4.13.2 (claimed_at lease), §4.14.1 (noon_items), §4.12.3 (schedule).
-- No secret values here: Vault secrets `project_url` and `secret_key` are created by hand in the hosted project (G4).

alter table public.daily_plan
  add column claimed_at timestamptz not null default now(),
  add column noon_items jsonb not null default '[]'::jsonb,
  add column failure jsonb,
  add column seed_remaining int;

alter table public.daily_plan
  add constraint daily_plan_noon_items_check
    check (case when jsonb_typeof(noon_items) = 'array' then jsonb_array_length(noon_items) <= 25 else false end),
  add constraint daily_plan_failure_check
    check (failure is null or jsonb_typeof(failure) = 'object'),
  add constraint daily_plan_failure_status_check
    check ((status = 'failed') = (failure is not null)),
  add constraint daily_plan_seed_remaining_check
    check (seed_remaining >= 0),
  add constraint daily_plan_error_kind_check
    check (error is null or error in (
      'quota_exhausted', 'rate_limited', 'unavailable', 'timeout', 'auth', 'region_blocked',
      'invalid_response', 'not_configured', 'paid_not_allowed', 'validation', 'unauthenticated',
      'not_found', 'conflict', 'storage_failed', 'db_failed', 'news_unavailable', 'plan_not_ready', 'internal'
    ));

-- schedule: 0 21 * * * UTC = every day 05:00 Asia/Taipei (separate job from purge-audio-daily)
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('daily-prep-daily', '0 21 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/daily-prep',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
$$);

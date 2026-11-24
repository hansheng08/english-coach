-- T-006 migration 3: shadow_attempt, evening_answer, slot_checkin, provider_call, weekly_metric view + RLS;
-- card.mastered_at (Q-28) and the paid-consent guard / set_paid_consent() (ARCHITECTURE §4.9).
-- Source: docs/ARCHITECTURE.md v1.5 §4 (tables), §4.8.1-§4.8.4, §4.9; ADR-010 revision 1; ADR-011 decision 2.
-- Recording columns: audio_expires_at = created_at + 90 days (Q-06); purge-audio (secret key) later sets audio_path to null.

-- 1. card.mastered_at: written only by the trigger on reviewing -> mastered; mastered is terminal (Q-24).
alter table public.card add column mastered_at timestamptz;
alter table public.card add constraint card_mastered_at_check check ((state = 'mastered') = (mastered_at is not null));

create function public.card_mastered_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state = 'mastered' then
      raise exception 'card must not be inserted as mastered' using errcode = 'check_violation';
    end if;
    new.mastered_at := null;
    return new;
  end if;
  if old.state = 'mastered' then
    if new.state <> 'mastered' or new.mastered_at is distinct from old.mastered_at then
      raise exception 'mastered card is terminal' using errcode = 'check_violation';
    end if;
  elsif new.state = 'mastered' then
    if old.state <> 'reviewing' then
      raise exception 'only reviewing cards can become mastered' using errcode = 'check_violation';
    end if;
    new.mastered_at := now();
  else
    new.mastered_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.card_mastered_guard() from public, anon, authenticated;
create trigger card_mastered_guard before insert or update on public.card
  for each row execute function public.card_mastered_guard();

-- 2. profile.settings paid consent: only service_role (set_paid_consent via the secret key) or postgres (migrations) may change it.
-- Must NOT be security definer: current_user would become the function owner.
create function public.profile_paid_consent_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres') then
    return new;
  end if;
  if (new.settings -> 'paid_consent_at') is distinct from (case when tg_op = 'UPDATE' then old.settings -> 'paid_consent_at' end)
     or (new.settings -> 'monthly_paid_cap_ntd') is distinct from (case when tg_op = 'UPDATE' then old.settings -> 'monthly_paid_cap_ntd' end) then
    raise exception 'paid consent can only be changed by POST /settings' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.profile_paid_consent_guard() from public, anon, authenticated;
create trigger profile_paid_consent_guard before insert or update of settings on public.profile
  for each row execute function public.profile_paid_consent_guard();

create function public.set_paid_consent(p_user_id uuid, p_granted boolean, p_monthly_cap_ntd integer)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.profile
     set settings = case when p_granted
       then settings || jsonb_build_object('paid_consent_at', to_jsonb(now()), 'monthly_paid_cap_ntd', p_monthly_cap_ntd)
       else settings - 'paid_consent_at' - 'monthly_paid_cap_ntd' end
   where user_id = p_user_id
  returning settings;
$$;
revoke all on function public.set_paid_consent(uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.set_paid_consent(uuid, boolean, integer) to service_role;

-- 3. New tables (foreign keys first: daily_plan and question come from T-005).
create table public.shadow_attempt (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_date date not null,
  item_index smallint not null constraint shadow_attempt_item_index_check check (item_index between 0 and 4),
  audio_path text constraint shadow_attempt_audio_path_check check (starts_with(audio_path, user_id::text || '/')),
  audio_expires_at timestamptz not null default (now() + interval '90 days'),
  recognized_text text not null,
  accuracy numeric not null constraint shadow_attempt_accuracy_check check (accuracy between 0 and 1),
  speed_ratio numeric not null constraint shadow_attempt_speed_ratio_check check (speed_ratio >= 0),
  pron_score numeric constraint shadow_attempt_pron_score_check check (pron_score between 0 and 100),
  stt_provider text not null,
  pron_provider text,
  passed boolean not null,
  created_at timestamptz not null default now(),
  constraint shadow_attempt_audio_expires_at_check check (audio_expires_at = created_at + interval '90 days'),
  constraint shadow_attempt_plan_fkey foreign key (user_id, plan_date) references public.daily_plan (user_id, plan_date) on delete cascade
);

create table public.evening_answer (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id uuid not null references public.question (id) on delete restrict,
  kind text not null constraint evening_answer_kind_check check (kind in ('first', 'no_script')),
  status text not null default 'uploaded' constraint evening_answer_status_check check (status in ('uploaded', 'transcribed', 'diagnosed', 'failed')),
  failure jsonb constraint evening_answer_failure_check check (jsonb_typeof(failure) = 'object'),
  audio_path text constraint evening_answer_audio_path_check check (starts_with(audio_path, user_id::text || '/')),
  audio_expires_at timestamptz not null default (now() + interval '90 days'),
  transcript text,
  word_timings jsonb constraint evening_answer_word_timings_check check (jsonb_typeof(word_timings) = 'array'),
  pause_count integer constraint evening_answer_pause_count_check check (pause_count >= 0),
  filler_count integer constraint evening_answer_filler_count_check check (filler_count >= 0),
  wpm numeric constraint evening_answer_wpm_check check (wpm >= 0),
  diagnosis jsonb constraint evening_answer_diagnosis_check check (jsonb_typeof(diagnosis) = 'object'),
  rewrite_text text,
  upgrade_chunks jsonb constraint evening_answer_upgrade_chunks_check check (jsonb_typeof(upgrade_chunks) = 'array'),
  chunk_hits jsonb constraint evening_answer_chunk_hits_check check (jsonb_typeof(chunk_hits) = 'array'),
  speech_duration_ms integer constraint evening_answer_speech_duration_ms_check check (speech_duration_ms >= 0),
  chunk_target_count smallint constraint evening_answer_chunk_target_count_check check (chunk_target_count >= 0),
  chunk_full_hit_count smallint constraint evening_answer_chunk_full_hit_count_check check (chunk_full_hit_count >= 0),
  llm_model text,
  stt_provider text,
  created_at timestamptz not null default now(),
  constraint evening_answer_failure_status_check check ((status = 'failed') = (failure is not null)),
  constraint evening_answer_transcript_status_check check (status not in ('transcribed', 'diagnosed') or transcript is not null),
  constraint evening_answer_speech_duration_status_check
    check (status not in ('transcribed', 'diagnosed') or speech_duration_ms is not null),
  constraint evening_answer_chunk_counts_check
    check ((chunk_target_count is null) = (chunk_full_hit_count is null)
           and (chunk_full_hit_count is null or chunk_full_hit_count <= chunk_target_count)),
  constraint evening_answer_audio_expires_at_check check (audio_expires_at = created_at + interval '90 days')
);

create table public.slot_checkin (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_date date not null,
  slot text not null constraint slot_checkin_slot_check check (slot in ('morning', 'noon', 'evening')),
  step text not null constraint slot_checkin_step_check check (step ~ '^[a-z][a-z_]{0,31}$'),
  status text not null constraint slot_checkin_status_check check (status in ('opened', 'completed', 'skipped')),
  recorded_at timestamptz not null default now(),
  constraint slot_checkin_open_step_check check ((status = 'opened') = (step = 'slot')),
  constraint slot_checkin_event_key unique (user_id, plan_date, slot, step, status)
);

create table public.provider_call (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  capability text not null constraint provider_call_capability_check check (capability in ('llm', 'stt', 'pronunciation', 'tts')),
  provider text not null constraint provider_call_provider_check check (provider ~ '^[a-z][a-z0-9-]{0,31}$'),
  model text,
  tier text not null constraint provider_call_tier_check check (tier in ('free', 'paid')),
  status text not null constraint provider_call_status_check check (status in ('ok', 'error')),
  error_kind text constraint provider_call_error_kind_check check (error_kind ~ '^[a-z][a-z_]{0,31}$'),
  latency_ms integer not null constraint provider_call_latency_ms_check check (latency_ms >= 0),
  created_at timestamptz not null default now(),
  constraint provider_call_error_status_check check ((status = 'error') = (error_kind is not null))
);

create index card_user_id_mastered_at_idx on public.card (user_id, mastered_at) where mastered_at is not null;
create index shadow_attempt_user_id_plan_date_idx on public.shadow_attempt (user_id, plan_date, item_index);
create index evening_answer_user_id_kind_created_at_idx on public.evening_answer (user_id, kind, created_at);
create index provider_call_user_id_created_at_idx on public.provider_call (user_id, created_at);

-- evening_answer.question_id may point at a bank question (user_id is null) or the owner's own question only.
create function public.evening_answer_question_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.question q
    where q.id = new.question_id and (q.user_id is null or q.user_id = new.user_id)
  ) then
    raise exception 'evening_answer.question_id must be a bank question or the owner''s question' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.evening_answer_question_guard() from public, anon, authenticated;
create trigger evening_answer_question_guard before insert or update of question_id, user_id on public.evening_answer
  for each row execute function public.evening_answer_question_guard();

-- 4. RLS: owner-only (user_id = auth.uid()); no DELETE for authenticated; created_at / audio_expires_at / recorded_at always use defaults.
alter table public.shadow_attempt enable row level security;
alter table public.evening_answer enable row level security;
alter table public.slot_checkin enable row level security;
alter table public.provider_call enable row level security;

revoke all on table public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call from anon;
revoke all on table public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call from authenticated;
grant select on table public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call to authenticated;
grant insert (user_id, plan_date, item_index, audio_path, recognized_text, accuracy, speed_ratio, pron_score, stt_provider, pron_provider, passed) on table public.shadow_attempt to authenticated;
grant insert (user_id, question_id, kind, status, failure, audio_path, transcript, word_timings, pause_count, filler_count, wpm, speech_duration_ms, stt_provider) on table public.evening_answer to authenticated;
grant update (status, failure, transcript, word_timings, pause_count, filler_count, wpm, diagnosis, rewrite_text, upgrade_chunks, chunk_hits, speech_duration_ms, chunk_target_count, chunk_full_hit_count, llm_model, stt_provider) on table public.evening_answer to authenticated;
grant insert (user_id, plan_date, slot, step, status) on table public.slot_checkin to authenticated;
grant insert (user_id, capability, provider, model, tier, status, error_kind, latency_ms) on table public.provider_call to authenticated;
grant all on table public.shadow_attempt, public.evening_answer, public.slot_checkin, public.provider_call to service_role;

create policy shadow_attempt_select_own on public.shadow_attempt for select to authenticated using (user_id = (select auth.uid()));
create policy shadow_attempt_insert_own on public.shadow_attempt for insert to authenticated with check (user_id = (select auth.uid()));
create policy evening_answer_select_own on public.evening_answer for select to authenticated using (user_id = (select auth.uid()));
create policy evening_answer_insert_own on public.evening_answer for insert to authenticated with check (user_id = (select auth.uid()));
create policy evening_answer_update_own on public.evening_answer for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy slot_checkin_select_own on public.slot_checkin for select to authenticated using (user_id = (select auth.uid()));
create policy slot_checkin_insert_own on public.slot_checkin for insert to authenticated with check (user_id = (select auth.uid()));
create policy provider_call_select_own on public.provider_call for select to authenticated using (user_id = (select auth.uid()));
create policy provider_call_insert_own on public.provider_call for insert to authenticated with check (user_id = (select auth.uid()));

-- 5. weekly_metric: one row per user per Taipei week (Monday 00:00), from the profile's first week to this week (§4.8.4).
-- security_invoker = true so the underlying tables' RLS applies to the caller.
create view public.weekly_metric with (security_invoker = true) as
with weeks as (
  select p.user_id, w::date as week_start
  from public.profile p
  cross join lateral generate_series(
    date_trunc('week', p.created_at at time zone 'Asia/Taipei'),
    date_trunc('week', now() at time zone 'Asia/Taipei'),
    interval '7 days'
  ) as w
),
mastered as (
  select c.user_id, date_trunc('week', c.mastered_at at time zone 'Asia/Taipei')::date as week_start, count(*) as mastered_new
  from public.card c
  where c.mastered_at is not null
  group by 1, 2
),
first_answer as (
  select e.user_id, date_trunc('week', e.created_at at time zone 'Asia/Taipei')::date as week_start,
         count(*) as answer_count,
         sum(e.pause_count + e.filler_count) as pause_filler_sum,
         sum(e.speech_duration_ms) as speech_duration_ms_sum,
         sum(e.wpm * e.speech_duration_ms) as wpm_duration_sum
  from public.evening_answer e
  where e.kind = 'first' and e.pause_count is not null and e.filler_count is not null and e.wpm is not null
    and e.speech_duration_ms is not null and e.speech_duration_ms > 0
  group by 1, 2
),
no_script as (
  select e.user_id, date_trunc('week', e.created_at at time zone 'Asia/Taipei')::date as week_start,
         coalesce(sum(e.chunk_target_count), 0) as chunk_targets,
         coalesce(sum(e.chunk_full_hit_count), 0) as chunk_spoken
  from public.evening_answer e
  where e.kind = 'no_script'
  group by 1, 2
)
select
  w.user_id,
  w.week_start,
  coalesce(m.mastered_new, 0)::integer as mastered_new,
  (select count(*) from public.card c
    where c.user_id = w.user_id and c.mastered_at < ((w.week_start + 7)::timestamp at time zone 'Asia/Taipei'))::integer as mastered_cumulative,
  coalesce(f.answer_count, 0)::integer as first_answer_count,
  f.pause_filler_sum::numeric / (f.speech_duration_ms_sum::numeric / 60000) as pause_filler_per_minute,
  f.pause_filler_sum::numeric / f.answer_count as pause_filler_count_avg,
  f.wpm_duration_sum / f.speech_duration_ms_sum as wpm_avg,
  coalesce(n.chunk_targets, 0)::integer as no_script_chunk_targets,
  coalesce(n.chunk_spoken, 0)::integer as no_script_chunk_spoken,
  n.chunk_spoken::numeric / nullif(n.chunk_targets, 0) as no_script_chunk_spoken_rate
from weeks w
left join mastered m on m.user_id = w.user_id and m.week_start = w.week_start
left join first_answer f on f.user_id = w.user_id and f.week_start = w.week_start
left join no_script n on n.user_id = w.user_id and n.week_start = w.week_start;

revoke all on table public.weekly_metric from anon, authenticated, service_role;
grant select on table public.weekly_metric to authenticated, service_role;

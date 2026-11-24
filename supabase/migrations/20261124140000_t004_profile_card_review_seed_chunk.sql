-- T-004 migration 1: profile, seed_chunk, card, card_review + RLS.
-- Source: docs/ARCHITECTURE.md §4 (tables), §4.2 (settings.srs), §4.3 (CardScheduleSchema), §4.4 (seed_chunk_id); ADR-011.
-- Defaults for settings.srs / settings.news live only in packages/contracts (CLAUDE.md §5 #11); the DB stores '{}'.
-- seed_chunk is shared reference data (imported by later migrations, T-024/T-050), so it has no user_id.

create table public.profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'Asia/Taipei' constraint profile_timezone_check check (timezone = 'Asia/Taipei'),
  slot_start jsonb not null default '{}'::jsonb constraint profile_slot_start_check check (jsonb_typeof(slot_start) = 'object'),
  settings jsonb not null default '{}'::jsonb constraint profile_settings_check check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now()
);

create table public.seed_chunk (
  id uuid primary key default gen_random_uuid(),
  chunk text not null constraint seed_chunk_chunk_key unique,
  meaning_zh text not null,
  example_en text not null,
  tags text[] not null default '{}',
  batch smallint not null constraint seed_chunk_batch_check check (batch between 1 and 6),
  created_at timestamptz not null default now()
);

create table public.card (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk text not null,
  meaning_zh text,
  example_en text,
  synonyms text[] not null default '{}',
  source_sentence text,
  source_type text not null constraint card_source_type_check check (source_type in ('news', 'manual', 'evening', 'seed', 'shadowing')),
  state text not null default 'collected' constraint card_state_check check (state in ('collected', 'learning', 'reviewing', 'mastered')),
  correct_count integer not null default 0,
  interval_step smallint not null default 0 constraint card_interval_step_check check (interval_step between 0 and 4),
  due_date date,
  priority_new boolean not null default false,
  seed_chunk_id uuid constraint card_seed_chunk_id_key unique references public.seed_chunk (id) on delete restrict,
  tts_path text,
  generated_by text,
  created_at timestamptz not null default now(),
  constraint card_id_user_id_key unique (id, user_id),
  constraint card_seed_source_check check ((source_type = 'seed') = (seed_chunk_id is not null)),
  constraint card_schedule_check check (
    (state = 'collected' and correct_count = 0 and interval_step = 0)
    or (state = 'learning' and correct_count >= 1 and interval_step = 0 and due_date is not null)
    or (state = 'reviewing' and correct_count >= 2 and interval_step between 1 and 4 and due_date is not null)
    or (state = 'mastered' and correct_count >= 2 and interval_step between 1 and 4 and due_date is null)
  )
);

create table public.card_review (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null,
  reviewed_at timestamptz not null default now(),
  mode text not null constraint card_review_mode_check check (mode in ('A', 'B')),
  rating text not null constraint card_review_rating_check check (rating in ('fast', 'hesitant', 'forgot')),
  state_before text not null constraint card_review_state_before_check check (state_before in ('collected', 'learning', 'reviewing', 'mastered')),
  state_after text not null constraint card_review_state_after_check check (state_after in ('collected', 'learning', 'reviewing', 'mastered')),
  interval_days_applied integer not null constraint card_review_interval_days_applied_check check (interval_days_applied between 1 and 365),
  constraint card_review_card_owner_fkey foreign key (card_id, user_id) references public.card (id, user_id) on delete cascade
);

create index card_user_id_state_due_date_idx on public.card (user_id, state, due_date);
create index card_review_card_id_reviewed_at_idx on public.card_review (card_id, reviewed_at);
create index card_review_user_id_reviewed_at_idx on public.card_review (user_id, reviewed_at);

-- correct_count is cumulative and never decreases (ARCHITECTURE §4 card, §4.3).
create function public.card_correct_count_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.correct_count < old.correct_count then
    raise exception 'card.correct_count must not decrease' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.card_correct_count_guard() from public, anon, authenticated;
create trigger card_correct_count_guard before update of correct_count on public.card
  for each row execute function public.card_correct_count_guard();

-- RLS: user tables are owner-only (user_id = auth.uid()); seed_chunk is read-only for signed-in users.
alter table public.profile enable row level security;
alter table public.seed_chunk enable row level security;
alter table public.card enable row level security;
alter table public.card_review enable row level security;

revoke all on table public.profile, public.seed_chunk, public.card, public.card_review from anon;
revoke all on table public.profile, public.seed_chunk, public.card, public.card_review from authenticated;
grant select, insert, update on table public.profile to authenticated;
grant select on table public.seed_chunk to authenticated;
grant select, insert, update on table public.card to authenticated;
grant select, insert on table public.card_review to authenticated;
grant all on table public.profile, public.seed_chunk, public.card, public.card_review to service_role;

create policy profile_select_own on public.profile for select to authenticated using (user_id = (select auth.uid()));
create policy profile_insert_own on public.profile for insert to authenticated with check (user_id = (select auth.uid()));
create policy profile_update_own on public.profile for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy seed_chunk_select_authenticated on public.seed_chunk for select to authenticated using (true);
create policy card_select_own on public.card for select to authenticated using (user_id = (select auth.uid()));
create policy card_insert_own on public.card for insert to authenticated with check (user_id = (select auth.uid()));
create policy card_update_own on public.card for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy card_review_select_own on public.card_review for select to authenticated using (user_id = (select auth.uid()));
create policy card_review_insert_own on public.card_review for insert to authenticated with check (user_id = (select auth.uid()));

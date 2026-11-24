-- T-005 migration 2: news_source, news_article, resume, question, daily_plan + RLS.
-- Source: docs/ARCHITECTURE.md §1, §4 (tables), §4.5 (tonight question, bank questions), §5.1 (/plan/today, /resume), §7, §7.1, §11.2; ADR-006.
-- The original article text is never stored, only its SHA-256 (CLAUDE.md §5 #7). News rotation defaults live only in packages/contracts (CLAUDE.md §5 #11).
-- news_source is shared reference data (seeded by T-022) and bank questions (source = 'bank', imported like seed_chunk) are shared rows, so neither has an owner.

create table public.news_source (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  feed_url text not null constraint news_source_feed_url_key unique,
  category text not null constraint news_source_category_check check (category in ('ai', 'software', 'semiconductor')),
  priority smallint not null constraint news_source_priority_check check (priority between 1 and 3),
  fetch_mode text not null constraint news_source_fetch_mode_check check (fetch_mode in ('rss_full', 'rss_then_page')),
  include_url_pattern text,
  enabled boolean not null default true,
  terms_checked_at date,
  created_at timestamptz not null default now(),
  constraint news_source_category_priority_key unique (category, priority)
);

create table public.news_article (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references public.news_source (id) on delete restrict,
  category text not null constraint news_article_category_check check (category in ('ai', 'software', 'semiconductor')),
  original_url text not null constraint news_article_original_url_key unique,
  original_sha256 text not null constraint news_article_original_sha256_key unique constraint news_article_original_sha256_check check (original_sha256 ~ '^[0-9a-f]{64}$'),
  title text not null,
  published_at timestamptz not null,
  rewritten_text text not null,
  chunks jsonb not null constraint news_article_chunks_check check (case when jsonb_typeof(chunks) = 'array' then jsonb_array_length(chunks) = 5 else false end),
  sentences jsonb not null constraint news_article_sentences_check check (jsonb_typeof(sentences) = 'array'),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint news_article_id_user_id_key unique (id, user_id)
);

create table public.resume (
  user_id uuid primary key references auth.users (id) on delete cascade,
  storage_path text not null constraint resume_storage_path_check check (starts_with(storage_path, user_id::text || '/')),
  redacted_text text not null,
  uploaded_at timestamptz not null default now()
);

create table public.question (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  resume_id uuid references public.resume (user_id) on delete set null,
  source text not null constraint question_source_check check (source in ('resume', 'bank')),
  category text not null constraint question_category_check check (category in ('intro', 'behavioral', 'technical')),
  text text not null,
  cited_experience text,
  retired boolean not null default false,
  created_at timestamptz not null default now(),
  constraint question_source_owner_check check (
    (source = 'bank' and user_id is null and resume_id is null)
    or (source = 'resume' and user_id is not null and cited_experience is not null)
  ),
  constraint question_resume_owner_check check (resume_id is null or resume_id = user_id),
  constraint question_retired_check check (source = 'bank' or resume_id is not null or retired)
);

create table public.daily_plan (
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_date date not null,
  planned_category text not null constraint daily_plan_planned_category_check check (planned_category in ('ai', 'software', 'semiconductor')),
  actual_category text constraint daily_plan_actual_category_check check (actual_category in ('ai', 'software', 'semiconductor')),
  category_skipped text[] not null default '{}' constraint daily_plan_category_skipped_check check (category_skipped <@ array['ai', 'software', 'semiconductor']::text[]),
  article_id uuid,
  is_fallback_article boolean not null default false,
  shadow_items jsonb not null default '[]'::jsonb constraint daily_plan_shadow_items_check check (case when jsonb_typeof(shadow_items) = 'array' then jsonb_array_length(shadow_items) <= 5 else false end),
  card_ids uuid[] not null default '{}' constraint daily_plan_card_ids_check check (cardinality(card_ids) <= 25),
  tonight_question_id uuid references public.question (id) on delete restrict,
  status text not null default 'pending' constraint daily_plan_status_check check (status in ('pending', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  constraint daily_plan_pkey primary key (user_id, plan_date),
  constraint daily_plan_article_owner_fkey foreign key (article_id, user_id) references public.news_article (id, user_id) on delete restrict,
  constraint daily_plan_status_consistency_check check (
    (status = 'pending' and error is null)
    or (status = 'ready' and article_id is not null and actual_category is not null and error is null)
    or (status = 'failed' and error is not null)
  )
);

create index news_article_user_id_category_published_at_idx on public.news_article (user_id, category, published_at);
create index question_user_id_retired_idx on public.question (user_id, retired);

-- tonight_question_id must be a bank question or one of the plan owner's own questions (ARCHITECTURE §4.5).
create function public.daily_plan_question_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tonight_question_id is not null and not exists (
    select 1 from public.question q
    where q.id = new.tonight_question_id and (q.user_id is null or q.user_id = new.user_id)
  ) then
    raise exception 'daily_plan.tonight_question_id must be a bank question or the owner''s question' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.daily_plan_question_guard() from public, anon, authenticated;
create trigger daily_plan_question_guard before insert or update of tonight_question_id, user_id on public.daily_plan
  for each row execute function public.daily_plan_question_guard();

-- RLS: user tables are owner-only (user_id = auth.uid()); news_source is read-only; bank questions are readable by signed-in users.
alter table public.news_source enable row level security;
alter table public.news_article enable row level security;
alter table public.resume enable row level security;
alter table public.question enable row level security;
alter table public.daily_plan enable row level security;

revoke all on table public.news_source, public.news_article, public.resume, public.question, public.daily_plan from anon;
revoke all on table public.news_source, public.news_article, public.resume, public.question, public.daily_plan from authenticated;
grant select on table public.news_source to authenticated;
grant select, insert on table public.news_article to authenticated;
grant update (read_at) on table public.news_article to authenticated;
grant select, insert, update, delete on table public.resume to authenticated;
grant select, insert on table public.question to authenticated;
grant update (retired) on table public.question to authenticated;
grant select, insert, update on table public.daily_plan to authenticated;
grant all on table public.news_source, public.news_article, public.resume, public.question, public.daily_plan to service_role;

create policy news_source_select_authenticated on public.news_source for select to authenticated using (true);
create policy news_article_select_own on public.news_article for select to authenticated using (user_id = (select auth.uid()));
create policy news_article_insert_own on public.news_article for insert to authenticated with check (user_id = (select auth.uid()));
create policy news_article_update_own on public.news_article for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy resume_select_own on public.resume for select to authenticated using (user_id = (select auth.uid()));
create policy resume_insert_own on public.resume for insert to authenticated with check (user_id = (select auth.uid()));
create policy resume_update_own on public.resume for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy resume_delete_own on public.resume for delete to authenticated using (user_id = (select auth.uid()));
create policy question_select_own_or_bank on public.question for select to authenticated using (user_id = (select auth.uid()) or user_id is null);
create policy question_insert_own on public.question for insert to authenticated with check (user_id = (select auth.uid()));
create policy question_update_own on public.question for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy daily_plan_select_own on public.daily_plan for select to authenticated using (user_id = (select auth.uid()));
create policy daily_plan_insert_own on public.daily_plan for insert to authenticated with check (user_id = (select auth.uid()));
create policy daily_plan_update_own on public.daily_plan for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

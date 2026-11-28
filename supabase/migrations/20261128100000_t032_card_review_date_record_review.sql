-- T-032: card_review.review_date (one review per card per Taipei day) and record_card_review() (ARCHITECTURE §4.11, ADR-016 decisions 4-5).

-- 1. review_date: the Taipei date of the answer. Add nullable, backfill, then enforce.
alter table public.card_review add column review_date date;
update public.card_review set review_date = (reviewed_at at time zone 'Asia/Taipei')::date where review_date is null;
alter table public.card_review alter column review_date set not null;
-- Default = Taipei today, so inserts that omit review_date (T-004 pgTAP fixtures) keep working; record_card_review always passes it.
alter table public.card_review alter column review_date set default ((now() at time zone 'Asia/Taipei')::date);
alter table public.card_review add constraint card_review_card_id_review_date_key unique (card_id, review_date);

-- 2. record_card_review: compare the old values, update card, insert card_review, all in one transaction.
-- SECURITY INVOKER: RLS applies, so a user can only touch their own cards. SRS maths stays in TypeScript (applyReview).
create function public.record_card_review(
  p_card_id uuid, p_review_date date, p_mode text, p_rating text,
  p_expected_state text, p_expected_correct_count integer, p_expected_interval_step smallint, p_expected_due_date date,
  p_new_state text, p_new_correct_count integer, p_new_interval_step smallint, p_new_due_date date,
  p_interval_days_applied integer
) returns public.card
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card public.card;
  v_updated public.card;
begin
  -- 1. the request must be for today in Taipei (a request that crossed midnight is retried by the client).
  if p_review_date is distinct from (now() at time zone 'Asia/Taipei')::date then
    raise exception 'review_date_mismatch' using errcode = '40001';
  end if;

  -- 2. lock the card; RLS hides other users' cards, so "not found" covers both cases.
  select * into v_card from public.card where id = p_card_id for update;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;

  -- 3. optimistic check: the card must still look like what the caller read.
  if v_card.state is distinct from p_expected_state
    or v_card.correct_count is distinct from p_expected_correct_count
    or v_card.interval_step is distinct from p_expected_interval_step
    or v_card.due_date is distinct from p_expected_due_date then
    raise exception 'card_review_stale' using errcode = '40001';
  end if;

  -- 4. write the new schedule (correct_count_guard and mastered_at triggers still apply).
  update public.card
    set state = p_new_state,
        correct_count = p_new_correct_count,
        interval_step = p_new_interval_step,
        due_date = p_new_due_date
    where id = p_card_id
    returning * into v_updated;

  -- 5. one review per card per Taipei day: the unique constraint raises 23505 on the second one.
  insert into public.card_review (user_id, card_id, review_date, mode, rating, state_before, state_after, interval_days_applied)
    values ((select auth.uid()), p_card_id, p_review_date, p_mode, p_rating, p_expected_state, p_new_state, p_interval_days_applied);

  -- 6. return the updated card row.
  return v_updated;
end;
$$;

revoke all on function public.record_card_review(uuid, date, text, text, text, integer, smallint, date, text, integer, smallint, date, integer) from public, anon;
grant execute on function public.record_card_review(uuid, date, text, text, text, integer, smallint, date, text, integer, smallint, date, integer) to authenticated;

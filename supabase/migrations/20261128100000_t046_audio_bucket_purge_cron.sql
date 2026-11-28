-- T-046: `audio` bucket, Storage policies, orphan-audio RPCs, partial indexes and the daily purge-audio cron.
-- ARCHITECTURE §4.12.1 (bucket), §4.12.2.1 (orphan SQL), §4.12.3 (schedule). No secret values here:
-- Vault secrets `project_url` and `secret_key` are created by hand in the hosted project (G4).

-- 1. bucket (private, 5 MB, no allowed_mime_types)
insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 5242880)
on conflict (id) do nothing;

-- 2. Storage policies: authenticated may select/insert own folder only; no update/delete
-- (deletion is done by purge-audio with the secret key).
create policy audio_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy audio_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 3. partial indexes for the NOT EXISTS checks
create index shadow_attempt_audio_path_idx
  on public.shadow_attempt (audio_path)
  where audio_path is not null;
create index evening_answer_audio_path_idx
  on public.evening_answer (audio_path)
  where audio_path is not null;

-- 4. orphan audio RPCs (service_role only)
create function public.list_orphan_audio_objects(
  p_cutoff timestamptz,
  p_limit integer,
  p_after_created_at timestamptz default null,
  p_after_name text default null
)
returns table(object_name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (p_after_created_at is null) <> (p_after_name is null) then
    raise exception 'p_after_created_at and p_after_name must both be null or both be set'
      using errcode = '22023';
  end if;
  return query
  select o.name, o.created_at
  from storage.objects as o
  where o.bucket_id = 'audio'
    and o.created_at < p_cutoff
    and (
      p_after_created_at is null
      or (o.created_at, o.name) > (p_after_created_at, p_after_name)
    )
    and (storage.foldername(o.name))[1] is not null
    and (
      (
        (storage.foldername(o.name))[2] = 'shadow'
        and (storage.foldername(o.name))[3] is not null
        and (storage.foldername(o.name))[4] is null
      )
      or (
        (storage.foldername(o.name))[2] = 'evening'
        and (storage.foldername(o.name))[3] is null
      )
    )
    and not exists (
      select 1
      from public.shadow_attempt as s
      where s.audio_path = o.name
    )
    and not exists (
      select 1
      from public.evening_answer as e
      where e.audio_path = o.name
    )
  order by o.created_at asc, o.name asc
  limit p_limit;
end;
$$;

create function public.audio_paths_in_use(p_paths text[])
returns table(audio_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.audio_path
  from unnest(p_paths) as p(audio_path)
  where exists (
      select 1 from public.shadow_attempt as s where s.audio_path = p.audio_path
    )
    or exists (
      select 1 from public.evening_answer as e where e.audio_path = p.audio_path
    );
$$;

revoke all on function public.list_orphan_audio_objects(timestamptz, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.list_orphan_audio_objects(timestamptz, integer, timestamptz, text) to service_role;
revoke all on function public.audio_paths_in_use(text[]) from public, anon, authenticated;
grant execute on function public.audio_paths_in_use(text[]) to service_role;

-- 5. schedule: 30 19 * * * UTC = every day 03:30 Asia/Taipei
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('purge-audio-daily', '30 19 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-audio',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$$);

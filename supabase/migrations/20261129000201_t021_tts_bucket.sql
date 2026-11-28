-- T-021: `tts` bucket and Storage policies. ARCHITECTURE §4.12.1 (bucket, Storage RLS), §4.19 (cache key).

-- 1. bucket (private, 2 MB, no allowed_mime_types)
insert into storage.buckets (id, name, public, file_size_limit)
values ('tts', 'tts', false, 2097152)
on conflict (id) do nothing;

-- 2. Storage policies: authenticated may select/insert own folder only. No update/delete:
-- the object name is a content hash, so an object never changes and is never purged (§4.12.1).
create policy tts_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'tts' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy tts_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tts' and (storage.foldername(name))[1] = (select auth.uid())::text);

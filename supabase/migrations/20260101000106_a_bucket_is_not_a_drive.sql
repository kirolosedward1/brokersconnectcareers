-- =============================================================================
-- 106 — A bucket is not a drive
--
-- Every storage policy is "your own folder, anything you like": no count, no
-- total. An account could put ten thousand ten-megabyte objects into `cvs`
-- and the only thing that would notice is the bill. The application removes
-- what it fails to record, but the application is not the only client.
--
-- Twenty objects per folder. A consultant has one CV and a handful of old
-- ones; a company has a logo and a few papers; anything past twenty is not a
-- person keeping files. The count is read through a definer function because
-- a policy on storage.objects that queries storage.objects would apply itself
-- to its own subquery.
--
-- And the two public buckets stop listing. Serving a public object needs no
-- SELECT policy — the public endpoint does not consult one — but listing does,
-- and a world-readable SELECT let anyone enumerate every account folder in
-- `avatars` and every company folder in `company-logos`. The owner keeps
-- select through the manage policy; the world keeps the URLs it was given.
-- =============================================================================

create or replace function public.storage_folder_count(p_bucket text, p_folder text)
returns int
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select count(*)::int
    from storage.objects
   where bucket_id = p_bucket
     and name like p_folder || '/%';
$$;

revoke execute on function public.storage_folder_count(text, text) from public, anon;
grant  execute on function public.storage_folder_count(text, text) to authenticated, service_role;

drop policy if exists "owners manage their company logo" on storage.objects;
create policy "owners manage their company logo"
  on storage.objects for all
  using (
    bucket_id = 'company-logos'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'company-logos'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
    and public.storage_folder_count('company-logos', (storage.foldername(name))[1]) < 20
  );

drop policy if exists "owners manage their verification documents" on storage.objects;
create policy "owners manage their verification documents"
  on storage.objects for all
  using (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
    and public.storage_folder_count('company-documents', (storage.foldername(name))[1]) < 20
  );

drop policy if exists "candidates manage their own cv" on storage.objects;
create policy "candidates manage their own cv"
  on storage.objects for all
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.storage_folder_count('cvs', auth.uid()::text) < 20
  );

drop policy if exists "people manage their own avatar" on storage.objects;
create policy "people manage their own avatar"
  on storage.objects for all
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.storage_folder_count('avatars', auth.uid()::text) < 20
  );

drop policy if exists "avatars are world readable" on storage.objects;
drop policy if exists "company logos are world readable" on storage.objects;

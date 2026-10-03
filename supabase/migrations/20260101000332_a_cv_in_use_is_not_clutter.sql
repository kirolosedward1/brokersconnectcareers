-- =============================================================================
-- 332 — A CV in use is not clutter
--
-- The cvs bucket takes twenty files per person (migration 309): a cap on
-- uploads that nothing points at, so a folder cannot be filled with junk. It
-- counted every file in the folder, though, and every application sent with a
-- newly picked CV keeps its own file — the one its employer reads — so from
-- the twenty-first such application the upload was refused and the candidate
-- told only that something went wrong, on the website and in the app alike.
-- Found by the app's production-readiness audit (2026-09-29).
--
-- The cap now counts the files nothing points at — not an application, not
-- the directory profile (storage_object_is_referenced, migration 204) — which
-- is what it is for. Files in use are bounded by the application limits
-- themselves; loose ones are still twenty at most, and the storage clean-up
-- takes them after a day.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: drop policy "candidates manage their own cv" on storage.objects and re-create it as migration 309 wrote it (with storage_folder_count('cvs', auth.uid()::text) < 20); drop function public.storage_folder_loose_count(text, text).
-- safety: function — a new function; nothing calls it but the policy below
-- safety: rls — the same policy under the same name, with the same folder rule (the caller's own); only its cap counts fewer files, so it refuses a subset of what it refused before and allows nothing another person could reach
-- safety: ships-with-code — no code change in either order: the website and the app upload to the same folder under the same policy name, which now refuses less

-- ---------------------------------------------------------------------------
-- A folder's files that nothing points at, to whoever the folder is
-- ---------------------------------------------------------------------------

create or replace function public.storage_folder_loose_count(p_bucket text, p_folder text)
returns int
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_folder is null then
    return 0;
  end if;

  -- As storage_folder_count (migration 331): one's own folder, or an admin.
  if not (p_folder = v_uid::text or public.is_admin()) then
    return 0;
  end if;

  return (
    select count(*)::int
      from storage.objects o
     where o.bucket_id = p_bucket
       and o.name like p_folder || '/%'
       and not public.storage_object_is_referenced(o.bucket_id, o.name)
  );
end;
$$;

revoke execute on function public.storage_folder_loose_count(text, text) from public, anon;
grant  execute on function public.storage_folder_loose_count(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The CV cap, on loose files
-- ---------------------------------------------------------------------------

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
    and public.storage_folder_loose_count('cvs', auth.uid()::text) < 20
  );

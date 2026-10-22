-- =============================================================================
-- 351 — A withdrawn or deleted application leaves no notice behind
--
-- The bell kept "وصل طلبك على «…»" (application_submitted) and the moves of
-- an application (application_moved) after the application itself was
-- withdrawn or deleted: a candidate's feed was a list of applications they no
-- longer had. Those notices name no application, only the person (user_id)
-- and the listing (payload job_id; a move, the listing's slug), so they are
-- matched that way.
--
-- Withdrawing deletes the application (application_status has no
-- "withdrawn"; on_application_withdrawn runs after delete). From now on: an
-- application deleted takes the
-- candidate's notices about that listing with it. The employer's
-- "applications received" row is a count across a listing's applicants and
-- stays. Once, now: the notices whose application is already gone are
-- removed (12 application_submitted on production, none of the
-- other kinds; counted 2026-10-19). Tested in supabase/tests/notifications.test.mjs.
-- =============================================================================

-- rollback: drop trigger if exists applications_90_forget_notices on applications; drop function if exists public.forget_application_notices(); the removed notices are not restored
-- safety: data — deletes only candidate notices whose application no longer exists; the same rule the trigger applies from now on

create or replace function public.forget_application_notices()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate uuid := old.candidate_id;
  v_job uuid := old.job_id;
begin
  -- Another application of the same person to the same listing still stands: keep its notices.
  if exists (
    select 1 from applications a
     where a.candidate_id = v_candidate and a.job_id = v_job
       and a.id <> old.id
  ) then
    return null;
  end if;
  delete from notifications n
   where n.user_id = v_candidate
     and (
       (n.kind = 'application_submitted' and n.payload->>'job_id' = v_job::text)
       or (n.kind = 'application_moved'
           and n.payload->>'slug' = (select j.slug from jobs j where j.id = v_job))
     );
  return null;
end;
$$;

revoke execute on function public.forget_application_notices() from public, anon, authenticated;

drop trigger if exists applications_90_forget_notices on applications;
create trigger applications_90_forget_notices
  after delete on applications
  for each row execute function public.forget_application_notices();

-- Once: what is already stale.
delete from notifications n
 where n.kind = 'application_submitted'
   and not exists (
     select 1 from applications a
      where a.candidate_id = n.user_id
        and a.job_id::text = n.payload->>'job_id'
   );

delete from notifications n
 where n.kind = 'application_moved'
   and not exists (
     select 1 from applications a join jobs j on j.id = a.job_id
      where a.candidate_id = n.user_id
        and j.slug = n.payload->>'slug'
   );

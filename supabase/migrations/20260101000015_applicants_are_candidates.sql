-- =============================================================================
-- 15 — Only candidates apply
--
-- The insert policy checked who the row claimed to belong to and whether the
-- listing was live, but never what kind of account was applying. An employer
-- could post an application through the API to any live listing, including
-- their own — and, having done so, read it back through the employer policy
-- and move it through their own pipeline.
--
-- Nothing in the interface offered this: the apply page redirects employers
-- before it renders. That is exactly why it went unnoticed. A redirect is a
-- convenience for people who took a wrong turn, not a control — anything that
-- can hold an access token can skip it.
-- =============================================================================

create or replace function public.is_candidate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'candidate' from profiles where id = auth.uid()), false);
$$;

revoke execute on function public.is_candidate() from public;
grant  execute on function public.is_candidate() to anon, authenticated, service_role;

drop policy if exists applications_insert_candidate on applications;

create policy applications_insert_candidate on applications
  for insert with check (
    candidate_id = auth.uid()
    and status = 'new'
    -- SECURITY DEFINER, so the check does not depend on the applicant being
    -- able to read their own profile row through RLS.
    and public.is_candidate()
    -- You can only apply to a live job.
    and exists (
      select 1 from jobs j
      where j.id = job_id and j.status = 'active' and j.expires_at > now()
    )
  );

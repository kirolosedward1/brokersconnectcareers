-- =============================================================================
-- 45 — An application to a listing nobody can read any more
--
-- `jobs_select_active` lets anyone read a listing that is active, expired or
-- closed. Everything else — draft, pending_review, rejected — is the company's
-- own business, which is right for a listing nobody has acted on.
--
-- A candidate who has applied is not nobody. Their application embeds the job
-- for its title, company and district, and when the embed comes back null
-- /dashboard/applications drops the row entirely: not "this listing was taken
-- down", but no trace that they ever applied.
--
-- Until migration 44 that needed a moderator to reject a live listing, which
-- guard_job_update does not actually permit from `active`. It is reachable now
-- and by an ordinary action: an employer editing a live listing materially
-- sends it back to pending_review, and every application on it vanishes from
-- the applicant's own dashboard until a moderator gets to it. Nothing on
-- production is in that state today — all thirty-two applications sit on
-- active listings — which is the moment to fix it.
--
-- The mirror of migration 43: applying is a relationship, and it survives the
-- listing changing state. It reveals no more than the listing already showed
-- on the day they applied.
-- =============================================================================

create or replace function public.applied_to_job(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from applications a
     where a.job_id = p_job
       and a.candidate_id = (select auth.uid())
  );
$$;

-- anon as well, for the reason migration 43 gives: every permissive SELECT
-- policy is evaluated, so one calling a function anon cannot execute errors
-- the whole read rather than falling through to the next policy.
revoke execute on function public.applied_to_job(uuid) from public;
grant  execute on function public.applied_to_job(uuid) to anon, authenticated, service_role;

create policy jobs_select_applicant on jobs
  for select using (public.applied_to_job(id));

-- =============================================================================
-- 57 — auth.uid() called once per query instead of once per row
--
-- Twenty-one policies call `auth.uid()` bare. Postgres treats that as a
-- correlated expression and re-evaluates it for every row it tests; wrapped as
-- `(select auth.uid())` it becomes an InitPlan, computed once. The semantics
-- are identical — the function is stable and takes no arguments — and the
-- convention is already in this schema: migrations 42, 43 and 50 were written
-- this way. These twenty-one predate it.
--
-- What it is worth, measured on production against 22,432 applications rather
-- than assumed: the candidate's own dashboard query went from 2077 ms to
-- 1891 ms. Nine per cent, which is real and is not the story.
--
-- The story is the other half, and it is in the application rather than here.
-- That query asked for `applications` with no filter at all and let row-level
-- security do the narrowing, on the principle that a filter in the page would
-- be a second copy of the policy. It is not a second copy: the policy decides
-- what may be seen and the filter decides what to look at, and without one the
-- planner has nothing to index on — so it scans every row and runs
-- `owns_job()`, a SECURITY DEFINER function, on each. With the scope written
-- out, the same query takes 2.5 ms. Five pages were reading that way and now
-- all five say what they are asking for.
--
-- So: this migration is the cheap half, done because the convention should be
-- uniform and because nine per cent is nine per cent. Restated whole, every
-- one, because `create policy` has no partial form.
-- =============================================================================

drop policy if exists profiles_select_self on profiles;
create policy profiles_select_self on profiles
  for select using (id = (select auth.uid()) or public.is_admin());

drop policy if exists profiles_insert_self on profiles;
create policy profiles_insert_self on profiles
  for insert with check (id = (select auth.uid()) and role <> 'admin');

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role <> 'admin');

drop policy if exists companies_insert_own on companies;
create policy companies_insert_own on companies
  for insert with check (
    owner_id = (select auth.uid())
    and public.current_role_of_user() = 'employer'
    and verification_status = 'unverified'
    and post_credits = 0
  );

drop policy if exists applications_select_candidate on applications;
create policy applications_select_candidate on applications
  for select using (candidate_id = (select auth.uid()));

drop policy if exists applications_insert_candidate on applications;
create policy applications_insert_candidate on applications
  for insert with check (
    candidate_id = (select auth.uid())
    and status = 'new'
    and public.is_candidate()
    and exists (
      select 1 from jobs j
      where j.id = job_id and j.status = 'active' and j.expires_at > now()
    )
  );

drop policy if exists agent_profiles_select_own on agent_profiles;
create policy agent_profiles_select_own on agent_profiles
  for select using (user_id = (select auth.uid()));

drop policy if exists agent_developers_write on agent_developers;
create policy agent_developers_write on agent_developers
  for all
  using (exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())))
  with check (exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())));

drop policy if exists agent_experience_write on agent_experience;
create policy agent_experience_write on agent_experience
  for all
  using (exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())))
  with check (exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())));

drop policy if exists agent_education_write on agent_education;
create policy agent_education_write on agent_education
  for all
  using (exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())))
  with check (exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())));

drop policy if exists agent_certifications_write on agent_certifications;
create policy agent_certifications_write on agent_certifications
  for all
  using (exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())))
  with check (exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())));

drop policy if exists saved_jobs_own on saved_jobs;
create policy saved_jobs_own on saved_jobs
  for all
  using (candidate_id = (select auth.uid()))
  with check (candidate_id = (select auth.uid()));

drop policy if exists reports_select_own on reports;
create policy reports_select_own on reports
  for select using (reporter_id = (select auth.uid()));

drop policy if exists reports_insert_signed_in on reports;
create policy reports_insert_signed_in on reports
  for insert with check (reporter_id = (select auth.uid()));

drop policy if exists saved_searches_owner_select on saved_searches;
create policy saved_searches_owner_select on saved_searches
  for select using (candidate_id = (select auth.uid()));

drop policy if exists saved_searches_owner_insert on saved_searches;
create policy saved_searches_owner_insert on saved_searches
  for insert with check (candidate_id = (select auth.uid()));

drop policy if exists saved_searches_owner_update on saved_searches;
create policy saved_searches_owner_update on saved_searches
  for update using (candidate_id = (select auth.uid()))
  with check (candidate_id = (select auth.uid()));

drop policy if exists saved_searches_owner_delete on saved_searches;
create policy saved_searches_owner_delete on saved_searches
  for delete using (candidate_id = (select auth.uid()));

drop policy if exists notifications_select_own on notifications;
create policy notifications_select_own on notifications
  for select using (user_id = (select auth.uid()));

drop policy if exists notifications_update_own on notifications;
create policy notifications_update_own on notifications
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists notifications_delete_own on notifications;
create policy notifications_delete_own on notifications
  for delete using (user_id = (select auth.uid()));

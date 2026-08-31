-- =============================================================================
-- 04 — Row Level Security
--
-- Default posture: deny. Every table below has RLS enabled, and anything not
-- granted by an explicit policy is refused. Admins bypass via public.is_admin().
-- =============================================================================

alter table profiles                 enable row level security;
alter table governorates             enable row level security;
alter table districts                enable row level security;
alter table developers               enable row level security;
alter table companies                enable row level security;
alter table company_documents        enable row level security;
alter table jobs                     enable row level security;
alter table job_developers           enable row level security;
alter table applications             enable row level security;
alter table agent_profiles           enable row level security;
alter table agent_developers         enable row level security;
alter table saved_jobs               enable row level security;
alter table reports                  enable row level security;
alter table orders                   enable row level security;
alter table monthly_free_post_grants enable row level security;

-- ---------------------------------------------------------------------------
-- Taxonomies — world readable, admin writable.
-- ---------------------------------------------------------------------------

create policy taxonomy_read_governorates on governorates for select using (true);
create policy taxonomy_read_districts    on districts    for select using (true);
create policy taxonomy_read_developers   on developers   for select using (true);

create policy taxonomy_write_governorates on governorates for all using (public.is_admin()) with check (public.is_admin());
create policy taxonomy_write_districts    on districts    for all using (public.is_admin()) with check (public.is_admin());
create policy taxonomy_write_developers   on developers   for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- profiles
--
-- A profile is readable by its owner, by admins, and by an employer who is
-- looking at an application made to one of their own jobs (they need the name
-- and WhatsApp number to actually make contact). Nobody else.
-- ---------------------------------------------------------------------------

create policy profiles_select_self on profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_select_applicants on profiles
  for select using (
    exists (
      select 1 from applications a
      where a.candidate_id = profiles.id
        and public.owns_job(a.job_id)
    )
  );

create policy profiles_insert_self on profiles
  for insert with check (
    id = auth.uid()
    -- Nobody self-assigns the admin role at signup.
    and role <> 'admin'
  );

create policy profiles_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid() and role <> 'admin');

create policy profiles_admin_all on profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- companies — public directory, owner-managed.
-- ---------------------------------------------------------------------------

create policy companies_select_public on companies for select using (true);

create policy companies_insert_own on companies
  for insert with check (
    owner_id = auth.uid()
    and public.current_role_of_user() = 'employer'
    -- Verification and credits are never self-granted.
    and verification_status = 'unverified'
    and post_credits = 0
  );

-- Owners edit their own company. They cannot promote themselves to verified or
-- mint credits — that is enforced by guard_company_update() in migration 05,
-- because a WITH CHECK cannot compare against the pre-update row.
create policy companies_update_own on companies
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy companies_admin_all on companies
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- company_documents — owner + admin only. Private bucket, signed URLs.
-- ---------------------------------------------------------------------------

create policy company_documents_owner on company_documents
  for select using (public.owns_company(company_id));

create policy company_documents_insert on company_documents
  for insert with check (public.owns_company(company_id) and status = 'pending');

create policy company_documents_delete on company_documents
  for delete using (public.owns_company(company_id) and status = 'pending');

create policy company_documents_admin on company_documents
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------

-- Public read covers active listings plus ones that have already run their
-- course. A closed job keeps its URL so inbound links and search results do not
-- 404 — the page renders a "this listing has closed" state and is marked
-- noindex. The board query filters to active on its own; this policy only
-- decides what may be read at all.
create policy jobs_select_active on jobs
  for select using (status in ('active', 'expired', 'closed'));

create policy jobs_select_owner on jobs
  for select using (public.owns_company(company_id));

create policy jobs_insert_owner on jobs
  for insert with check (
    public.owns_company(company_id)
    -- Employers submit for review; they do not publish themselves, and they do
    -- not hand themselves a featured slot.
    and status in ('draft', 'pending_review')
    and is_featured = false
  );

-- Which status transitions an owner may make is enforced by
-- guard_job_update() in migration 05 — notably, they can never move a job
-- into 'active' themselves.
create policy jobs_update_owner on jobs
  for update using (public.owns_company(company_id))
  with check (public.owns_company(company_id));

create policy jobs_admin_all on jobs
  for all using (public.is_admin()) with check (public.is_admin());

-- job_developers follows its parent job: the subquery is itself subject to the
-- jobs policies above, so visibility is inherited rather than restated.
create policy job_developers_select on job_developers
  for select using (exists (select 1 from jobs j where j.id = job_id));

create policy job_developers_write on job_developers
  for all using (public.owns_job(job_id)) with check (public.owns_job(job_id));

create policy job_developers_admin on job_developers
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- applications — candidate reads/creates their own; the owning employer reads
-- and moves them through the pipeline. Nobody else.
-- ---------------------------------------------------------------------------

create policy applications_select_candidate on applications
  for select using (candidate_id = auth.uid());

create policy applications_insert_candidate on applications
  for insert with check (
    candidate_id = auth.uid()
    and status = 'new'
    -- You can only apply to a live job.
    and exists (
      select 1 from jobs j
      where j.id = job_id and j.status = 'active' and j.expires_at > now()
    )
  );

create policy applications_withdraw_candidate on applications
  for delete using (candidate_id = auth.uid());

create policy applications_select_employer on applications
  for select using (public.owns_job(job_id));

create policy applications_update_employer on applications
  for update using (public.owns_job(job_id)) with check (public.owns_job(job_id));

create policy applications_admin_all on applications
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- agent_profiles — the visibility gate.
--
-- `public`                  : anyone.
-- `verified_employers_only` : owners of a verified company, plus admins.
-- `hidden`                  : the owner alone — this is what lets an employed
--                             agent stay invisible to their own employer.
--
-- The /agents directory reads anonymised rows through search_agents() instead,
-- which is SECURITY DEFINER and strips identity itself.
-- ---------------------------------------------------------------------------

create policy agent_profiles_select_public on agent_profiles
  for select using (visibility = 'public');

create policy agent_profiles_select_gated on agent_profiles
  for select using (
    visibility = 'verified_employers_only' and public.viewer_has_verified_company()
  );

create policy agent_profiles_select_own on agent_profiles
  for select using (user_id = auth.uid());

create policy agent_profiles_write_own on agent_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy agent_profiles_admin on agent_profiles
  for all using (public.is_admin()) with check (public.is_admin());

create policy agent_developers_select on agent_developers
  for select using (
    exists (select 1 from agent_profiles a where a.id = agent_id)   -- inherits the gate above
  );

create policy agent_developers_write on agent_developers
  for all using (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = auth.uid())
  ) with check (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- saved_jobs, reports, orders
-- ---------------------------------------------------------------------------

create policy saved_jobs_own on saved_jobs
  for all using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());

create policy reports_insert_any on reports
  for insert with check (reporter_id = auth.uid() or reporter_id is null);

create policy reports_select_own on reports
  for select using (reporter_id = auth.uid());

create policy reports_admin on reports
  for all using (public.is_admin()) with check (public.is_admin());

create policy orders_select_own on orders
  for select using (public.owns_company(company_id));

create policy orders_admin on orders
  for all using (public.is_admin()) with check (public.is_admin());

create policy grants_select_own on monthly_free_post_grants
  for select using (public.owns_company(company_id));

create policy grants_admin on monthly_free_post_grants
  for all using (public.is_admin()) with check (public.is_admin());

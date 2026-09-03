-- =============================================================================
-- 13 — Dashboard summaries
--
-- One function per dashboard, each returning everything its page shows in a
-- single round trip.
--
-- Built before any of the interface, deliberately. A dashboard shell drawn
-- first is a convincing page full of zeroes, and every tile on it is a figure
-- this database could not previously answer without four or five queries.
--
-- All three are SECURITY DEFINER and scope themselves to auth.uid() internally
-- rather than trusting an argument. A caller cannot ask for somebody else's
-- numbers because there is nowhere to say whose numbers to fetch.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Candidate
-- ---------------------------------------------------------------------------

create or replace function public.candidate_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'applications_total',    (select count(*) from applications where candidate_id = auth.uid()),
    'applications_new',      (select count(*) from applications where candidate_id = auth.uid() and status = 'new'),
    'applications_moved',    (select count(*) from applications where candidate_id = auth.uid() and status <> 'new'),
    'applications_hired',    (select count(*) from applications where candidate_id = auth.uid() and status = 'hired'),
    -- A reply is the thing a candidate is actually waiting for: an employer
    -- who moved them, or wrote a reason.
    'replies',               (select count(*) from applications
                               where candidate_id = auth.uid()
                                 and (status <> 'new' or decision_note is not null)),
    'saved_jobs',            (select count(*) from saved_jobs where candidate_id = auth.uid()),
    'saved_searches',        (select count(*) from saved_searches where candidate_id = auth.uid()),
    'alerts_on',             (select count(*) from saved_searches where candidate_id = auth.uid() and alerts),
    'profile_completeness',  coalesce(
                               (select public.profile_completeness(a.id)
                                  from agent_profiles a where a.user_id = auth.uid()), 0),
    'has_profile',           exists (select 1 from agent_profiles where user_id = auth.uid()),
    -- Live roles matching any saved search's district, as a rough "worth
    -- looking today" signal. Deliberately coarse: the exact per-search count
    -- belongs to the weekly digest, which already computes it.
    'open_jobs',             (select count(*) from jobs
                               where status = 'active'
                                 and (expires_at is null or expires_at > now()))
  );
$$;

revoke execute on function public.candidate_summary() from public, anon;
grant  execute on function public.candidate_summary() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Employer
--
-- Scoped through the caller's own company. An employer with no company gets
-- zeroes rather than an error, because that is a real state — the account
-- exists before the company profile does.
-- ---------------------------------------------------------------------------

create or replace function public.employer_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_result  jsonb;
begin
  select id into v_company from companies where owner_id = auth.uid();

  if v_company is null then
    return jsonb_build_object('has_company', false);
  end if;

  select jsonb_build_object(
    'has_company',       true,
    'live_jobs',         count(*) filter (where j.status = 'active'
                                            and (j.expires_at is null or j.expires_at > now())),
    'pending_jobs',      count(*) filter (where j.status = 'pending_review'),
    'draft_jobs',        count(*) filter (where j.status = 'draft'),
    -- Anything live and inside a week of expiry. This is the number that
    -- should feel urgent on the page, so it is counted rather than derived
    -- from a list the interface would have to walk.
    'expiring_soon',     count(*) filter (where j.status = 'active'
                                            and j.expires_at is not null
                                            and j.expires_at between now() and now() + interval '7 days'),
    'total_views',       coalesce(sum(j.view_count), 0),
    'seats_advertised',  coalesce(sum(j.seats) filter (where j.status = 'active'), 0)
  ) into v_result
  from jobs j
  where j.company_id = v_company;

  return v_result || jsonb_build_object(
    'applicants_total',  (select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company),
    'applicants_new',    (select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company and a.status = 'new'),
    'applicants_7d',     (select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company
                             and a.created_at > now() - interval '7 days'),
    -- Last week, so the page can say "up from" rather than showing a number
    -- with nothing to compare it to.
    'applicants_prev_7d',(select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company
                             and a.created_at between now() - interval '14 days'
                                                 and now() - interval '7 days'),
    'credits',           (select post_credits from companies where id = v_company),
    'verification',      (select verification_status::text from companies where id = v_company)
  );
end;
$$;

revoke execute on function public.employer_summary() from public, anon;
grant  execute on function public.employer_summary() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin
--
-- Gated on is_admin() inside the function. SECURITY DEFINER without that check
-- would be a moderation dashboard anybody signed in could read.
-- ---------------------------------------------------------------------------

create or replace function public.admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'queue_total',      (select count(*) from jobs where status = 'pending_review'),
    -- Queue depth by age is the number that says whether moderation is
    -- keeping up; a total alone hides a backlog that is not moving.
    'queue_over_24h',   (select count(*) from jobs
                          where status = 'pending_review' and created_at < now() - interval '24 hours'),
    'reports_open',     (select count(*) from reports where not resolved),
    'companies_pending',(select count(*) from companies where verification_status = 'pending'),
    'companies_total',  (select count(*) from companies),
    'live_jobs',        (select count(*) from jobs
                          where status = 'active' and (expires_at is null or expires_at > now())),
    'candidates',       (select count(*) from profiles where role = 'candidate'),
    'employers',        (select count(*) from profiles where role = 'employer'),
    'signups_7d',       (select count(*) from profiles where created_at > now() - interval '7 days'),
    'published_7d',     (select count(*) from jobs where published_at > now() - interval '7 days'),
    'applications_7d',  (select count(*) from applications where created_at > now() - interval '7 days')
  );
end;
$$;

revoke execute on function public.admin_summary() from public, anon;
grant  execute on function public.admin_summary() to authenticated, service_role;
